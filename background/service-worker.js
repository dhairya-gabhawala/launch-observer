import {
  parseQueryString,
  parseRawBody,
  getDomainFromUrl,
  getPathFromUrl
} from '../lib/parse.js';
import { resolveServiceIdForDomain } from '../lib/services.js';
import { normalizeUatConfig, evaluateAssertionsForRequest } from '../lib/uat.js';

const api = globalThis.chrome || globalThis.browser;
const action = api.action || api.browserAction;

const DEFAULT_ALLOWLIST = [
  'edge.adobedc.net'
];

const DEFAULT_SETTINGS = {
  allowlist: DEFAULT_ALLOWLIST,
  capturePaused: false,
  maxEntries: 2000,
  selectedSessionId: null,
  enableHooks: false,
  debugHooks: false,
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
const hookQueueByTabUrl = new Map();
const hookQueueByUrl = new Map();
let lastRequestAt = Date.now();
let idlePrompted = false;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_CHECK_ALARM = 'idle-check';

function debugHookLog(...args) {
  if (!settings?.debugHooks) return;
  console.log('[Launch Observer Hooks]', ...args);
}

/**
 * Check whether a URL is eligible for script injection.
 * @param {string} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Inject the page hook in the MAIN world (Chrome/Edge only).
 * @param {number} tabId
 * @param {string} [url='']
 * @param {string} [reason='']
 * @returns {Promise<void>}
 */
async function injectPageHooks(tabId, url = '', reason = '') {
  if (!api.scripting?.executeScript) return;
  if (!settings.enableHooks) return;
  if (settings.capturePaused) return;
  const sessionId = settings.selectedSessionId || currentSessionId;
  if (!sessionId) return;
  const session = sessions.find(s => s.id === sessionId);
  if (!session || session.paused) return;
  if (session.lockTabId !== null && session.lockTabId !== undefined && session.lockTabId !== tabId) return;
  let targetUrl = url;
  if (!targetUrl) {
    try {
      const tab = await api.tabs.get(tabId);
      targetUrl = tab?.url || '';
    } catch {
      return;
    }
  }
  if (!isHttpUrl(targetUrl)) return;
  try {
    await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/inject.js'],
      world: 'MAIN'
    });
    debugHookLog('inject: main world', { tabId, url: targetUrl, reason });
  } catch (error) {
    debugHookLog('inject: failed', { tabId, url: targetUrl, reason, error: String(error) });
  }
}

/**
 * Load persisted extension state from storage.
 * @returns {Promise<void>}
 */
async function loadState() {
  const stored = await api.storage.local.get(['settings', 'requests', 'sessions', 'sites', 'currentSessionId', 'uatConfigs', 'lastRequestAt', 'idlePrompted']);
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
  if (stored.lastRequestAt) lastRequestAt = stored.lastRequestAt;
  if (stored.idlePrompted !== undefined) idlePrompted = !!stored.idlePrompted;
  if (!currentSessionId) currentSessionId = sessions[0]?.id || null;
  if (!settings.selectedSessionId) settings.selectedSessionId = currentSessionId;
}

/**
 * Persist extension state to storage.
 * @returns {Promise<void>}
 */
function saveState() {
  return api.storage.local.set({ settings, requests, sessions, sites, currentSessionId, uatConfigs, lastRequestAt, idlePrompted });
}

/**
 * Check whether a URL matches the allowlist.
 * @param {string} url
 * @returns {boolean}
 */
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

/**
 * Trim request list to max entries.
 */
function trimRequests() {
  if (requests.length <= settings.maxEntries) return;
  requests = requests.slice(-settings.maxEntries);
  requestIndex = new Map(requests.map(r => [r.requestId, r]));
}

/**
 * Create a new request entry from webRequest details.
 * @param {object} details
 */
function addRequest(details) {
  const sessionId = currentSessionId || settings.selectedSessionId;
  const nav = navState.get(details.tabId) || {};
  const cachedUrl = tabUrlCache.get(details.tabId);
  const requestId = getRequestIdFromUrl(details.url);
  const cachedPayload = requestId ? pullCachedPayload(requestId) : pullCachedPayloadByUrl(details.tabId, details.url, details.timeStamp);
  const hookMatch = pullHookPayload(details.tabId, details.url, details.timeStamp)
    || pullHookPayloadByUrl(details.url, details.timeStamp);
  const cachedBody = hookMatch?.payload || cachedPayload?.payload || null;
  const cachedPageUrl = hookMatch?.pageUrl || cachedPayload?.pageUrl || '';
  const pageUrl = nav.pageUrl
    || nav.pendingUrl
    || cachedUrl
    || details.documentUrl
    || details.initiator
    || cachedPageUrl
    || extractPageUrlFromRequest(details.url)
    || null;
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
    documentUrl: details.documentUrl || null,
    initiator: details.initiator || null,
    domain: getDomainFromUrl(details.url),
    serviceId: resolveServiceIdForDomain(getDomainFromUrl(details.url), settings.serviceMappings || []),
    path: getPathFromUrl(details.url),
    timeStamp: details.timeStamp,
    startTime: details.timeStamp,
    statusCode: null,
    statusLine: null,
    duration: null,
    requestHeaders: [],
    query: parseQueryString(details.url),
    body: cachedBody,
    pageUrl,
    navId: nav.navId || null,
    uat: session?.uatEnabled && uatConfig ? { status: 'pending', results: [] } : null
  };

  if ((!entry.pageUrl || entry.pageUrl === '/') && entry.body) {
    entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
  }
  requests.push(entry);
  requestIndex.set(details.requestId, entry);
  lastRequestAt = Date.now();
  idlePrompted = false;
  trimRequests();
  saveState();
  api.runtime.sendMessage({ type: 'requestAdded', request: entry });
}

/**
 * Update a request entry and broadcast changes.
 * @param {string} requestId
 * @param {object} patch
 */
function updateRequest(requestId, patch) {
  const entry = requestIndex.get(requestId);
  if (!entry) return;
  Object.assign(entry, patch);
  if (!entry.pageUrl && entry.body) {
    entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
  }
  evaluateUatForRequest(entry);
  saveState();
  api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
}

/**
 * Check whether a request entry looks like WebSDK.
 * @param {object} entry
 * @returns {boolean}
 */
function isWebsdkRequest(entry) {
  if (!entry) return false;
  const params = entry.query?.params || [];
  return params.some(param => String(param.key).toLowerCase() === 'configid');
}

/**
 * Attach a WebSDK hook payload to the most recent matching request.
 * @param {number} tabId
 * @param {object} payload
 * @param {string} pageUrl
 * @param {number} hookTs
 */
function attachWebsdkPayloadToRecent(tabId, payload, pageUrl, hookTs) {
  if (!payload) return;
  const now = Date.now();
  const candidates = requests.filter(entry => entry.tabId === tabId && isWebsdkRequest(entry));
  if (!candidates.length) return;
  const filtered = candidates.filter(entry => Math.abs((hookTs || now) - (entry.timeStamp || now)) < 20000);
  if (!filtered.length) return;
  const entry = filtered.reduce((best, item) => {
    if (!best) return item;
    return (item.timeStamp || 0) > (best.timeStamp || 0) ? item : best;
  }, null);
  if (!entry) return;
  if (!shouldReplaceBody(entry.body, payload)) return;
  debugHookLog('attach: websdk recent', { tabId, id: entry.id, hookTs });
  entry.body = payload;
  if ((!entry.pageUrl || entry.pageUrl === '/') && pageUrl) entry.pageUrl = pageUrl;
  if ((!entry.pageUrl || entry.pageUrl === '/') && entry.body) {
    entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
  }
  evaluateUatForRequest(entry);
  saveState();
  api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
}

/**
 * Evaluate UAT assertions for a request entry.
 * @param {object} entry
 */
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
  const results = evaluateAssertionsForRequest(entry, config.assertions, sessionRequests, {
    global: config.global || null,
    serviceId: entry.serviceId || null
  });
  if (!results.length) {
    entry.uat = { status: 'not-applicable', results: [] };
    return;
  }
  entry.uat = {
    status: 'done',
    results
  };
}

/**
 * Stop the active session due to idle timeout.
 * @param {string} [reason='idle']
 */
function stopActiveSession(reason = 'idle') {
  const sessionId = settings.selectedSessionId || currentSessionId;
  if (!sessionId) return;
  const session = sessions.find(s => s.id === sessionId);
  if (session) session.paused = true;
  settings.selectedSessionId = null;
  currentSessionId = null;
  settings.capturePaused = true;
  idlePrompted = false;
  saveState();
  api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
  api.runtime.sendMessage({ type: 'settingsUpdated', settings });
  api.runtime.sendMessage({ type: 'sessionStopped', reason, sessionId });
}

/**
 * Trigger idle modal if no requests were captured recently.
 */
function checkForIdleSession() {
  if (settings.capturePaused) return;
  const sessionId = settings.selectedSessionId || currentSessionId;
  if (!sessionId) return;
  if (idlePrompted) return;
  if (Date.now() - lastRequestAt < IDLE_TIMEOUT_MS) return;
  idlePrompted = true;
  saveState();
  api.runtime.sendMessage({ type: 'sessionIdle', sessionId });
}

api.runtime.onInstalled?.addListener(() => {
  loadState();
});

api.runtime.onStartup?.addListener(() => {
  loadState();
  api.alarms?.create?.(IDLE_CHECK_ALARM, { periodInMinutes: 1 });
});

action?.onClicked.addListener(async () => {
  const url = api.runtime.getURL('pages/app.html');
  const tabs = await api.tabs.query({ url });
  if (tabs.length) {
    await api.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await api.tabs.create({ url });
});

/**
 * End active session if the app tab is closed.
 * @returns {Promise<void>}
 */
async function endActiveSessionIfClosed() {
  const url = api.runtime.getURL('pages/app.html');
  const tabs = await api.tabs.query({ url });
  if (tabs.length) return;
  stopActiveSession('ui-closed');
}

api.tabs.onRemoved.addListener(() => {
  endActiveSessionIfClosed();
});

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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
    const prevEnableHooks = settings.enableHooks;
    settings = { ...settings, ...message.settings };
    saveState();
    api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    if (!prevEnableHooks && settings.enableHooks) {
      const sessionId = settings.selectedSessionId || currentSessionId;
      const session = sessions.find(s => s.id === sessionId);
      if (session?.lockTabId !== null && session?.lockTabId !== undefined) {
        injectPageHooks(session.lockTabId, '', 'enable-hooks');
      }
    }
    sendResponse({ ok: true, settings });
    return true;
  }
  if (message.type === 'idleExtend') {
    lastRequestAt = Date.now();
    idlePrompted = false;
    saveState();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'idleStop') {
    stopActiveSession('idle');
    sendResponse({ ok: true });
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
    const previousId = settings.selectedSessionId || currentSessionId;
    if (previousId) {
      const previous = sessions.find(s => s.id === previousId);
      if (previous) previous.paused = true;
    }
    const session = createSession(name, site, message.lockTabId || null, !!message.uatEnabled);
    sessions.unshift(session);
    if (!sites.includes(site)) sites.unshift(site);
    currentSessionId = session.id;
    settings.selectedSessionId = session.id;
    settings.capturePaused = false;
    lastRequestAt = Date.now();
    idlePrompted = false;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    api.runtime.sendMessage({ type: 'settingsUpdated', settings });
    api.runtime.sendMessage({ type: 'sitesUpdated', sites });
    if (session.lockTabId !== null && session.lockTabId !== undefined) {
      injectPageHooks(session.lockTabId, '', 'session-start');
    }
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
    const previousLockTabId = session.lockTabId;
    if (message.name !== undefined) session.name = message.name || session.name;
    if (message.site) session.site = message.site;
    if (message.lockTabId !== undefined) session.lockTabId = message.lockTabId;
    if (message.uatEnabled !== undefined) session.uatEnabled = !!message.uatEnabled;
    saveState();
    api.runtime.sendMessage({ type: 'sessionsUpdated', sessions, currentSessionId });
    if (message.lockTabId !== undefined && session.lockTabId !== previousLockTabId) {
      if (session.lockTabId !== null && session.lockTabId !== undefined) {
        injectPageHooks(session.lockTabId, '', 'session-update');
      }
    }
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
      if (!session.paused && session.lockTabId !== null && session.lockTabId !== undefined) {
        injectPageHooks(session.lockTabId, '', 'select-session');
      }
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
      idlePrompted = false;
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
    idlePrompted = false;
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
    idlePrompted = false;
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
    idlePrompted = false;
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
    if (settings.capturePaused || !settings.selectedSessionId) {
      debugHookLog('drop: no active session', { url: message.url, requestId: message.requestId });
      sendResponse({ ok: false });
      return true;
    }
    if (!settings.enableHooks) {
      debugHookLog('drop: hooks disabled', { url: message.url, requestId: message.requestId });
      sendResponse({ ok: false });
      return true;
    }
    if (message.url && !isAllowed(message.url)) {
      debugHookLog('drop: url not allowed', { url: message.url });
      sendResponse({ ok: false });
      return true;
    }
    debugHookLog('capturedPayload', {
      url: message.url,
      requestId: message.requestId,
      hookTs: message.hookTs,
      tabId: sender?.tab?.id,
      pageUrl: message.pageUrl
    });
    if (message.requestId) cachePayload(message.requestId, message.payload, message.pageUrl || '');
    if (message.url && sender?.tab?.id !== undefined) {
      cachePayloadByUrl(sender.tab.id, message.url, message.payload, message.pageUrl || '');
      cacheHookPayload(sender.tab.id, message.url, message.payload, message.pageUrl || '', message.hookTs || 0);
    }
    if (message.requestId) attachPayloadToRequests(message.requestId, message.payload, message.pageUrl || '');
    if (message.url && sender?.tab?.id !== undefined) {
      attachPayloadToRequestsByUrl(sender.tab.id, message.url, message.payload, message.pageUrl || '');
    }
    if (message.url) {
      attachHookPayloadToRecent(message.url, sender?.tab?.id, message.payload, message.pageUrl || '', message.hookTs || 0);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'pageContext') {
    if (settings.capturePaused || !settings.selectedSessionId) {
      debugHookLog('drop: no active session (pageContext)', { url: message.url, requestId: message.requestId });
      sendResponse({ ok: false });
      return true;
    }
    if (!settings.enableHooks) {
      debugHookLog('drop: hooks disabled (pageContext)', { url: message.url, requestId: message.requestId });
      sendResponse({ ok: false });
      return true;
    }
    if (message.url && !isAllowed(message.url)) {
      debugHookLog('drop: url not allowed (pageContext)', { url: message.url });
      sendResponse({ ok: false });
      return true;
    }
    debugHookLog('pageContext', {
      url: message.url,
      requestId: message.requestId,
      hookTs: message.hookTs,
      tabId: sender?.tab?.id,
      pageUrl: message.pageUrl
    });
    if (message.requestId) cachePageContext(message.requestId, message.pageUrl || '');
    if (message.url && sender?.tab?.id !== undefined) {
      cachePageContextByUrl(sender.tab.id, message.url, message.pageUrl || '');
    }
    if (message.requestId) attachPageContextToRequests(message.requestId, message.pageUrl || '');
    if (message.url && sender?.tab?.id !== undefined) {
      attachPageContextToRequestsByUrl(sender.tab.id, message.url, message.pageUrl || '');
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'hookReady') {
    debugHookLog('hook: ready', { tabId: sender?.tab?.id });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'hookCall') {
    debugHookLog('hook: call', { tabId: sender?.tab?.id, kind: message.kind, url: message.url });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'capturedWebsdk') {
    if (!message.payload) {
      sendResponse({ ok: false });
      return true;
    }
    if (settings.capturePaused || !settings.selectedSessionId) {
      debugHookLog('drop: no active session (websdk)', { tabId: sender?.tab?.id });
      sendResponse({ ok: false });
      return true;
    }
    if (!settings.enableHooks) {
      debugHookLog('drop: hooks disabled (websdk)', { tabId: sender?.tab?.id });
      sendResponse({ ok: false });
      return true;
    }
    debugHookLog('capturedWebsdk', { tabId: sender?.tab?.id, hookTs: message.hookTs });
    const tabId = sender?.tab?.id;
    if (tabId !== undefined) {
      attachWebsdkPayloadToRecent(tabId, message.payload, message.pageUrl || '', message.hookTs || 0);
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
    if (settings.debugHooks) {
      debugHookLog('webRequest', {
        url: details.url,
        requestId: details.requestId,
        tabId: details.tabId,
        frameId: details.frameId,
        type: details.type,
        documentUrl: details.documentUrl,
        initiator: details.initiator
      });
    }

    if (details.requestBody) {
      const entry = requestIndex.get(details.requestId);
      if (entry) {
        const parsedBody = parseRawBody(details.requestBody, '');
        if (parsedBody) {
          entry.body = parsedBody;
          if (!entry.pageUrl) {
            entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
          }
        }
        if (settings.debugHooks && (!entry.body || !entry.body.parsed)) {
          debugHookLog('body missing after parse', {
            url: entry.url,
            requestId: entry.requestId,
            tabId: entry.tabId,
            documentUrl: entry.documentUrl,
            initiator: entry.initiator
          });
        }
        evaluateUatForRequest(entry);
        saveState();
        api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

api.alarms?.onAlarm?.addListener(alarm => {
  if (alarm?.name === IDLE_CHECK_ALARM) {
    debugHookLog('idle-check', { lastRequestAt, idlePrompted });
    checkForIdleSession();
  }
});

api.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = navState.get(details.tabId) || { navId: 0, pageUrl: null };
  navState.set(details.tabId, {
    navId: (existing.navId || 0) + 1,
    pageUrl: existing.pageUrl || null,
    pendingUrl: details.url,
    pendingAt: details.timeStamp || Date.now()
  });
  tabUrlCache.set(details.tabId, details.url);
  injectPageHooks(details.tabId, details.url, 'nav-committed');
});

api.webNavigation.onCompleted.addListener(details => {
  if (details.frameId !== 0) return;
  const existing = navState.get(details.tabId) || { navId: 0 };
  navState.set(details.tabId, {
    navId: existing.navId || 0,
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
  Array.from(hookQueueByTabUrl.keys()).forEach(key => {
    if (key.startsWith(`${tabId}::`)) hookQueueByTabUrl.delete(key);
  });
});

const payloadCache = new Map();
const PAYLOAD_TTL_MS = 2 * 60 * 1000;

/**
 * Cache payload by requestId.
 * @param {string} requestId
 * @param {object} payload
 * @param {string} [pageUrl='']
 */
function cachePayload(requestId, payload, pageUrl = '') {
  const existing = payloadCache.get(requestId);
  payloadCache.set(requestId, {
    payload,
    pageUrl: pageUrl || existing?.pageUrl || '',
    ts: Date.now()
  });
  prunePayloadCache();
}

/**
 * Cache page context by requestId without a payload.
 * @param {string} requestId
 * @param {string} pageUrl
 */
function cachePageContext(requestId, pageUrl = '') {
  if (!requestId || !pageUrl) return;
  const existing = payloadCache.get(requestId);
  if (existing?.payload) return;
  payloadCache.set(requestId, { payload: null, pageUrl, ts: Date.now() });
  prunePayloadCache();
}
/**
 * Pull cached payload by requestId (one-time).
 * @param {string} requestId
 * @returns {object|null}
 */
function pullCachedPayload(requestId) {
  const entry = payloadCache.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.ts > PAYLOAD_TTL_MS) {
    payloadCache.delete(requestId);
    return null;
  }
  payloadCache.delete(requestId);
  return entry || null;
}

/**
 * Prune expired payload entries.
 */
function prunePayloadCache() {
  const now = Date.now();
  for (const [key, value] of payloadCache.entries()) {
    if (now - value.ts > PAYLOAD_TTL_MS) payloadCache.delete(key);
  }
}

/**
 * Cache payload by tab + URL.
 * @param {number} tabId
 * @param {string} url
 * @param {object} payload
 * @param {string} [pageUrl='']
 */
function cachePayloadByUrl(tabId, url, payload, pageUrl = '') {
  if (tabId === undefined || !url) return;
  const list = payloadCacheByUrlTab.get(tabId) || [];
  list.push({ url, payload, pageUrl, ts: Date.now() });
  payloadCacheByUrlTab.set(tabId, list);
  prunePayloadCacheByUrl(tabId);
}

function cacheHookPayload(tabId, url, payload, pageUrl = '', hookTs = 0) {
  if (tabId === undefined || !url) return;
  const key = `${tabId}::${url}`;
  const list = hookQueueByTabUrl.get(key) || [];
  list.push({ payload, pageUrl, ts: hookTs || Date.now() });
  hookQueueByTabUrl.set(key, list);
  pruneHookQueue(key);

  const urlList = hookQueueByUrl.get(url) || [];
  urlList.push({ payload, pageUrl, ts: hookTs || Date.now() });
  hookQueueByUrl.set(url, urlList);
  pruneHookQueueByUrl(url);
}

function pullHookPayload(tabId, url, timeStamp) {
  if (tabId === undefined || !url) return null;
  const key = `${tabId}::${url}`;
  const list = hookQueueByTabUrl.get(key) || [];
  if (!list.length) return null;
  const now = Date.now();
  const matchIndex = list.findIndex(entry => Math.abs((timeStamp || now) - entry.ts) < 20000);
  if (matchIndex === -1) return null;
  const [entry] = list.splice(matchIndex, 1);
  hookQueueByTabUrl.set(key, list);
  debugHookLog('pull: hookQueue tab+url', { url, tabId, hookTs: entry.ts });
  return entry;
}

function pruneHookQueue(key) {
  const list = hookQueueByTabUrl.get(key) || [];
  const now = Date.now();
  const filtered = list.filter(entry => now - entry.ts <= PAYLOAD_TTL_MS);
  hookQueueByTabUrl.set(key, filtered);
}

function pullHookPayloadByUrl(url, timeStamp) {
  if (!url) return null;
  const list = hookQueueByUrl.get(url) || [];
  if (!list.length) return null;
  const now = Date.now();
  const matchIndex = list.findIndex(entry => Math.abs((timeStamp || now) - entry.ts) < 20000);
  if (matchIndex === -1) return null;
  const [entry] = list.splice(matchIndex, 1);
  hookQueueByUrl.set(url, list);
  debugHookLog('pull: hookQueue url', { url, hookTs: entry.ts });
  return entry;
}

function pruneHookQueueByUrl(url) {
  const list = hookQueueByUrl.get(url) || [];
  const now = Date.now();
  const filtered = list.filter(entry => now - entry.ts <= PAYLOAD_TTL_MS);
  hookQueueByUrl.set(url, filtered);
}

/**
 * Cache page context by tab + URL without a payload.
 * @param {number} tabId
 * @param {string} url
 * @param {string} pageUrl
 */
function cachePageContextByUrl(tabId, url, pageUrl = '') {
  if (tabId === undefined || !url || !pageUrl) return;
  const list = payloadCacheByUrlTab.get(tabId) || [];
  const existing = list.find(entry => entry.url === url && entry.payload);
  if (existing) return;
  list.push({ url, payload: null, pageUrl, ts: Date.now() });
  payloadCacheByUrlTab.set(tabId, list);
  prunePayloadCacheByUrl(tabId);
}

/**
 * Pull cached payload for a tab + URL near a timestamp.
 * @param {number} tabId
 * @param {string} url
 * @param {number} timeStamp
 * @returns {object|null}
 */
function pullCachedPayloadByUrl(tabId, url, timeStamp) {
  if (tabId === undefined || !url) return null;
  const list = payloadCacheByUrlTab.get(tabId) || [];
  const now = Date.now();
  const matchIndex = list.findIndex(entry => entry.url === url && Math.abs((timeStamp || now) - entry.ts) < 15000);
  if (matchIndex === -1) return null;
  const [entry] = list.splice(matchIndex, 1);
  payloadCacheByUrlTab.set(tabId, list);
  return entry || null;
}

/**
 * Prune expired payload cache entries for a tab.
 * @param {number} tabId
 */
function prunePayloadCacheByUrl(tabId) {
  const list = payloadCacheByUrlTab.get(tabId) || [];
  const now = Date.now();
  const filtered = list.filter(entry => now - entry.ts <= PAYLOAD_TTL_MS);
  payloadCacheByUrlTab.set(tabId, filtered);
}

/**
 * Extract requestId query param from URL.
 * @param {string} url
 * @returns {string|null}
 */
function getRequestIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('requestId');
  } catch {
    return null;
  }
}

/**
 * Attempt to infer a page URL from known query params.
 * @param {string} url
 * @returns {string|null}
 */
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

/**
 * Attempt to infer a page URL from a request payload.
 * @param {object} body
 * @returns {string|null}
 */
function extractPageUrlFromPayload(body) {
  if (!body) return null;
  const payload = body.parsed && typeof body.parsed === 'object' ? body.parsed : null;
  if (!payload) return null;
  const candidates = [
    payload?.events?.[0]?.web?.webPageDetails?.URL,
    payload?.events?.[0]?.xdm?.web?.webPageDetails?.URL,
    payload?.xdm?.web?.webPageDetails?.URL,
    payload?.web?.webPageDetails?.URL
  ];
  const found = candidates.find(value => typeof value === 'string' && value.startsWith('http'));
  return found || null;
}

/**
 * Attach cached payload to matching requests by requestId.
 * @param {string} requestId
 * @param {object} payload
 */
function attachPayloadToRequests(requestId, payload, pageUrl = '') {
  if (!requestId) return;
  let updated = false;
  requests.forEach(entry => {
    if (!shouldReplaceBody(entry.body, payload)) return;
    const idInUrl = getRequestIdFromUrl(entry.url);
    if (idInUrl && idInUrl === requestId) {
      debugHookLog('attach: requestId match', { requestId, url: entry.url, id: entry.id });
      entry.body = payload;
      if ((!entry.pageUrl || entry.pageUrl === '/') && pageUrl) entry.pageUrl = pageUrl;
      if ((!entry.pageUrl || entry.pageUrl === '/') && entry.body) {
        entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
      }
      evaluateUatForRequest(entry);
      updated = true;
      api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
    }
  });
  if (updated) saveState();
}

/**
 * Attach cached payload to matching requests by tab and URL.
 * @param {number} tabId
 * @param {string} url
 * @param {object} payload
 */
function attachPayloadToRequestsByUrl(tabId, url, payload, pageUrl = '') {
  if (tabId === undefined || !url) return;
  let updated = false;
  requests.forEach(entry => {
    if (!shouldReplaceBody(entry.body, payload)) return;
    if (entry.tabId !== tabId) return;
    if (entry.url !== url) return;
    debugHookLog('attach: tab+url match', { url, tabId, id: entry.id });
    entry.body = payload;
    if ((!entry.pageUrl || entry.pageUrl === '/') && pageUrl) entry.pageUrl = pageUrl;
    if ((!entry.pageUrl || entry.pageUrl === '/') && entry.body) {
      entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
    }
    evaluateUatForRequest(entry);
    updated = true;
    api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
  });
  if (updated) saveState();
}

/**
 * Attach page URL context to requests by requestId.
 * @param {string} requestId
 * @param {string} pageUrl
 */
function attachPageContextToRequests(requestId, pageUrl = '') {
  if (!requestId || !pageUrl) return;
  let updated = false;
  requests.forEach(entry => {
    if (entry.pageUrl && entry.pageUrl !== '/') return;
    const idInUrl = getRequestIdFromUrl(entry.url);
    if (idInUrl && idInUrl === requestId) {
      entry.pageUrl = pageUrl;
      updated = true;
      api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
    }
  });
  if (updated) saveState();
}

/**
 * Attach page URL context to requests by tab and URL.
 * @param {number} tabId
 * @param {string} url
 * @param {string} pageUrl
 */
function attachPageContextToRequestsByUrl(tabId, url, pageUrl = '') {
  if (tabId === undefined || !url || !pageUrl) return;
  let updated = false;
  requests.forEach(entry => {
    if (entry.pageUrl && entry.pageUrl !== '/') return;
    if (entry.tabId !== tabId) return;
    if (entry.url !== url) return;
    entry.pageUrl = pageUrl;
    updated = true;
    api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
  });
  if (updated) saveState();
}

function attachHookPayloadToRecent(url, tabId, payload, pageUrl, hookTs) {
  if (!url || !payload) return;
  const now = Date.now();
  const candidates = requests.filter(entry => entry.url === url);
  if (!candidates.length) return;
  const filtered = candidates
    .filter(entry => tabId === undefined || entry.tabId === tabId)
    .filter(entry => Math.abs((hookTs || now) - (entry.timeStamp || now)) < 20000);
  if (!filtered.length) return;
  const entry = filtered.reduce((best, item) => {
    if (!best) return item;
    return (item.timeStamp || 0) > (best.timeStamp || 0) ? item : best;
  }, null);
  if (!entry) return;
  if (!shouldReplaceBody(entry.body, payload)) return;
  debugHookLog('attach: recent url match', { url, tabId, id: entry.id, hookTs });
  entry.body = payload;
  if ((!entry.pageUrl || entry.pageUrl === '/') && pageUrl) entry.pageUrl = pageUrl;
  if ((!entry.pageUrl || entry.pageUrl === '/') && entry.body) {
    entry.pageUrl = extractPageUrlFromPayload(entry.body) || entry.pageUrl;
  }
  evaluateUatForRequest(entry);
  saveState();
  api.runtime.sendMessage({ type: 'requestUpdated', request: entry });
}

/**
 * Check whether a request body is empty.
 * @param {object|null} body
 * @returns {boolean}
 */
function isBodyEmpty(body) {
  if (!body) return true;
  if (body.parsed) {
    if (Array.isArray(body.parsed?.params)) return body.parsed.params.length === 0;
    if (typeof body.parsed === 'object') return Object.keys(body.parsed).length === 0;
    return false;
  }
  if (typeof body.raw === 'string') return body.raw.length === 0;
  return false;
}

/**
 * Decide whether to replace an existing body with a hook payload.
 * @param {object|null} existing
 * @param {object|null} incoming
 * @returns {boolean}
 */
function shouldReplaceBody(existing, incoming) {
  if (!incoming) return false;
  if (isBodyEmpty(existing)) return true;
  if (!existing) return true;
  const incomingParsed = incoming.parsed && typeof incoming.parsed === 'object' ? incoming.parsed : null;
  const existingParsed = existing?.parsed && typeof existing.parsed === 'object' ? existing.parsed : null;
  if (!incomingParsed) return false;
  const incomingHasEvents = !!(incomingParsed.events || incomingParsed.xdm || incomingParsed._experience || incomingParsed.data);
  if (!incomingHasEvents) return false;
  const existingHasEvents = !!(existingParsed?.events || existingParsed?.xdm || existingParsed?._experience || existingParsed?.data);
  if (!existingHasEvents) return true;
  const existingRawLen = typeof existing?.raw === 'string' ? existing.raw.length : 0;
  const incomingRawLen = typeof incoming?.raw === 'string' ? incoming.raw.length : 0;
  return incomingRawLen > existingRawLen && incomingHasEvents;
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
api.alarms?.create?.(IDLE_CHECK_ALARM, { periodInMinutes: 1 });

/**
 * Create a new session object.
 * @param {string} name
 * @param {string} site
 * @param {number|null} lockTabId
 * @param {boolean} uatEnabled
 * @returns {object}
 */
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
