import { elements, state } from './state.js';
import { escapeHtml, formatDuration, formatTime, hashString, toTitleCase, highlightText } from './utils.js';
import { renderServiceIcon } from './allowlist.js';
import { bindPayloadActions, highlightJson, renderJson, tryParseFormEncoded, tryParseJsonString } from './payload.js';
import { setActiveTab, toggleSidebar } from './ui.js';

export function applySearch() {
  const term = state.search.toLowerCase();
  const sessionId = state.settings?.selectedSessionId;
  const scoped = sessionId ? state.requests.filter(r => r.sessionId === sessionId) : [...state.requests];
  if (!term) {
    state.filtered = scoped;
  } else {
    state.filtered = scoped.filter(req => {
      const haystack = [req.domain, req.path, req.url, JSON.stringify(req.query), JSON.stringify(req.body)].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }
  state.filtered.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));
  renderList();
}

export function renderList() {
  const list = elements.requestList;
  if (!list) return;

  if (!state.filtered.length) {
    list.innerHTML = '<div class="p-4 text-sm text-slate-500">No matching requests yet.</div>';
  } else {
    const groups = groupRequestsByPageSessions(state.filtered)
      .sort((a, b) => (b.items[0]?.timeStamp || 0) - (a.items[0]?.timeStamp || 0));
    list.innerHTML = groups.map(group => {
      const count = group.items.length;
      const groupId = `group-${hashString(group.key)}`;
      const rows = [...group.items].sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0)).map(req => {
        const active = req.id === state.selectedId ? 'bg-slate-50' : 'bg-white';
        const status = req.statusCode ? `<span class="text-xs text-emerald-600">${req.statusCode}</span>` : '<span class="text-xs text-slate-400">pending</span>';
        const eventLabel = getEventTypeLabel(req);
        const icon = renderServiceIcon(req);
        const description = getRequestDescription(req, eventLabel);
        return `
          <button class="w-full text-left px-4 py-3 border-b hover:bg-slate-50 ${active}" data-request-id="${req.id}">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-2 min-w-0">
                <div class="flex-shrink-0">${icon}</div>
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate">${req.domain}</div>
                  <div class="text-xs text-slate-500 truncate">${description}</div>
                  <div class="text-xs text-slate-400">${formatTime(req.timeStamp)}</div>
                </div>
              </div>
              ${status}
            </div>
          </button>
        `;
      }).join('');
      return `
        <details class="border-b" open>
          <summary class="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span class="truncate">${escapeHtml(group.title)}</span>
            <span class="text-slate-400">${group.subtitle}</span>
            <span class="text-slate-400">${count}</span>
          </summary>
          <div id="${groupId}">
            ${rows}
          </div>
        </details>
      `;
    }).join('');
  }

  elements.requestCount.textContent = `${state.filtered.length} request${state.filtered.length === 1 ? '' : 's'}`;

  list.querySelectorAll('button[data-request-id]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-request-id');
      selectRequest(id);
      if (window.innerWidth < 1024) toggleSidebar(false);
    });
  });
}

export function renderKeyValueTable(params, searchTerm = '') {
  if (!params || !params.length) {
    return '<div class="text-slate-500 text-sm">None</div>';
  }
  const rows = params.map(({ key, value }) => {
    return `
      <div class="grid grid-cols-12 gap-3 border-b px-3 py-2">
        <div class="col-span-5 text-xs font-semibold text-slate-700 break-words">${highlightText(String(key), searchTerm)}</div>
        <div class="col-span-7 text-xs text-slate-600 break-words">${highlightText(String(value), searchTerm)}</div>
      </div>
    `;
  }).join('');
  return `<div class="rounded border bg-white">${rows}</div>`;
}

export function selectRequest(id) {
  state.selectedId = id;
  const req = state.requests.find(item => item.id === id);
  if (!req) return;

  elements.emptyState.classList.add('hidden');
  elements.observingState.classList.add('hidden');
  elements.details.classList.remove('hidden');
  elements.detailDomain.textContent = req.domain || '';
  elements.detailUrl.textContent = req.url || '';

  elements.detailMeta.innerHTML = [
    `Method: ${req.method || ''}`,
    `Status: ${req.statusCode || 'pending'}`,
    `Duration: ${formatDuration(req.duration)}`
  ].map(item => `<span>${escapeHtml(item)}</span>`).join('');

  const queryParams = req.query?.params || [];
  if (queryParams.length) {
    elements.detailQuery.innerHTML = renderKeyValueTable(queryParams, state.querySearch);
    if (elements.queryTools) elements.queryTools.classList.remove('hidden');
    if (elements.querySearch) elements.querySearch.value = state.querySearch;
    scrollFirstMatch(elements.detailQuery);
  } else {
    elements.detailQuery.innerHTML = '<div class="text-slate-500 text-sm">None</div>';
    if (elements.queryTools) elements.queryTools.classList.add('hidden');
  }
  if (elements.payloadSearch) elements.payloadSearch.value = state.payloadSearch;

  if (!req.body) {
    elements.detailPayload.innerHTML = '<div class="text-slate-500 text-sm">No payload</div>';
    if (elements.payloadTools) elements.payloadTools.classList.add('hidden');
  } else if (req.body.type === 'json' && req.body.parsed) {
    elements.detailPayload.innerHTML = renderJson(req.body.parsed, state.payloadSearch);
    if (elements.payloadTools) elements.payloadTools.classList.remove('hidden');
    if (elements.payloadExpandTools) elements.payloadExpandTools.classList.remove('hidden');
    scrollFirstMatch(elements.detailPayload);
  } else if ((req.body.type === 'form' || req.body.type === 'formData') && req.body.parsed) {
    elements.detailPayload.innerHTML = renderKeyValueTable(req.body.parsed.params || [], state.payloadSearch);
    if (elements.payloadTools) elements.payloadTools.classList.remove('hidden');
    if (elements.payloadExpandTools) elements.payloadExpandTools.classList.add('hidden');
    scrollFirstMatch(elements.detailPayload);
  } else if (req.body.type === 'text' && req.body.raw) {
    const parsed = tryParseJsonString(req.body.raw);
    if (parsed) {
      elements.detailPayload.innerHTML = renderJson(parsed, state.payloadSearch);
      if (elements.payloadTools) elements.payloadTools.classList.remove('hidden');
      if (elements.payloadExpandTools) elements.payloadExpandTools.classList.remove('hidden');
      scrollFirstMatch(elements.detailPayload);
    } else {
      const formParsed = tryParseFormEncoded(req.body.raw);
      if (formParsed) {
        elements.detailPayload.innerHTML = renderKeyValueTable(formParsed.params || [], state.payloadSearch);
        if (elements.payloadTools) elements.payloadTools.classList.remove('hidden');
        if (elements.payloadExpandTools) elements.payloadExpandTools.classList.add('hidden');
        scrollFirstMatch(elements.detailPayload);
      } else {
        elements.detailPayload.innerHTML = `<pre class="text-xs whitespace-pre-wrap rounded border bg-slate-50 p-3">${escapeHtml(req.body.raw || '')}</pre>`;
        if (elements.payloadTools) elements.payloadTools.classList.add('hidden');
      }
    }
  } else {
    elements.detailPayload.innerHTML = `<pre class="text-xs whitespace-pre-wrap rounded border bg-slate-50 p-3">${escapeHtml(req.body.raw || '')}</pre>`;
    if (elements.payloadTools) elements.payloadTools.classList.add('hidden');
  }

  if (req.requestHeaders && req.requestHeaders.length) {
    const headerRows = req.requestHeaders.map(h => ({ key: h.name, value: h.value || '' }));
    elements.detailHeaders.innerHTML = renderKeyValueTable(headerRows);
  } else {
    elements.detailHeaders.innerHTML = '<div class="text-slate-500 text-sm">No headers captured</div>';
  }

  const rawParts = [
    `URL: ${req.url}`,
    req.query?.raw ? `Query: ${req.query.raw}` : '',
    req.body?.raw ? `Body: ${req.body.raw}` : ''
  ].filter(Boolean).join('\n\n');

  elements.detailRaw.textContent = rawParts;
  if (req.body?.type === 'json' && req.body?.raw) {
    elements.detailRaw.innerHTML = highlightJson(req.body.raw);
  } else {
    elements.detailRaw.textContent = rawParts;
  }
  bindPayloadActions();
  if (state.activeTab) {
    setActiveTab(state.activeTab);
  }
  renderList();
}

function scrollFirstMatch(container) {
  if (!container) return;
  const mark = container.querySelector('mark');
  if (!mark) return;
  requestAnimationFrame(() => {
    mark.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

export function extractPayloadJson(req) {
  if (!req || !req.body) return null;
  if (req.body.parsed && typeof req.body.parsed === 'object') return req.body.parsed;
  if (typeof req.body.raw === 'string') {
    return tryParseJsonString(req.body.raw);
  }
  return null;
}

export function getEventTypeLabel(req) {
  const payload = extractPayloadJson(req);
  const eventType = payload?.events?.[0]?.xdm?.eventType || payload?.xdm?.eventType;
  if (!eventType) return '';
  const last = eventType.split('.').pop() || eventType;
  return toTitleCase(last);
}

export function getRequestDescription(req, eventLabel) {
  const contextLabel = getAdobeAnalyticsContext(req);
  if (contextLabel) {
    return `${req.method} · ${contextLabel}${eventLabel ? ` · ${eventLabel}` : ''}`;
  }
  return `${req.method} · ${req.path}${eventLabel ? ` · ${eventLabel}` : ''}`;
}

export function getAdobeAnalyticsContext(req) {
  if (!req?.path) return '';
  if (!req.path.startsWith('/b/ss/')) return '';
  const segments = req.path.split('/').filter(Boolean);
  if (segments.length < 3) return '';
  const rsids = segments[2] || '';
  const version = segments[4] || '';
  const rsidLabel = rsids ? `Report Suites: ${rsids.split(',').join(', ')}` : '';
  const versionLabel = version ? `Library: ${version}` : '';
  return [rsidLabel, versionLabel].filter(Boolean).join(' · ');
}

export function groupRequestsByPageSessions(requests) {
  const sorted = [...requests].sort((a, b) => (a.timeStamp || 0) - (b.timeStamp || 0));
  const groups = [];
  let current = null;

  sorted.forEach(req => {
    const pageUrl = req.pageUrl || req.url || req.path || '/';
    const navKey = req.navId ? `${pageUrl}::${req.navId}` : pageUrl;
    const newGroup = !current || current.key !== navKey;

    if (newGroup) {
      const displayUrl = pageUrl || req.url || req.path || '/';
      const title = getPathFromUrlSafe(displayUrl);
      const subtitle = formatTime(req.timeStamp);
      current = {
        key: navKey,
        title,
        subtitle,
        items: []
      };
      groups.push(current);
    }
    current.items.push(req);
  });
  return groups.reverse();
}

export function getPathFromUrlSafe(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return url || '/';
  }
}
