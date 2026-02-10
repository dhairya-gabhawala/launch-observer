const api = window.chrome || window.browser;

function postAllowlist(allowlist, enableHooks) {
  window.postMessage({
    source: 'launch-observer',
    type: 'allowlist',
    allowlist,
    enableHooks: !!enableHooks
  }, '*');
}

async function getSettings() {
  return new Promise(resolve => {
    api.runtime.sendMessage({ type: 'getSettings' }, response => {
      resolve(response?.settings || null);
    });
  });
}

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
      payload: event.data.payload
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
