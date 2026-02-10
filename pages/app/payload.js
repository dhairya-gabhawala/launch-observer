import { elements, state } from './state.js';
import { escapeHtml, highlightText } from './utils.js';
import { toast } from './ui.js';

export function renderJson(value, searchTerm = '') {
  if (value === null || value === undefined) {
    return `<span class="text-slate-400">null</span>`;
  }
  if (typeof value !== 'object') {
    return `<span class="text-slate-700">${highlightText(String(value), searchTerm)}</span>`;
  }

  return `
    <div class="rounded border bg-white overflow-hidden">
      ${renderJsonTree(value, '', 0, searchTerm)}
    </div>
  `;
}

export function renderJsonTree(value, path = '', depth = 0, searchTerm = '') {
  if (value === null || value === undefined) {
    return `<div class="px-3 py-2 text-xs text-slate-500">null</div>`;
  }
  if (typeof value !== 'object') {
    return `<div class="px-3 py-2 text-xs text-slate-700">${highlightText(String(value), searchTerm)}</div>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return `<div class="px-3 py-2 text-xs text-slate-500">[]</div>`;
    }
    return value.map((item, idx) => {
      const childPath = `${path}[${idx}]`;
      const { html, matched } = renderNode(item, childPath, depth + 1, searchTerm, `[${idx}]`);
      const open = shouldOpenNode(depth, searchTerm, matched);
      return `
        <details class="border-b last:border-b-0 px-2 py-1 text-xs" ${open ? 'open' : ''}>
          <summary class="cursor-pointer text-slate-700 font-semibold">[${idx}]</summary>
          <div class="ml-3 mt-1">${html}</div>
        </details>
      `;
    }).join('');
  }

  const entries = Object.entries(value);
  if (!entries.length) {
    return `<div class="px-3 py-2 text-xs text-slate-500">{}</div>`;
  }
  return entries.map(([key, val]) => {
    const childPath = path ? `${path}.${key}` : key;
    const { html, matched, inline } = renderNode(val, childPath, depth + 1, searchTerm, key);
    if (inline) {
      return html;
    }
    const open = shouldOpenNode(depth, searchTerm, matched);
    return `
      <details class="border-b last:border-b-0 px-2 py-1 text-xs" ${open ? 'open' : ''}>
        <summary class="cursor-pointer text-slate-700 font-semibold">${highlightText(key, searchTerm)}</summary>
        <div class="ml-3 mt-1">${html}</div>
      </details>
    `;
  }).join('');
}

export function renderNode(value, path, depth, searchTerm, label) {
  const matches = searchTerm ? nodeMatches(value, path, searchTerm) : false;
  if (value === null || value === undefined || typeof value !== 'object') {
    const display = String(value);
    const inline = `
      <div class="border-b last:border-b-0 px-2 py-1 text-xs flex items-center justify-between gap-2">
        <div class="min-w-0">
          <span class="text-slate-700 font-semibold">${highlightText(label, searchTerm)}</span>
          <span class="text-slate-400">: </span>
          <span class="text-slate-600 break-words">${highlightText(display, searchTerm)}</span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 hover:bg-slate-100" data-copy-value="${escapeHtml(display)}" title="Copy value">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="h-3.5 w-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            Copy Value
          </button>
          <button class="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 hover:bg-slate-100" data-copy-path="${escapeHtml(path)}" title="Copy path">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="h-3.5 w-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
            </svg>
            Copy Path
          </button>
        </div>
      </div>
    `;
    return { html: inline, matched: matches, inline: true };
  }
  if (Array.isArray(value) && value.length === 0) {
    const inline = `
      <div class="border-b last:border-b-0 px-2 py-1 text-xs">
        <span class="text-slate-700 font-semibold">${escapeHtml(label)}</span>
        <span class="text-slate-400">: </span>
        <span class="text-slate-500">[]</span>
      </div>
    `;
    return { html: inline, matched: matches, inline: true };
  }
  const html = renderJsonTree(value, path, depth, searchTerm);
  return { html, matched: matches, inline: false };
}

export function doesMatch(value, path, term) {
  const lower = term.toLowerCase();
  if (path.toLowerCase().includes(lower)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return String(value).toLowerCase().includes(lower);
  return false;
}

export function nodeMatches(value, path, term) {
  if (doesMatch(value, path, term)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item, idx) => nodeMatches(item, `${path}[${idx}]`, term));
  }
  return Object.entries(value).some(([key, val]) => nodeMatches(val, path ? `${path}.${key}` : key, term));
}

export function shouldOpenNode(depth, searchTerm, matched) {
  if (searchTerm) return matched;
  if (state.payloadExpand === 'all') return true;
  if (state.payloadExpand === 'none') return false;
  if (state.payloadExpand === 'level2') return depth <= 2;
  return depth <= 1;
}

export function bindPayloadActions() {
  const container = elements.detailPayload;
  if (!container) return;
  container.querySelectorAll('[data-copy-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.getAttribute('data-copy-path') || '');
      toast('Path copied');
    });
  });
  container.querySelectorAll('[data-copy-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.getAttribute('data-copy-value') || '');
      toast('Value copied');
    });
  });
}

export function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
  }
}

export function tryParseJsonString(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function tryParseFormEncoded(text) {
  if (!text || typeof text !== 'string') return null;
  if (!text.includes('=')) return null;
  const params = text.split('&').filter(Boolean).map(pair => {
    const idx = pair.indexOf('=');
    const rawKey = idx === -1 ? pair : pair.slice(0, idx);
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1);
    const key = safeDecode(decodePlus(rawKey));
    const value = safeDecode(decodePlus(rawValue));
    return { rawKey, rawValue, key, value };
  });
  return params.length ? { raw: text, params } : null;
}

export function safeDecode(value) {
  if (value === undefined || value === null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function decodePlus(value) {
  if (value === undefined || value === null) return '';
  return value.replace(/\+/g, ' ');
}

export function highlightJson(text) {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    return syntaxHighlight(pretty);
  } catch {
    return escapeHtml(text);
  }
}

export function syntaxHighlight(json) {
  const escaped = escapeHtml(json);
  return escaped.replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g, match => {
    if (match.startsWith('"') && match.endsWith('"') && match.includes(':') === false) {
      return `<span class="token string">${match}</span>`;
    }
    if (match.startsWith('"') && match.endsWith('"') && match.includes(':')) {
      return `<span class="token key">${match}</span>`;
    }
    if (match === 'true' || match === 'false') {
      return `<span class="token boolean">${match}</span>`;
    }
    if (match === 'null') {
      return `<span class="token null">${match}</span>`;
    }
    return `<span class="token number">${match}</span>`;
  });
}
