(() => {
  if (window.__launchObserverHookInstalled) return;
  window.__launchObserverHookInstalled = true;
  let allowlist = [];
  let enableHooks = false;
  let allowlistReady = false;
  let hookCounter = 0;
  const pendingPayloads = [];
  const pendingPageContext = [];
  const pendingWebsdk = [];
  const MAX_PENDING = 50;
  let hookReadySent = false;
  let alloyWrapped = false;

  /**
   * Check URL against the allowlist.
   * @param {string} url
   * @returns {boolean}
   */
  function matchesAllowlist(url) {
    if (!allowlistReady) return true;
    try {
      const domain = new URL(url).hostname;
      return allowlist.some(entry => {
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
   * Extract requestId query param from URL.
   * @param {string} url
   * @returns {string|null}
   */
  function getRequestId(url) {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get('requestId');
    } catch {
      return null;
    }
  }

  /**
   * Post captured payload back to the extension.
   * @param {string} url
   * @param {string} body
   * @param {string} [contentType='']
   */
  function enqueuePayload(url, body, contentType = '') {
    if (pendingPayloads.length >= MAX_PENDING) pendingPayloads.shift();
    pendingPayloads.push({ url, body, contentType });
  }

  function enqueuePageContext(url) {
    if (pendingPageContext.length >= MAX_PENDING) pendingPageContext.shift();
    pendingPageContext.push({ url });
  }

  function enqueueWebsdk(payload) {
    if (pendingWebsdk.length >= MAX_PENDING) pendingWebsdk.shift();
    pendingWebsdk.push(payload);
  }

  function flushPending() {
    if (!allowlistReady || !enableHooks) return;
    pendingPayloads.splice(0).forEach(item => {
      postPayload(item.url, item.body, item.contentType);
    });
    pendingPageContext.splice(0).forEach(item => {
      postPageContext(item.url);
    });
    pendingWebsdk.splice(0).forEach(payload => {
      postWebsdkPayload(payload);
    });
  }

  function postPayload(url, body, contentType = '') {
    if (!enableHooks) {
      if (!allowlistReady) enqueuePayload(url, body, contentType);
      return;
    }
    const requestId = getRequestId(url);
    const hookId = `${Date.now()}-${hookCounter++}`;
    const parsed = tryParseJson(body);
    const payload = {
      type: parsed ? 'json' : 'text',
      contentType: contentType || '',
      raw: body,
      parsed
    };
    window.postMessage({
      source: 'launch-observer-page',
      type: 'capturedPayload',
      requestId,
      url,
      payload,
      hookId,
      hookTs: Date.now(),
      pageUrl: window.location.href
    }, '*');
  }

  function postPageContext(url) {
    if (!enableHooks) {
      if (!allowlistReady) enqueuePageContext(url);
      return;
    }
    const requestId = getRequestId(url);
    const hookId = `${Date.now()}-${hookCounter++}`;
    window.postMessage({
      source: 'launch-observer-page',
      type: 'pageContext',
      requestId,
      url,
      hookId,
      hookTs: Date.now(),
      pageUrl: window.location.href
    }, '*');
  }

  function postWebsdkPayload(payload) {
    if (!enableHooks) {
      if (!allowlistReady) enqueueWebsdk(payload);
      return;
    }
    let raw = '';
    try {
      raw = JSON.stringify(payload || {});
    } catch {
      raw = '';
    }
    const parsed = tryParseJson(raw) || (payload && typeof payload === 'object' ? payload : null);
    const hookId = `${Date.now()}-${hookCounter++}`;
    window.postMessage({
      source: 'launch-observer-page',
      type: 'capturedWebsdk',
      payload: {
        type: 'json',
        contentType: 'application/json',
        raw,
        parsed
      },
      hookId,
      hookTs: Date.now(),
      pageUrl: window.location.href
    }, '*');
  }

  function postHookReady() {
    if (hookReadySent) return;
    hookReadySent = true;
    window.postMessage({ source: 'launch-observer-page', type: 'hookReady' }, '*');
  }

  function postHookCall(kind, url) {
    if (!enableHooks && allowlistReady) return;
    window.postMessage({
      source: 'launch-observer-page',
      type: 'hookCall',
      kind,
      url
    }, '*');
  }

  function wrapAlloy() {
    if (alloyWrapped) return;
    const original = window.alloy;
    if (typeof original !== 'function') return;
    if (original.__launchObserverWrapped) {
      alloyWrapped = true;
      return;
    }
    const wrapped = function(...args) {
      try {
        const command = args[0];
        if (command === 'sendEvent' && args[1] && typeof args[1] === 'object') {
          postWebsdkPayload(args[1]);
        }
      } catch {}
      return original.apply(this, args);
    };
    wrapped.__launchObserverWrapped = true;
    try {
      Object.defineProperty(wrapped, 'name', { value: 'alloy', configurable: true });
    } catch {}
    window.alloy = wrapped;
    alloyWrapped = true;
  }

  /**
   * Convert request body into text when possible.
   * @param {any} body
   * @returns {Promise<string>}
   */
  function bodyToText(body) {
    if (body == null) return Promise.resolve('');
    if (typeof body === 'string') return Promise.resolve(body);
    if (body instanceof URLSearchParams) return Promise.resolve(body.toString());
    if (body instanceof FormData) {
      const params = new URLSearchParams();
      for (const [key, value] of body.entries()) {
        params.append(key, typeof value === 'string' ? value : '[file]');
      }
      return Promise.resolve(params.toString());
    }
    if (body instanceof Blob) {
      return body.text();
    }
    if (body instanceof ArrayBuffer) {
      return Promise.resolve(new TextDecoder().decode(new Uint8Array(body)));
    }
    if (ArrayBuffer.isView(body)) {
      return Promise.resolve(new TextDecoder().decode(new Uint8Array(body.buffer)));
    }
    if (body instanceof ReadableStream) {
      try {
        return new Response(body).text();
      } catch {
        return Promise.resolve('');
      }
    }
    try {
      return Promise.resolve(JSON.stringify(body));
    } catch {
      return Promise.resolve('');
    }
  }

  /**
   * Attempt to parse JSON safely.
   * @param {string} text
   * @returns {object|null}
   */
  function tryParseJson(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    try {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      postHookCall('fetch', url);
      const initHeaders = init && init.headers ? init.headers : null;
      const headerLookup = headerObj => {
        if (!headerObj) return '';
        if (headerObj instanceof Headers) return headerObj.get('content-type') || '';
        if (Array.isArray(headerObj)) {
          const found = headerObj.find(([k]) => String(k).toLowerCase() === 'content-type');
          return found ? found[1] : '';
        }
        return headerObj['Content-Type'] || headerObj['content-type'] || '';
      };
      const contentType = headerLookup(initHeaders) || (request ? request.headers.get('content-type') : '');
      let body = (init && init.body !== undefined) ? init.body : null;
      if (body instanceof ReadableStream && typeof body.tee === 'function') {
        const [streamA, streamB] = body.tee();
        body = streamA;
        init.body = streamB;
      }
      if (body) {
        bodyToText(body).then(text => {
          if (text) {
            postPayload(url, text, contentType);
          } else {
            postPageContext(url);
          }
        });
      } else if (request) {
        try {
          request.clone().text().then(text => {
            if (text) {
              postPayload(url, text, contentType);
            } else {
              postPageContext(url);
            }
          });
        } catch {}
      } else {
        postPageContext(url);
      }
    } catch {}
    return originalFetch.apply(this, arguments);
  };

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (originalSendBeacon) {
    navigator.sendBeacon = function(url, data) {
      try {
        postHookCall('beacon', url);
        bodyToText(data).then(text => {
          if (text) {
            postPayload(url, text, '');
          } else {
            postPageContext(url);
          }
        });
      } catch {}
      return originalSendBeacon(url, data);
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__lo_url = url;
    this.__lo_headers = {};
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try {
      this.__lo_headers[name.toLowerCase()] = value;
    } catch {}
    return originalSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    try {
      if (this.__lo_url && body) {
        postHookCall('xhr', this.__lo_url);
        bodyToText(body).then(text => {
          const contentType = this.__lo_headers?.['content-type'] || '';
          if (text) {
            postPayload(this.__lo_url, text, contentType);
          } else {
            postPageContext(this.__lo_url);
          }
        });
      } else if (this.__lo_url) {
        postHookCall('xhr', this.__lo_url);
        postPageContext(this.__lo_url);
      }
    } catch {}
    return originalSend.apply(this, arguments);
  };

  window.addEventListener('message', event => {
    if (!event.data || event.data.source !== 'launch-observer' || event.data.type !== 'allowlist') return;
    allowlist = Array.isArray(event.data.allowlist) ? event.data.allowlist : [];
    enableHooks = !!event.data.enableHooks;
    allowlistReady = true;
    flushPending();
  });

  window.postMessage({ source: 'launch-observer-page', type: 'requestAllowlist' }, '*');
  postHookReady();
  wrapAlloy();

  let alloyChecks = 0;
  const alloyTimer = setInterval(() => {
    if (alloyWrapped) {
      clearInterval(alloyTimer);
      return;
    }
    wrapAlloy();
    alloyChecks += 1;
    if (alloyChecks > 40) {
      clearInterval(alloyTimer);
    }
  }, 500);
})();
