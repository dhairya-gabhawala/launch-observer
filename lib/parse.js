/**
 * Safely decode URI components without throwing.
 * @param {string} value
 * @returns {string}
 */
export function safeDecode(value) {
  if (value === undefined || value === null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Replace plus signs with spaces.
 * @param {string} value
 * @returns {string}
 */
export function decodePlus(value) {
  if (value === undefined || value === null) return '';
  return value.replace(/\+/g, ' ');
}

/**
 * Parse a URL into query params.
 * @param {string} url
 * @returns {{ raw: string, params: Array<object> }}
 */
export function parseQueryString(url) {
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

/**
 * Parse key/value pairs from a raw query or form-encoded string.
 * @param {string} raw
 * @param {boolean} plusAsSpace
 * @returns {Array<object>}
 */
export function parseKeyValuePairs(raw, plusAsSpace) {
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

/**
 * Parse a formData object into key/value params.
 * @param {object} formData
 * @returns {{ raw: string, params: Array<object> }}
 */
export function parseFormData(formData) {
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

/**
 * Parse a webRequest requestBody into a structured representation.
 * @param {object} requestBody
 * @param {string} [contentType='']
 * @returns {object|null}
 */
export function parseRawBody(requestBody, contentType = '') {
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
    const MAX_BODY_CHARS = 200000;
    if (text.length > MAX_BODY_CHARS) {
      return {
        type: 'text',
        contentType,
        raw: text.slice(0, MAX_BODY_CHARS),
        parsed: null,
        truncated: true
      };
    }
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
    if (json) {
      return {
        type: 'json',
        contentType,
        raw: text,
        parsed: json
      };
    }

    const formParsed = tryParseFormEncoded(text);
    if (formParsed) {
      return {
        type: 'form',
        contentType,
        raw: text,
        parsed: formParsed
      };
    }

    return {
      type: 'text',
      contentType,
      raw: text,
      parsed: null
    };
  }

  return null;
}

/**
 * Merge raw webRequest bytes entries into a single Uint8Array.
 * @param {Array<object>} rawEntries
 * @returns {Uint8Array}
 */
export function mergeRawBytes(rawEntries) {
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

/**
 * Decode a Uint8Array into text.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeBytes(bytes) {
  if (!bytes || !bytes.length) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Attempt to parse JSON safely.
 * @param {string} text
 * @returns {object|null}
 */
export function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Attempt to parse form-encoded text.
 * @param {string} text
 * @returns {{ raw: string, params: Array<object> }|null}
 */
export function tryParseFormEncoded(text) {
  if (!text || typeof text !== 'string') return null;
  if (!isLikelyFormEncoded(text)) return null;
  return {
    raw: text,
    params: parseKeyValuePairs(text, true)
  };
}

/**
 * Heuristic check for form-encoded content.
 * @param {string} text
 * @returns {boolean}
 */
function isLikelyFormEncoded(text) {
  if (!text.includes('=')) return false;
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) return false;
  const pairs = text.split('&').filter(Boolean);
  if (!pairs.length) return false;
  const hasPair = pairs.some(pair => pair.includes('='));
  return hasPair;
}

/**
 * Get hostname from a URL.
 * @param {string} url
 * @returns {string}
 */
export function getDomainFromUrl(url) {
  return new URL(url).hostname;
}

/**
 * Get pathname from a URL.
 * @param {string} url
 * @returns {string}
 */
export function getPathFromUrl(url) {
  const parsed = new URL(url);
  return parsed.pathname || '/';
}
