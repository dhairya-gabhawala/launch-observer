export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function formatDuration(ms) {
  if (typeof ms !== 'number') return '—';
  return `${Math.round(ms)} ms`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

export function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function toTitleCase(value) {
  if (!value) return '';
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}
