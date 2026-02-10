const api = globalThis.chrome || globalThis.browser;
const action = api.action || api.browserAction;

function safeDecode(value) {
  if (value === undefined || value === null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodePlus(value) {
  if (value === undefined || value === null) return '';
  return value.replace(/\+/g, ' ');
}

function parseKeyValuePairs(raw, plusAsSpace) {
  if (!raw) return [];
  return raw.split('&').filter(Boolean).map(pair => {
    const idx = pair.indexOf('=');
    const rawKey = idx === -1 ? pair : pair.slice(0, idx);
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1);
    const keySource = plusAsSpace ? decodePlus(rawKey) : rawKey;
    const valueSource = plusAsSpace ? decodePlus(rawValue) : rawValue;
    return {
      rawKey,
      rawValue,
      key: safeDecode(keySource),
      value: safeDecode(valueSource)
    };
  });
}

function parseQueryString(url) {
  try {
    const parsed = new URL(url);
    const rawQuery = parsed.search ? parsed.search.slice(1) : '';
    return {
      raw: rawQuery,
      params: parseKeyValuePairs(rawQuery, true)
    };
  } catch {
    return { raw: '', params: [] };
  }
}

function parseFormData(formData) {
  const params = [];
  Object.keys(formData || {}).forEach(key => {
    const values = Array.isArray(formData[key]) ? formData[key] : [formData[key]];
    values.forEach(value => {
      const rawValue = value || '';
      params.push({
        rawKey: key,
        rawValue,
        key,
        value: safeDecode(rawValue)
      });
    });
  });
  return { raw: '', params };
}

function mergeRawBytes(rawEntries) {
  const total = rawEntries.reduce((sum, entry) => sum + (entry.bytes ? entry.bytes.byteLength : 0), 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  rawEntries.forEach(entry => {
    if (!entry.bytes) return;
    merged.set(new Uint8Array(entry.bytes), offset);
    offset += entry.bytes.byteLength;
  });
  return merged;
}

function decodeBytes(bytes) {
  if (!bytes || !bytes.length) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRawBody(requestBody, contentType = '') {
  if (requestBody.formData) {
    return {
      type: 'formData',
      contentType,
      parsed: parseFormData(requestBody.formData)
    };
  }

  if (requestBody.raw && requestBody.raw.length) {
    const bytes = mergeRawBytes(requestBody.raw);
    const text = decodeBytes(bytes);
    const lowerType = contentType.toLowerCase();

    if (lowerType.includes('application/json')) {
      const json = tryParseJson(text);
      return {
        type: 'json',
        contentType,
        raw: text,
        parsed: json
      };
    }

    if (lowerType.includes('application/x-www-form-urlencoded')) {
      return {
        type: 'form',
        contentType,
        raw: text,
        parsed: {
          raw: text,
          params: parseKeyValuePairs(text, true)
        }
      };
    }

    const json = tryParseJson(text);
    return {
      type: json ? 'json' : 'text',
      contentType,
      raw: text,
      parsed: json
    };
  }

  return null;
}

function getDomainFromUrl(url) {
  return new URL(url).hostname;
}

function getPathFromUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname || '/';
}

const DEFAULT_ALLOWLIST = [
  'edge.adobedc.net'
];

const DEFAULT_SETTINGS = {
  allowlist: DEFAULT_ALLOWLIST,
  capturePaused: false,
  maxEntries: 500,
  selectedSessionId: null,
  enableHooks: false,
  serviceMappings: []
};

let settings = { ...DEFAULT_SETTINGS };
let requests = [];
let requestIndex = new Map();
let sessions = [];
let sites = [];
let currentSessionId = null;
let navState = new Map();
let tabUrlCache = new Map();
const payloadCacheByUrlTab = new Map();

function storageGet(keys) {
  return new Promise(resolve => {
    try {
      const result = api.storage.local.get(keys, data => resolve(data || {}));
      if (result && typeof result.then === 'function') {
        result.then(data => resolve(data || {})).catch(() => resolve({}));
      }
    } catch {
      resolve({});
    }
  });
}

function storageSet(value) {
  return new Promise(resolve => {
    try {
      const result = api.storage.local.set(value, () => resolve());
      if (result && typeof result.then === 'function') {
        result.then(() => resolve()).catch(() => resolve());
      }
    } catch {
      resolve();
    }
  });
}

function tabsQuery(queryInfo) {
  return new Promise(resolve => {
    try {
      const result = api.tabs.query(queryInfo, tabs => resolve(tabs || []));
      if (result && typeof result.then === 'function') {
        result.then(tabs => resolve(tabs || [])).catch(() => resolve([]));
      }
    } catch {
      resolve([]);
    }
  });
}

async function loadState() {
  const stored = await storageGet(['settings', 'requests', 'sessions', 'sites', 'currentSessionId']);
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  if (Array.isArray(stored.requests)) {
    requests = stored.requests;
    requestIndex = new Map(requests.map(r => [r.requestId, r]));
  }
  if (Array.isArray(stored.sessions)) sessions = stored.sessions;
  if (Array.isArray(stored.sites)) sites = stored.sites;
  if (stored.currentSessionId) currentSessionId = stored.currentSessionId;
  if (!currentSessionId) currentSessionId = sessions[0]?.id || null;
  if (!settings.selectedSessionId) settings.selectedSessionId = currentSessionId;
}

function saveState() {
  return storageSet({ settings, requests, sessions, sites, currentSessionId });
}

function isAllowed(url) {
  try {
    const domain = getDomainFromUrl(url);
    return settings.allowlist.some(entry => {
      const trimmed = entry.trim();
      if (!trimmed) return false;
      if (domain === trimmed) return true;
      return domain.endsWith(`.${trimmed}`);
    });
  } catch {
    return false;
  }
}

function trimRequests() {
  if (requests.length <= settings.maxEntries) return;
  requests = requests.slice(-settings.maxEntries);
  requestIndex = new Map(requests.map(r => [r.requestId, r]));
}

function addRequest(details) {
  const sessionId = currentSessionId || settings.selectedSessionId;
  const nav = navState.get(details.tabId) || {};
  const cachedUrl = tabUrlCache.get(details.tabId);
  const requestId = getRequestIdFromUrl(details.url);
  const cachedPayload = requestId ? pullCachedPayload(requestId) : pullCachedPayloadByUrl(details.tabId, details.url, details.timeStamp);
  const pageUrl = nav.pageUrl || nav.pendingUrl || cachedUrl || extractPageUrlFromRequest(details.url) || null;
  const entry = {
    id: `${details.requestId}:${details.timeStamp}`,
    requestId: details.requestId,
    sessionId,
    tabId: details.tabId,
    frameId: details.frameId,
    method: details.method,
    url: details.url,
    domain: getDomainFromUrl(details.url),
    path: getPathFromUrl(details.url),
    timeStamp: details.timeStamp,
    startTime: details.timeStamp,
    statusCode: null,
    statusLine: null,
    duration: null,
    requestHeaders: [],
    query: parseQueryString(details.url),
    body: cachedPayload || null,
    pageUrl,
    navId: nav.navId || null
  };

  requests.push(entry);
  requestIndex.set(details.requestId, entry);
  trimRequests();
  saveState();
  api.runtime.sendMessage({ type: 'requestAdded', request: entry });
}

function updateRequest(requestId, patch) {
  const entry = requestIndex.get(requestId);
  if (!entry) return;
  Object.assign(entry, patch);
  saveState();
  api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
}

api.runtime.onInstalled?.addListener(() => {
  loadState();
});

api.runtime.onStartup?.addListener(() => {
  loadState();
});

action?.onClicked.addListener(async () => {
  const url = api.runtime.getURL('pages/app.html');
  const tabs = await tabsQuery({ url });
  if (tabs.length) {
    await api.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await api.tabs.create({ url });
});

async function endActiveSessionIfClosed() {
  const url = api.runtime.getURL('pages/app.html');
  const tabs = await tabsQuery({ url });
  if (tabs.length) return;
  const session = sessions.find(s => s.id === settings.selectedSessionId);
  if (session) session.paused = true;
  settings.selectedSessionId = null;
  currentSessionId = null;
  settings.capturePaused = true;
  await saveState();
  api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
}

api.tabs.onRemoved.addListener(() => {
  endActiveSessionIfClosed();
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    endActiveSessionIfClosed();
  }
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  if (message.type === 'getSettings') {
    sendResponse({ settings });
    return true;
  }
  if (message.type === 'getState') {
    sendResponse({ settings, requests, sessions, sites, currentSessionId });
    return true;
  }
  if (message.type === 'setSettings') {
    settings = { ...settings, ...message.settings };
    saveState();
    api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    sendResponse({ ok: true, settings });
    return true;
  }
  if (message.type === 'clearRequests') {
    const targetSession = settings.selectedSessionId || currentSessionId;
    if (targetSession) {
      requests = requests.filter(r => r.sessionId !== targetSession);
      requestIndex = new Map(requests.map(r => [r.requestId, r]));
    } else {
      requests = [];
      requestIndex = new Map();
    }
    saveState();
    api.runtime.sendMessage({ type: 'requestsCleared' });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'startSession') {
    const site = (message.site || '').trim();
    if (!site) {
      sendResponse({ ok: false, error: 'site_required' });
      return true;
    }
    const name = (message.name || '').trim() || `Session ${sessions.length + 1}`;
    const session = createSession(name, site, message.lockTabId || null);
    sessions.unshift(session);
    if (!sites.includes(site)) sites.unshift(site);
    currentSessionId = session.id;
    settings.selectedSessionId = session.id;
    settings.capturePaused = false;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    api.runtime.sendMessage({ type: 'sitesUpdated', sites });
    sendResponse({ ok: true, session });
    return true;
  }
  if (message.type === 'renameSession') {
    const session = sessions.find(s => s.id === message.id);
    if (session) session.name = message.name || session.name;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'selectSession') {
    const session = sessions.find(s => s.id === message.id);
    if (session) {
      settings.selectedSessionId = message.id;
      settings.capturePaused = !!session.paused;
      saveState();
      api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
      api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'pauseSession') {
    const session = sessions.find(s => s.id === message.id);
    if (session) {
      settings.selectedSessionId = session.id;
      currentSessionId = session.id;
      session.paused = true;
      settings.capturePaused = true;
      saveState();
      api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
      api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'deleteSession') {
    const id = message.id;
    if (!id) {
      sendResponse({ ok: false });
      return true;
    }
    sessions = sessions.filter(s => s.id !== id);
    requests = requests.filter(r => r.sessionId !== id);
    requestIndex = new Map(requests.map(r => [r.requestId, r]));
    if (settings.selectedSessionId === id) {
      settings.selectedSessionId = sessions[0]?.id || null;
    }
    if (currentSessionId === id) {
      currentSessionId = settings.selectedSessionId || null;
    }
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'clearSessions') {
    sessions = [];
    requests = [];
    requestIndex = new Map();
    currentSessionId = null;
    settings.selectedSessionId = null;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'capturedPayload') {
    if (!message.payload) {
      sendResponse({ ok: false });
      return true;
    }
    if (message.requestId) cachePayload(message.requestId, message.payload);
    if (message.url && sender?.tab?.id !== undefined) {
      cachePayloadByUrl(sender.tab.id, message.url, message.payload);
    }
    if (message.requestId) attachPayloadToRequests(message.requestId, message.payload);
    if (message.url && sender?.tab?.id !== undefined) {
      attachPayloadToRequestsByUrl(sender.tab.id, message.url, message.payload);
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

api.webRequest.onBeforeRequest.addListener(
  details => {
    if (settings.capturePaused) return;
    if (!isAllowed(details.url)) return;
    const sessionId = settings.selectedSessionId || currentSessionId;
    if (!sessionId) return;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (session?.lockTabId !== null && session?.lockTabId !== undefined) {
      if (details.tabId !== session.lockTabId) return;
    }
    addRequest(details);

    if (details.requestBody) {
      const entry = requestIndex.get(details.requestId);
      if (entry) {
        entry.body = parseRawBody(details.requestBody, '');
        saveState();
        api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

api.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = navState.get(details.tabId) || { navId: 0, pageUrl: null };
  navState.set(details.tabId, {
    navId: existing.navId || 0,
    pageUrl: existing.pageUrl || null,
    pendingUrl: details.url,
    pendingAt: details.timeStamp || Date.now()
  });
  tabUrlCache.set(details.tabId, details.url);
});

api.webNavigation.onCompleted.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = navState.get(details.tabId) || { navId: 0 };
  navState.set(details.tabId, {
    navId: (existing.navId || 0) + 1,
    pageUrl: existing.pendingUrl || details.url,
    pendingUrl: null,
    pendingAt: null
  });
  tabUrlCache.set(details.tabId, details.url);
});

api.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = navState.get(details.tabId) || { navId: 0 };
  navState.set(details.tabId, {
    navId: (existing.navId || 0) + 1,
    pageUrl: details.url,
    pendingUrl: null,
    pendingAt: null
  });
  tabUrlCache.set(details.tabId, details.url);
});

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    tabUrlCache.set(tabId, changeInfo.url);
  }
  if (changeInfo.status === 'complete' && tab?.url) {
    tabUrlCache.set(tabId, tab.url);
  }
});

api.tabs.onRemoved.addListener(tabId => {
  tabUrlCache.delete(tabId);
  navState.delete(tabId);
});

const payloadCache = new Map();
const PAYLOAD_TTL_MS = 2 * 60 * 1000;

function cachePayload(requestId, payload) {
  payloadCache.set(requestId, { payload, ts: Date.now() });
  prunePayloadCache();
}

function pullCachedPayload(requestId) {
  const entry = payloadCache.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.ts > PAYLOAD_TTL_MS) {
    payloadCache.delete(requestId);
    return null;
  }
  payloadCache.delete(requestId);
  return entry.payload || null;
}

function prunePayloadCache() {
  const now = Date.now();
  for (const [key, value] of payloadCache.entries()) {
    if (now - value.ts > PAYLOAD_TTL_MS) payloadCache.delete(key);
  }
}

function cachePayloadByUrl(tabId, url, payload) {
  if (tabId === undefined || !url) return;
  const list = payloadCacheByUrlTab.get(tabId) || [];
  list.push({ url, payload, ts: Date.now() });
  payloadCacheByUrlTab.set(tabId, list);
  prunePayloadCacheByUrl(tabId);
}

function pullCachedPayloadByUrl(tabId, url, timeStamp) {
  if (tabId === undefined || !url) return null;
  const list = payloadCacheByUrlTab.get(tabId) || [];
  const now = Date.now();
  const matchIndex = list.findIndex(entry => entry.url === url && Math.abs((timeStamp || now) - entry.ts) < 5000);
  if (matchIndex === -1) return null;
  const [entry] = list.splice(matchIndex, 1);
  payloadCacheByUrlTab.set(tabId, list);
  return entry.payload || null;
}

function prunePayloadCacheByUrl(tabId) {
  const list = payloadCacheByUrlTab.get(tabId) || [];
  const now = Date.now();
  const filtered = list.filter(entry => now - entry.ts <= PAYLOAD_TTL_MS);
  payloadCacheByUrlTab.set(tabId, filtered);
}

function getRequestIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('requestId');
  } catch {
    return null;
  }
}

function extractPageUrlFromRequest(url) {
  try {
    const parsed = new URL(url);
    const candidates = [
      'dl',
      'documentLocation',
      'document_location',
      'page_location',
      'pageLocation',
      'u',
      'url'
    ];
    for (const key of candidates) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      const decoded = decodeURIComponent(value);
      if (decoded.startsWith('http')) return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

function attachPayloadToRequests(requestId, payload) {
  if (!requestId) return;
  let updated = false;
  requests.forEach(entry => {
    if (entry.body) return;
    const idInUrl = getRequestIdFromUrl(entry.url);
    if (idInUrl && idInUrl === requestId) {
      entry.body = payload;
      updated = true;
      api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
    }
  });
  if (updated) saveState();
}

function attachPayloadToRequestsByUrl(tabId, url, payload) {
  if (tabId === undefined || !url) return;
  let updated = false;
  requests.forEach(entry => {
    if (entry.body) return;
    if (entry.tabId !== tabId) return;
    if (entry.url !== url) return;
    entry.body = payload;
    updated = true;
    api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
  });
  if (updated) saveState();
}

api.webRequest.onBeforeSendHeaders.addListener(
  details => {
    if (settings.capturePaused) return;
    if (!isAllowed(details.url)) return;
    const headers = (details.requestHeaders || []).map(h => ({
      name: h.name,
      value: h.value
    }));
    const contentTypeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
    const contentType = contentTypeHeader ? contentTypeHeader.value : '';
    const entry = requestIndex.get(details.requestId);
    if (entry && entry.body && entry.body.contentType === '') entry.body.contentType = contentType;
    updateRequest(details.requestId, { requestHeaders: headers });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

api.webRequest.onCompleted.addListener(
  details => {
    if (!isAllowed(details.url)) return;
    const entry = requestIndex.get(details.requestId);
    const duration = entry ? details.timeStamp - entry.startTime : null;
    updateRequest(details.requestId, {
      statusCode: details.statusCode,
      statusLine: details.statusLine || null,
      duration
    });
  },
  { urls: ['<all_urls>'] }
);

api.webRequest.onErrorOccurred.addListener(
  details => {
    if (!isAllowed(details.url)) return;
    updateRequest(details.requestId, {
      statusCode: null,
      statusLine: details.error || 'error'
    });
  },
  { urls: ['<all_urls>'] }
);

loadState();

function createSession(name, site, lockTabId) {
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    site,
    lockTabId: lockTabId ?? null,
    paused: false,
    createdAt: Date.now()
  };
}
