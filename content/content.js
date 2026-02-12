const api = window.chrome || window.browser;

/**
 * Post allowlist settings to the page context.
 * @param {Array<string>} allowlist
 * @param {boolean} enableHooks
 */
function postAllowlist(allowlist, enableHooks) {
  window.postMessage({
    source: 'launch-observer',
    type: 'allowlist',
    allowlist,
    enableHooks: !!enableHooks
  }, '*');
}

/**
 * Fetch settings from the background script.
 * @returns {Promise<object|null>}
 */
async function getSettings() {
  return new Promise(resolve => {
    api.runtime.sendMessage({ type: 'getSettings' }, response => {
      resolve(response?.settings || null);
    });
  });
}

/**
 * Inject the page hook script.
 */
function injectScript() {
  const script = document.createElement('script');
  script.src = api.runtime.getURL('content/inject.js');
  script.type = 'text/javascript';
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

window.addEventListener('message', event => {
  if (!event.data || event.data.source !== 'launch-observer-page') return;
  if (event.data.type === 'capturedPayload') {
    api.runtime.sendMessage({
      type: 'capturedPayload',
      requestId: event.data.requestId,
      url: event.data.url || '',
      payload: event.data.payload,
      hookId: event.data.hookId || '',
      hookTs: event.data.hookTs || 0,
      pageUrl: event.data.pageUrl || ''
    });
  }
  if (event.data.type === 'hookReady') {
    api.runtime.sendMessage({ type: 'hookReady' });
  }
  if (event.data.type === 'hookCall') {
    api.runtime.sendMessage({
      type: 'hookCall',
      kind: event.data.kind || '',
      url: event.data.url || ''
    });
  }
  if (event.data.type === 'capturedWebsdk') {
    api.runtime.sendMessage({
      type: 'capturedWebsdk',
      payload: event.data.payload,
      hookId: event.data.hookId || '',
      hookTs: event.data.hookTs || 0,
      pageUrl: event.data.pageUrl || ''
    });
  }
  if (event.data.type === 'pageContext') {
    api.runtime.sendMessage({
      type: 'pageContext',
      requestId: event.data.requestId,
      url: event.data.url || '',
      hookId: event.data.hookId || '',
      hookTs: event.data.hookTs || 0,
      pageUrl: event.data.pageUrl || ''
    });
  }
  if (event.data.type === 'requestAllowlist') {
    getSettings().then(settings => {
      postAllowlist(settings?.allowlist || [], settings?.enableHooks);
    });
  }
});

api.runtime.onMessage.addListener(message => {
  if (message?.type === 'settingsUpdated') {
    postAllowlist(message.settings?.allowlist || [], message.settings?.enableHooks);
  }
});

(async () => {
  injectScript();
  const settings = await getSettings();
  postAllowlist(settings?.allowlist || [], settings?.enableHooks);
})();
