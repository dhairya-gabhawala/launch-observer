import { parseKeyValuePairs, tryParseJson } from '../parse.js';

export function resolveConditionValue(condition, request) {
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

export function getValueAtPath(obj, path) {
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
    const parts = segment.split(/\[|\]/).filter(Boolean);
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

export function countAssertionMatches(assertion, allRequests, request, evaluateCondition) {
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
