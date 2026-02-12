/**
 * Format a timestamp for display.
 * @param {number} ts
 * @returns {string}
 */
export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

/**
 * Format a duration in milliseconds.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number') return '—';
  return `${Math.round(ms)} ms`;
}

/**
 * Escape HTML entities.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape RegExp special characters.
 * @param {string} value
 * @returns {string}
 */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight a term in text with <mark>.
 * @param {string} text
 * @param {string} term
 * @returns {string}
 */
export function highlightText(text, term) {
  if (!term) return escapeHtml(text);
  const safeTerm = escapeRegExp(term);
  if (!safeTerm) return escapeHtml(text);
  const regex = new RegExp(safeTerm, 'gi');
  let lastIndex = 0;
  let result = '';
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    result += escapeHtml(text.slice(lastIndex, index));
    result += `<mark class="bg-amber-100 text-slate-900 rounded px-0.5">${escapeHtml(match[0])}</mark>`;
    lastIndex = index + match[0].length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

/**
 * Create a stable numeric hash for a string.
 * @param {string} value
 * @returns {number}
 */
export function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Convert a string to title case.
 * @param {string} value
 * @returns {string}
 */
export function toTitleCase(value) {
  if (!value) return '';
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Safely set HTML content by parsing into DOM nodes.
 * @param {Element} target
 * @param {string} html
 */
export function setHTML(target, html) {
  if (!target) return;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  target.replaceChildren(...doc.body.childNodes);
}
