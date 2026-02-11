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

function normalizeUatConfig(config) {
  if (!config || typeof config !== 'object') return { assertions: [] };
  const assertions = Array.isArray(config.assertions) ? config.assertions : [];
  return {
    ...config,
    assertions: assertions.map(assertion => normalizeAssertion(assertion))
  };
}

function normalizeAssertion(assertion) {
  const conditions = Array.isArray(assertion.conditions) ? assertion.conditions : [];
  return {
    id: assertion.id || `assertion-${Math.random().toString(16).slice(2)}`,
    title: assertion.title || assertion.id || 'Assertion',
    description: assertion.description || '',
    logic: assertion.logic === 'any' ? 'any' : 'all',
    conditions: conditions.map(cond => ({
      source: cond.source || 'payload',
      path: cond.path || '',
      operator: cond.operator || 'exists',
      expected: cond.expected
    })),
    scope: assertion.scope === 'page' ? 'page' : 'request',
    count: assertion.count || null,
    value: Number.isFinite(assertion.value) ? assertion.value : assertion.value
  };
}

function evaluateAssertionsForRequest(request, assertions, allRequests) {
  if (!request || !Array.isArray(assertions)) return [];
  const results = [];
  assertions.forEach(assertion => {
    const isPageScope = assertion.scope === 'page';
    const { conditionResults, applicable } = resolveRequestConditionResults(assertion, request);

    if (!applicable) return;

    let passed = assertion.logic === 'any'
      ? conditionResults.some(c => c.passed)
      : conditionResults.every(c => c.passed);

    let countResult = null;
    if (isPageScope && assertion.count && assertion.value !== undefined) {
      const count = countAssertionMatches(assertion, allRequests, request);
      const countPassed = evaluateCount(assertion.count, count, assertion.value);
      passed = countPassed;
      countResult = {
        count: assertion.count,
        expected: assertion.value,
        actual: count
      };
    }

    results.push({
      id: assertion.id,
      title: assertion.title,
      description: assertion.description,
      status: passed ? 'passed' : 'failed',
      applicable,
      logic: assertion.logic,
      scope: assertion.scope,
      conditions: conditionResults,
      count: countResult
    });
  });
  return results;
}

function resolveRequestConditionResults(assertion, request) {
  const conditionResults = assertion.conditions.map(condition => {
    const resolved = resolveConditionValue(condition, request);
    const passed = evaluateCondition(condition, resolved.values);
    return {
      ...condition,
      passed,
      actual: resolved.values,
      used: resolved.used
    };
  });
  const applicable = conditionResults.some(c => c.used);
  return { conditionResults, applicable };
}


function evaluateCondition(condition, values) {
  const operator = condition.operator || 'exists';
  const expected = condition.expected;
  const list = Array.isArray(values) ? values : [values];
  const hasValue = list.some(v => v !== undefined && v !== null && String(v).length > 0);

  switch (operator) {
    case 'exists':
      return hasValue;
    case 'not_exists':
      return !hasValue;
    case 'equals':
      return list.some(v => String(v) === String(expected));
    case 'contains':
      return list.some(v => String(v).includes(String(expected)));
    case 'starts_with':
      return list.some(v => String(v).startsWith(String(expected)));
    case 'ends_with':
      return list.some(v => String(v).endsWith(String(expected)));
    case 'regex': {
      try {
        const regex = new RegExp(String(expected));
        return list.some(v => regex.test(String(v)));
      } catch {
        return false;
      }
    }
    case 'in': {
      const expectedList = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return list.some(v => expectedList.includes(String(v)));
    }
    case 'not_in': {
      const expectedList = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return list.every(v => !expectedList.includes(String(v)));
    }
    case 'gt':
      return list.some(v => Number(v) > Number(expected));
    case 'gte':
      return list.some(v => Number(v) >= Number(expected));
    case 'lt':
      return list.some(v => Number(v) < Number(expected));
    case 'lte':
      return list.some(v => Number(v) <= Number(expected));
    case 'range': {
      const range = Array.isArray(expected) ? expected : [];
      return list.some(v => Number(v) >= Number(range[0]) && Number(v) <= Number(range[1]));
    }
    default:
      return false;
  }
}

function resolveConditionValue(condition, request) {
  const source = condition.source || 'payload';
  const path = condition.path || '';
  if (source === 'payload') {
    const payload = getPayloadObject(request);
    if (!payload) return { used: false, values: [] };
    const value = getValueAtPath(payload, path);
    return { used: value !== undefined, values: normalizeValues(value) };
  }
  if (source === 'query') {
    const params = (request.query && request.query.params) || [];
    const matches = params.filter(p => p.key === path).map(p => p.value);
    return { used: matches.length > 0, values: matches };
  }
  if (source === 'headers') {
    const headers = request.requestHeaders || [];
    const matches = headers.filter(h => h.name.toLowerCase() === path.toLowerCase()).map(h => h.value);
    return { used: matches.length > 0, values: matches };
  }
  if (source === 'raw') {
    const raw = request.body?.raw || '';
    return { used: raw.length > 0, values: [raw] };
  }
  return { used: false, values: [] };
}

function getPayloadObject(request) {
  if (!request?.body) return null;
  if (request.body.parsed && typeof request.body.parsed === 'object') return request.body.parsed;
  if (typeof request.body.raw === 'string') {
    const json = tryParseJson(request.body.raw);
    if (json) return json;
    const form = parseKeyValuePairs(request.body.raw, true);
    if (form.length) return Object.fromEntries(form.map(item => [item.key, item.value]));
  }
  return null;
}

function normalizeValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [JSON.stringify(value)];
  if (value === undefined) return [];
  return [value];
}

function getValueAtPath(obj, path) {
  if (!path) return obj;
  const tokens = parsePath(path);
  let current = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[token];
    } else {
      current = current[token];
    }
  }
  return current;
}

function parsePath(path) {
  const tokens = [];
  path.split('.').forEach(segment => {
    const parts = segment.split(/\\[|\\]/).filter(Boolean);
    parts.forEach(part => {
      const index = Number(part);
      if (!Number.isNaN(index) && part.trim() !== '') {
        tokens.push(index);
      } else {
        tokens.push(part);
      }
    });
  });
  return tokens.filter(t => t !== '');
}

function countAssertionMatches(assertion, allRequests, request) {
  if (!Array.isArray(allRequests)) return 0;
  const pageKey = request.navId ? `${request.pageUrl || request.url}::${request.navId}` : (request.pageUrl || request.url);
  return allRequests.filter(item => {
    const key = item.navId ? `${item.pageUrl || item.url}::${item.navId}` : (item.pageUrl || item.url);
    if (key !== pageKey) return false;
    const results = assertion.conditions.map(condition => {
      const resolved = resolveConditionValue(condition, item);
      return evaluateCondition(condition, resolved.values);
    });
    return assertion.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
  }).length;
}

function evaluateCount(mode, actual, expected) {
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber)) return false;
  if (mode === 'at_least') return actual >= expectedNumber;
  if (mode === 'at_most') return actual <= expectedNumber;
  return actual === expectedNumber;
}

const DEFAULT_ALLOWLIST = [
  'edge.adobedc.net'
];

const DEFAULT_SETTINGS = {
  allowlist: DEFAULT_ALLOWLIST,
  capturePaused: false,
  maxEntries: 2000,
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
let uatConfigs = {};

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
  const stored = await storageGet(['settings', 'requests', 'sessions', 'sites', 'currentSessionId', 'uatConfigs']);
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  if (Array.isArray(stored.requests)) {
    requests = stored.requests;
    requestIndex = new Map(requests.map(r => [r.requestId, r]));
  }
  if (Array.isArray(stored.sessions)) sessions = stored.sessions;
  if (Array.isArray(stored.sites)) sites = stored.sites;
  if (stored.currentSessionId) currentSessionId = stored.currentSessionId;
  if (stored.uatConfigs && typeof stored.uatConfigs === 'object') {
    uatConfigs = Object.fromEntries(Object.entries(stored.uatConfigs).map(([key, value]) => [key, normalizeUatConfig(value)]));
  }
  if (!currentSessionId) currentSessionId = sessions[0]?.id || null;
  if (!settings.selectedSessionId) settings.selectedSessionId = currentSessionId;
}

function saveState() {
  return storageSet({ settings, requests, sessions, sites, currentSessionId, uatConfigs });
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
  const session = sessions.find(s => s.id === sessionId);
  const uatConfig = session?.site ? uatConfigs[session.site] : null;
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
    navId: nav.navId || null,
    uat: session?.uatEnabled && uatConfig ? { status: 'pending', results: [] } : null
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
  evaluateUatForRequest(entry);
  saveState();
  api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
}

function evaluateUatForRequest(entry) {
  if (!entry) return;
  const session = sessions.find(s => s.id === entry.sessionId);
  if (!session || !session.uatEnabled) {
    entry.uat = null;
    return;
  }
  const config = session.site ? uatConfigs[session.site] : null;
  if (!config || !Array.isArray(config.assertions)) {
    entry.uat = { status: 'not-applicable', results: [] };
    return;
  }
  const sessionRequests = requests.filter(r => r.sessionId === entry.sessionId);
  const results = evaluateAssertionsForRequest(entry, config.assertions, sessionRequests);
  if (!results.length) {
    entry.uat = { status: 'not-applicable', results: [] };
    return;
  }
  entry.uat = { status: 'done', results };
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
    sendResponse({ settings, requests, sessions, sites, currentSessionId, uatConfigs });
    return true;
  }
  if (message.type === 'setSettings') {
    settings = { ...settings, ...message.settings };
    saveState();
    api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    sendResponse({ ok: true, settings });
    return true;
  }
  if (message.type === 'setUatConfig') {
    const site = (message.site || '').trim();
    if (!site || !message.config) {
      sendResponse({ ok: false });
      return true;
    }
    if (!sites.includes(site)) sites.unshift(site);
    uatConfigs = { ...uatConfigs, [site]: normalizeUatConfig(message.config) };
    requests.forEach(entry => {
      const session = sessions.find(s => s.id === entry.sessionId);
      if (!session || !session.uatEnabled) return;
      if (session.site !== site) return;
      evaluateUatForRequest(entry);
      api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
    });
    saveState();
    api.runtime.sendMessage({ type: 'sitesUpdated', sites });
    api.runtime.sendMessage({ type: 'uatConfigsUpdated', uatConfigs });
    sendResponse({ ok: true, uatConfigs });
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
    const session = createSession(name, site, message.lockTabId || null, !!message.uatEnabled);
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
  if (message.type === 'updateSession') {
    const session = sessions.find(s => s.id === message.id);
    if (!session) {
      sendResponse({ ok: false });
      return true;
    }
    if (message.name !== undefined) session.name = message.name || session.name;
    if (message.site) session.site = message.site;
    if (message.lockTabId !== undefined) session.lockTabId = message.lockTabId;
    if (message.uatEnabled !== undefined) session.uatEnabled = !!message.uatEnabled;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    sendResponse({ ok: true, session });
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
  if (message.type === 'clearAllData') {
    sessions = [];
    requests = [];
    requestIndex = new Map();
    sites = [];
    uatConfigs = {};
    currentSessionId = null;
    settings.selectedSessionId = null;
    settings.capturePaused = true;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    api.runtime.sendMessage({ type: 'sitesUpdated', sites });
    api.runtime.sendMessage({ type: 'uatConfigsUpdated', uatConfigs });
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
        evaluateUatForRequest(entry);
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
      evaluateUatForRequest(entry);
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
    evaluateUatForRequest(entry);
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

function createSession(name, site, lockTabId, uatEnabled) {
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    site,
    lockTabId: lockTabId ?? null,
    paused: false,
    createdAt: Date.now(),
    uatEnabled: !!uatEnabled
  };
}
