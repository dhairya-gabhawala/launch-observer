import { elements, state } from './state.js';
import { escapeHtml, hashString } from './utils.js';

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

export const DEFAULT_SERVICE_IDS = SERVICE_CATALOG.filter(service => service.default).map(service => service.id);
export const DEFAULT_ALLOWLIST = buildAllowlistFromServices(DEFAULT_SERVICE_IDS);

export function renderAllowlistServices(allowlist) {
  if (!elements.allowlistServices) return;
  const selected = new Set(getSelectedServiceIds(allowlist));
  const term = (state.allowlistServiceSearch || '').trim().toLowerCase();
  const filtered = term
    ? SERVICE_CATALOG.filter(service => {
      const haystack = [service.name, ...(service.domains || [])].join(' ').toLowerCase();
      return haystack.includes(term);
    })
    : SERVICE_CATALOG;
  const grouped = groupServicesByInitial(filtered);
  if (!Object.keys(grouped).length) {
    elements.allowlistServices.innerHTML = '<div class="rounded border p-3 text-sm text-slate-500">No services found.</div>';
    return;
  }
  elements.allowlistServices.innerHTML = `
    <nav aria-label="Service directory" class="h-full max-h-[360px] overflow-y-auto rounded border bg-white">
      <div class="sticky top-0 z-30 border-b bg-white px-3 py-2 shadow-sm">
        <input id="allowlist-services-search-inner" class="w-full border rounded bg-white px-3 py-2 text-sm" placeholder="Search services…" value="${escapeHtml(state.allowlistServiceSearch || '')}" />
      </div>
      ${Object.entries(grouped).map(([letter, services]) => `
        <div class="relative">
          <div class="sticky top-14 z-20 border-y border-t-slate-100 border-b-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-900">
            <h3 class="relative">${escapeHtml(letter)}</h3>
          </div>
          <fieldset class="border-t border-b border-slate-200">
            <legend class="sr-only">Popular services</legend>
            <ul role="list" class="divide-y divide-slate-100">
              ${services.map(service => {
                const checked = selected.has(service.id) ? 'checked' : '';
                const domainsLabel = service.domains.length > 1 ? `${service.domains[0]} +${service.domains.length - 1}` : service.domains[0];
                const domainItems = service.domains.map(domain => `
                  <div class="text-xs text-slate-500 truncate">${escapeHtml(domain)}</div>
                `).join('');
                const inputId = `service-${service.id}`;
                const descId = `service-${service.id}-description`;
                return `
                  <li class="px-3 py-4">
                    <details class="group">
                      <summary class="relative flex gap-3 cursor-pointer list-none">
                        ${renderServiceBadge(service)}
                        <div class="min-w-0 flex-1 text-sm">
                          <label for="${inputId}" class="font-medium text-slate-900">${escapeHtml(service.name)}</label>
                          <p id="${descId}" class="text-xs text-slate-500">${escapeHtml(domainsLabel)}</p>
                        </div>
                        <div class="flex h-6 shrink-0 items-center gap-2">
                          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-4 w-4 text-slate-400 transition group-open:rotate-180">
                            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" clip-rule="evenodd" />
                          </svg>
                          <div class="grid size-4 grid-cols-1">
                            <input id="${inputId}" type="checkbox" data-service-id="${service.id}" aria-describedby="${descId}" class="peer col-start-1 row-start-1 appearance-none rounded-sm border border-slate-300 bg-white checked:border-slate-900 checked:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:border-slate-300 disabled:bg-slate-100 disabled:checked:bg-slate-100 forced-colors:appearance-auto" ${checked} />
                            <svg viewBox="0 0 14 14" fill="none" class="pointer-events-none col-start-1 row-start-1 size-3.5 self-center justify-self-center stroke-white opacity-0 peer-checked:opacity-100 peer-disabled:stroke-slate-400/60">
                              <path d="M3 8L6 11L11 3.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          </div>
                        </div>
                      </summary>
                      <div class="mt-2 pl-14">
                        <div class="text-xs font-semibold text-slate-600 uppercase tracking-wide">Domains</div>
                        <div class="mt-1 space-y-1">
                          ${domainItems}
                        </div>
                      </div>
                    </details>
                  </li>
                `;
              }).join('')}
            </ul>
          </fieldset>
        </div>
      `).join('')}
    </nav>
  `;
}

export function renderAllowlistFields(entries, mappings) {
  const list = elements.allowlistFields;
  list.innerHTML = '';
  if (!entries.length) {
    list.appendChild(createAllowlistRow('', null));
    return;
  }
  entries.forEach(value => {
    const mapping = getMappingForDomain(value, mappings);
    list.appendChild(createAllowlistRow(value, mapping));
  });
}

export function createAllowlistRow(value = '', mapping = null) {
  const row = document.createElement('div');
  row.className = 'flex flex-col gap-2';
  row.setAttribute('data-mapping-row', 'true');
  const options = [
    { value: 'none', label: 'No service' },
    ...SERVICE_CATALOG.map(service => ({ value: service.id, label: service.name })),
    { value: 'custom', label: 'Custom service…' }
  ];
  const currentServiceId = mapping?.serviceId || (mapping?.customName ? 'custom' : 'none');
  row.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <input data-domain class="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm" value="${escapeHtml(value)}" placeholder="edge.adobedc.net" />
      <select data-service class="min-w-[180px] border rounded px-2 py-2 text-sm">
        ${options.map(opt => `<option value="${opt.value}" ${opt.value === currentServiceId ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
      </select>
      <button type="button" class="text-xs underline text-rose-700">Remove</button>
    </div>
    <input data-custom-name class="border rounded px-2 py-2 text-sm hidden" placeholder="Custom service name" value="${escapeHtml(mapping?.customName || '')}" />
  `;
  const removeButton = row.querySelector('button');
  const serviceSelect = row.querySelector('select[data-service]');
  const customInput = row.querySelector('input[data-custom-name]');
  const updateCustomVisibility = () => {
    if (!customInput || !serviceSelect) return;
    if (serviceSelect.value === 'custom') {
      customInput.classList.remove('hidden');
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
      customInput.value = '';
    }
  };
  if (serviceSelect) {
    serviceSelect.addEventListener('change', updateCustomVisibility);
    updateCustomVisibility();
  }
  if (removeButton) removeButton.addEventListener('click', () => {
    row.remove();
  });
  return row;
}

export function getSelectedServiceIds(allowlist) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  return SERVICE_CATALOG.filter(service => service.domains.some(domain => allowlistHasDomain(list, domain)))
    .map(service => service.id);
}

export function getCustomAllowlistEntries(allowlist) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  const selectedServiceIds = getSelectedServiceIds(list);
  const serviceDomains = buildAllowlistFromServices(selectedServiceIds);
  return list.filter(domain => !isDomainCovered(domain, serviceDomains));
}

export function buildAllowlistFromServices(serviceIds) {
  const domains = [];
  serviceIds.forEach(id => {
    const service = SERVICE_CATALOG.find(item => item.id === id);
    if (service) domains.push(...service.domains);
  });
  return dedupeDomains(domains);
}

export function dedupeDomains(domains) {
  const seen = new Set();
  return domains
    .map(domain => domain.trim())
    .filter(Boolean)
    .filter(domain => {
      const key = domain.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function allowlistHasDomain(allowlist, domain) {
  return allowlist.some(entry => domainMatches(entry, domain));
}

export function domainMatches(entry, domain) {
  const left = (entry || '').toLowerCase();
  const right = (domain || '').toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.endsWith(`.${right}`)) return true;
  if (right.endsWith(`.${left}`)) return true;
  return false;
}

export function isDomainCovered(domain, serviceDomains) {
  return serviceDomains.some(serviceDomain => domainMatches(domain, serviceDomain));
}

export function getMappingForDomain(domain, mappings) {
  const list = Array.isArray(mappings) ? mappings : [];
  return list.find(item => domainMatches(item.domain, domain)) || null;
}

export function renderServiceIcon(req) {
  const service = getServiceForDomain(req.domain);
  if (service) return renderServiceBadge(service);
  const category = getCategoryFallback(req);
  return renderCategoryBadge(category);
}

export function getServiceForDomain(domain) {
  if (!domain) return null;
  const mapping = getMappingForDomain(domain, state.settings?.serviceMappings || []);
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

export function getCategoryFallback(req) {
  const domain = (req.domain || '').toLowerCase();
  const path = (req.path || '').toLowerCase();
  if (domain.includes('analytics') || path.includes('collect') || path.includes('track')) return 'analytics';
  if (domain.includes('ads') || domain.includes('adservice') || domain.includes('doubleclick') || path.includes('pixel')) return 'advertising';
  if (domain.includes('segment') || domain.includes('cdp')) return 'cdp';
  return 'other';
}

export function renderServiceBadge(service) {
  const label = service.name || service.id;
  if (service.brandColor) {
    const initials = getServiceInitials(label);
    const isWhite = isNearWhite(service.brandColor);
    const textClass = isWhite ? 'text-slate-700' : 'text-white';
    const borderClass = isWhite ? 'border border-slate-200' : 'border border-transparent';
    return `
      <span class="inline-flex h-10 w-10 items-center justify-center rounded-md p-0.5 ${borderClass} ${textClass} text-[11px] font-semibold leading-none" style="background:${service.brandColor}" title="${escapeHtml(label)}">
        ${escapeHtml(initials)}
      </span>
    `;
  }
  return renderCategoryBadge(service.category || 'other', label);
}

export function renderCategoryBadge(category, label = '') {
  const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.other;
  return `
    <span class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100" title="${escapeHtml(label || category)}">
      ${icon}
    </span>
  `;
}

export function getServiceInitials(label) {
  if (!label) return 'SR';
  const words = label.replace(/[()]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return 'SR';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function isNearWhite(hexColor) {
  const hex = String(hexColor || '').replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r > 230 && g > 230 && b > 230;
}

export function groupServicesByInitial(services) {
  const grouped = {};
  services
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(service => {
      const letter = (service.name || 'Other').slice(0, 1).toUpperCase();
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(service);
    });
  return grouped;
}

export const CATEGORY_ICONS = {
  analytics: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 text-slate-600" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 15v3m5-7v7m5-10v10" />
    </svg>
  `,
  advertising: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 text-slate-600" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 11l8-5 8 5-8 5-8-5Z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-6" />
    </svg>
  `,
  cdp: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 text-slate-600" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  `,
  other: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5 text-slate-600" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  `
};
