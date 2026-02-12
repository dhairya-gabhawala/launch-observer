export const SERVICE_CATALOG = [
  {
    id: 'adobe-edge',
    name: 'Adobe Edge',
    category: 'analytics',
    domains: ['edge.adobedc.net'],
    brandColor: '#FF0000',
    default: true
  },
  {
    id: 'adobe-analytics',
    name: 'Adobe Analytics',
    category: 'analytics',
    domains: ['omtrdc.net', '2o7.net'],
    brandColor: '#FF0000',
    default: false
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'analytics',
    domains: ['google-analytics.com', 'analytics.google.com'],
    brandColor: '#F9AB00',
    default: false
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    category: 'advertising',
    domains: ['googleadservices.com', 'doubleclick.net'],
    brandColor: '#4285F4',
    default: false
  },
  {
    id: 'meta',
    name: 'Meta Pixel',
    category: 'advertising',
    domains: ['facebook.com', 'facebook.net'],
    brandColor: '#0668E1',
    default: false
  },
  {
    id: 'tiktok',
    name: 'TikTok Pixel',
    category: 'advertising',
    domains: ['tiktok.com', 'tiktokv.com', 'analytics.tiktok.com'],
    brandColor: '#000000',
    default: false
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Insight',
    category: 'advertising',
    domains: ['linkedin.com', 'licdn.com'],
    brandColor: '#0A66C2',
    default: false
  },
  {
    id: 'pinterest',
    name: 'Pinterest Tag',
    category: 'advertising',
    domains: ['pinterest.com', 'pinimg.com'],
    brandColor: '#E60023',
    default: false
  },
  {
    id: 'snapchat',
    name: 'Snapchat Pixel',
    category: 'advertising',
    domains: ['snapchat.com', 'sc-static.net', 'tr.snapchat.com'],
    brandColor: '#FFFC00',
    default: false
  },
  {
    id: 'x',
    name: 'X Ads',
    category: 'advertising',
    domains: ['twitter.com', 't.co', 'ads-twitter.com'],
    brandColor: '#111111',
    default: false
  },
  {
    id: 'microsoft-ads',
    name: 'Microsoft Ads (Bing)',
    category: 'advertising',
    domains: ['bat.bing.com', 'bing.com'],
    brandColor: '#008373',
    default: false
  },
  {
    id: 'baidu',
    name: 'Baidu Tongji',
    category: 'analytics',
    domains: ['baidu.com', 'hm.baidu.com'],
    brandColor: '#2932E1',
    default: false
  },
  {
    id: 'demandbase',
    name: 'Demandbase',
    category: 'advertising',
    domains: ['demandbase.com', 'tag.demandbase.com'],
    brandColor: '#1F325D',
    default: false
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    domains: ['hotjar.com', 'hotjar.io'],
    brandColor: '#FF3C00',
    default: false
  },
  {
    id: 'segment',
    name: 'Segment',
    category: 'cdp',
    domains: ['segment.com', 'segment.io'],
    brandColor: '#52BD95',
    default: false
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    domains: ['mixpanel.com'],
    brandColor: '#7F4BFF',
    default: false
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    category: 'analytics',
    domains: ['amplitude.com'],
    brandColor: '#005AF0',
    default: false
  }
];

/**
 * Compare domain entries with subdomain support.
 * @param {string} entry
 * @param {string} domain
 * @returns {boolean}
 */
export function domainMatches(entry, domain) {
  const left = (entry || '').toLowerCase();
  const right = (domain || '').toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.endsWith(`.${right}`)) return true;
  if (right.endsWith(`.${left}`)) return true;
  return false;
}

/**
 * Find the custom mapping for a domain.
 * @param {string} domain
 * @param {Array<object>} mappings
 * @returns {object|null}
 */
export function getMappingForDomain(domain, mappings) {
  const list = Array.isArray(mappings) ? mappings : [];
  return list.find(item => domainMatches(item.domain, domain)) || null;
}

/**
 * Resolve a service catalog entry for a domain.
 * @param {string} domain
 * @param {Array<object>} mappings
 * @returns {object|null}
 */
export function resolveServiceForDomain(domain, mappings = []) {
  if (!domain) return null;
  const mapping = getMappingForDomain(domain, mappings);
  if (mapping) {
    if (mapping.serviceId) {
      const mapped = SERVICE_CATALOG.find(service => service.id === mapping.serviceId);
      if (mapped) return mapped;
    }
    if (mapping.customName) {
      return {
        id: `custom-${hashString(mapping.customName)}`,
        name: mapping.customName,
        category: 'other',
        brandColor: '#0F172A'
      };
    }
  }
  return SERVICE_CATALOG.find(service => service.domains.some(serviceDomain => domainMatches(domain, serviceDomain))) || null;
}

/**
 * Resolve a service ID for a domain.
 * @param {string} domain
 * @param {Array<object>} mappings
 * @returns {string|null}
 */
export function resolveServiceIdForDomain(domain, mappings = []) {
  const service = resolveServiceForDomain(domain, mappings);
  return service ? service.id : null;
}

/**
 * Create a stable hash for IDs.
 * @param {string} value
 * @returns {string}
 */
function hashString(value) {
  let hash = 0;
  String(value || '').split('').forEach(char => {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  });
  return Math.abs(hash).toString(16);
}
