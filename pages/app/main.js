import { api, elements, state } from './state.js';
import { DEFAULT_ALLOWLIST, buildAllowlistFromServices, createAllowlistRow, dedupeDomains, getCustomAllowlistEntries, renderAllowlistFields, renderAllowlistServices } from './allowlist.js';
import { applySearch, selectRequest } from './requests.js';
import { deleteSession, getSelectedSite, getSelectedTabId, openSessionDialog, renderSessions, selectSession, updateSessionSummary, updateUatToggle } from './sessions.js';
import { setActiveTab, toggleSidebar, toast } from './ui.js';
import { initTour } from './tour.js';
import { buildTemplateDownload, closeUatDetail, exportUatPdf, openUatReport, closeUatDrawer } from './uat.js';
import { escapeHtml, setHTML } from './utils.js';
import { validateUatConfig } from '../../lib/uat.js';

let pendingUatConfig = null;

/**
 * Update persisted settings via background.
 * @param {object} patch
 */
function updateSettings(patch) {
  if (!state.settings) return;
  const next = { ...state.settings, ...patch };
  api.runtime.sendMessage({ type: 'setSettings', settings: next }, response => {
    if (response?.settings) {
      state.settings = response.settings;
    }
  });
}

/**
 * Refresh local state from background storage.
 */
function refreshState() {
  api.runtime.sendMessage({ type: 'getState' }, response => {
    if (!response) return;
    state.settings = response.settings;
    state.requests = response.requests || [];
    state.sessions = response.sessions || [];
    state.currentSessionId = response.currentSessionId || null;
    state.sites = response.sites || [];
    state.uatConfigs = response.uatConfigs || {};
    applySearch();
    renderSessions();
    if (state.selectedId) selectRequest(state.selectedId);
    if (state.settings?.selectedSessionId) {
      elements.observingState.classList.remove('hidden');
      elements.emptyState.classList.add('hidden');
    }
    updateDebugBadge();
    updateSessionSummary();
  });
}

if (elements.openSidebar) elements.openSidebar.addEventListener('click', () => toggleSidebar(true));
if (elements.closeSidebar) elements.closeSidebar.addEventListener('click', () => toggleSidebar(false));
if (elements.mobileOverlay) elements.mobileOverlay.addEventListener('click', () => toggleSidebar(false));

if (elements.search) {
  elements.search.addEventListener('input', event => {
    state.search = event.target.value || '';
    applySearch();
  });
}

if (elements.manageAllowlist) {
  elements.manageAllowlist.addEventListener('click', () => {
    const allowlist = Array.isArray(state.settings?.allowlist) ? state.settings.allowlist : DEFAULT_ALLOWLIST;
    renderAllowlistServices(allowlist);
    renderAllowlistFields(getCustomAllowlistEntries(allowlist), state.settings?.serviceMappings || []);
    if (elements.enableHooks) {
      elements.enableHooks.checked = !!state.settings?.enableHooks;
    }
    state.allowlistServiceSearch = '';
    elements.allowlistDialog.showModal();
  });
}

if (elements.manageUat) {
  elements.manageUat.addEventListener('click', () => {
    const sites = Array.from(new Set(state.sites.filter(Boolean))).sort();
    if (elements.uatSiteSelect) {
      setHTML(elements.uatSiteSelect, sites.map(site => `<option value="${site}">${site}</option>`).join('') || '<option value=\"\">Select a site</option>');
      const currentSite = state.sessions.find(s => s.id === state.settings?.selectedSessionId)?.site;
      if (currentSite && sites.includes(currentSite)) elements.uatSiteSelect.value = currentSite;
    }
    if (elements.uatSiteInput) {
      elements.uatSiteInput.classList.add('hidden');
      elements.uatSiteInput.value = '';
    }
    if (elements.uatDialog) elements.uatDialog.showModal();
  });
}

if (elements.uatCancel) {
  elements.uatCancel.addEventListener('click', () => {
    pendingUatConfig = null;
    if (elements.uatFileInput) elements.uatFileInput.value = '';
    if (elements.uatFileStatus) {
      elements.uatFileStatus.textContent = '';
      elements.uatFileStatus.classList.add('hidden');
    }
    if (elements.uatFileErrors) {
      elements.uatFileErrors.textContent = '';
      elements.uatFileErrors.classList.add('hidden');
    }
    elements.uatDialog?.close();
  });
}

if (elements.uatDownloadTemplate) {
  elements.uatDownloadTemplate.addEventListener('click', () => {
    buildTemplateDownload();
  });
}

if (elements.uatFileInput) {
  elements.uatFileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      pendingUatConfig = JSON.parse(text);
      const errors = validateUatConfig(pendingUatConfig);
      if (errors.length) {
        pendingUatConfig = null;
        if (elements.uatFileErrors) {
          elements.uatFileErrors.textContent = errors.join(' ');
          elements.uatFileErrors.classList.remove('hidden');
        }
        if (elements.uatFileStatus) {
          elements.uatFileStatus.textContent = 'UAT file failed validation.';
          elements.uatFileStatus.classList.remove('hidden');
          elements.uatFileStatus.classList.remove('text-emerald-600');
          elements.uatFileStatus.classList.add('text-rose-600');
        }
      } else if (elements.uatFileStatus) {
        elements.uatFileStatus.textContent = 'UAT file ready. Click Import to apply.';
        elements.uatFileStatus.classList.remove('hidden');
        elements.uatFileStatus.classList.remove('text-rose-600');
        elements.uatFileStatus.classList.add('text-emerald-600');
        if (elements.uatFileErrors) {
          elements.uatFileErrors.textContent = '';
          elements.uatFileErrors.classList.add('hidden');
        }
      }
    } catch {
      pendingUatConfig = null;
      toast('Invalid JSON file', 'Please upload a valid assertion config.');
      if (elements.uatFileStatus) {
        elements.uatFileStatus.textContent = 'Invalid JSON file. Please upload a valid assertion config.';
        elements.uatFileStatus.classList.remove('hidden');
        elements.uatFileStatus.classList.remove('text-emerald-600');
        elements.uatFileStatus.classList.add('text-rose-600');
      }
      if (elements.uatFileErrors) {
        elements.uatFileErrors.textContent = '';
        elements.uatFileErrors.classList.add('hidden');
      }
    }
  });
}

if (elements.uatImport) {
  elements.uatImport.addEventListener('click', () => {
    const site = getUatSelectedSite();
    if (!site) {
      toast('Select a site first');
      return;
    }
    if (!pendingUatConfig) {
      toast('No file selected', 'Choose a JSON file first.');
      return;
    }
    const errors = validateUatConfig(pendingUatConfig);
    if (errors.length) {
      if (elements.uatFileErrors) {
        elements.uatFileErrors.textContent = errors.join(' ');
        elements.uatFileErrors.classList.remove('hidden');
      }
      if (elements.uatFileStatus) {
        elements.uatFileStatus.textContent = 'UAT file failed validation.';
        elements.uatFileStatus.classList.remove('hidden');
        elements.uatFileStatus.classList.remove('text-emerald-600');
        elements.uatFileStatus.classList.add('text-rose-600');
      }
      return;
    }
    if (!state.sites.includes(site)) {
      state.sites = [site, ...state.sites];
      api.runtime.sendMessage({ type: 'sitesUpdated', sites: state.sites });
    }
    api.runtime.sendMessage({ type: 'setUatConfig', site, config: pendingUatConfig }, response => {
      if (response?.uatConfigs) {
        state.uatConfigs = response.uatConfigs;
        toast('UAT assertions updated', `Loaded ${pendingUatConfig.assertions?.length || 0} assertions.`);
        pendingUatConfig = null;
        if (elements.uatFileInput) elements.uatFileInput.value = '';
        if (elements.uatFileStatus) {
          elements.uatFileStatus.textContent = '';
          elements.uatFileStatus.classList.add('hidden');
        }
        if (elements.uatFileErrors) {
          elements.uatFileErrors.textContent = '';
          elements.uatFileErrors.classList.add('hidden');
        }
        if (elements.uatSiteInput) {
          elements.uatSiteInput.classList.add('hidden');
          elements.uatSiteInput.value = '';
        }
        if (elements.uatSiteSelect) {
          const sites = Array.from(new Set(state.sites.filter(Boolean))).sort();
          setHTML(elements.uatSiteSelect, sites.map(value => `<option value="${value}">${value}</option>`).join('') || '<option value=\"\">Select a site</option>');
          if (site) elements.uatSiteSelect.value = site;
        }
        if (elements.uatDialog) elements.uatDialog.close();
      } else {
        toast('Failed to update UAT assertions');
      }
    });
  });
}

if (elements.uatSiteNew) {
  elements.uatSiteNew.addEventListener('click', () => {
    if (!elements.uatSiteInput) return;
    elements.uatSiteInput.classList.toggle('hidden');
    if (!elements.uatSiteInput.classList.contains('hidden')) {
      elements.uatSiteInput.focus();
    }
  });
}

/**
 * Resolve selected site in the UAT modal.
 * @returns {string}
 */
function getUatSelectedSite() {
  const custom = elements.uatSiteInput && !elements.uatSiteInput.classList.contains('hidden')
    ? elements.uatSiteInput.value.trim()
    : '';
  if (custom) return custom;
  return (elements.uatSiteSelect?.value || '').trim();
}


if (elements.openUatReport) {
  elements.openUatReport.addEventListener('click', () => {
    openUatReport();
  });
}

if (elements.uatExport) {
  elements.uatExport.addEventListener('click', () => {
    exportUatPdf();
  });
}

if (elements.uatReportClose) {
  elements.uatReportClose.addEventListener('click', () => {
    elements.uatReportDialog?.close();
  });
}

if (elements.uatDetailClose) {
  elements.uatDetailClose.addEventListener('click', () => {
    closeUatDetail();
  });
}

if (elements.uatCloseDrawer) {
  elements.uatCloseDrawer.addEventListener('click', () => {
    closeUatDrawer();
  });
}

/**
 * Render the UAT assertions drawer contents.
 * @param {string} site
 * @param {object|null} config
 */
function renderUatAssertionsDrawer(site, config) {
  if (!elements.uatAssertionsBody) return;
  const assertions = config?.assertions || [];
  if (!site) {
    setHTML(elements.uatAssertionsBody, '<div class="text-sm text-slate-500">Select a site to view assertions.</div>');
    return;
  }
  if (!assertions.length) {
    setHTML(elements.uatAssertionsBody, '<div class="text-sm text-slate-500">No assertions imported for this site yet.</div>');
    return;
  }
  setHTML(elements.uatAssertionsBody, assertions.map(item => {
    const title = item.title || item.id || 'Assertion';
    const description = item.description ? `<div class="mt-1 text-xs text-slate-500">${escapeHtml(item.description)}</div>` : '';
    const scope = item.scope ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">${escapeHtml(item.scope)}</span>` : '';
    const logic = item.conditionsLogic ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">conditions: ${escapeHtml(item.conditionsLogic)}</span>` : '';
    const chips = (scope || logic) ? `<div class="mt-2 flex gap-2 flex-wrap">${scope}${logic}</div>` : '';
    const count = item.count && item.value !== undefined
      ? `<div class="mt-2 text-xs text-slate-600"><span class="font-semibold text-slate-700">Count</span> <span class="text-slate-400">•</span> ${escapeHtml(item.count)} = ${escapeHtml(String(item.value))}</div>`
      : '';
    const renderList = (list) => list.map(cond => {
      const source = escapeHtml(cond.source || 'payload');
      const path = escapeHtml(cond.path || '');
      const operator = escapeHtml(cond.operator || 'exists');
      const expected = cond.expected !== undefined ? `<span class="text-slate-500">"${escapeHtml(String(cond.expected))}"</span>` : '';
      return `
        <div class="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
          <div><span class="font-semibold">${source}</span> · <span class="text-slate-500">${path || 'raw'}</span></div>
          <div class="text-slate-600">${operator}${expected ? ` · ${expected}` : ''}</div>
        </div>
      `;
    }).join('');
    const conditions = Array.isArray(item.conditions) && item.conditions.length
      ? `<div class="mt-3">
          <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-2">Applies when</div>
          <div class="space-y-2">${renderList(item.conditions)}</div>
        </div>`
      : '';
    const validations = Array.isArray(item.validations) && item.validations.length
      ? `<div class="mt-3">
          <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-2">Validations (all must pass)</div>
          <div class="space-y-2">${renderList(item.validations)}</div>
        </div>`
      : '';
    return `
      <details class="rounded border border-slate-200 bg-white p-3 mb-3">
        <summary class="flex cursor-pointer items-center justify-between text-sm font-semibold text-slate-800">
          <span>${escapeHtml(title)}</span>
          <svg viewBox="0 0 16 16" fill="currentColor" class="size-4 text-slate-400">
            <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </summary>
        <div class="mt-2">
          ${description}
          ${chips}
          ${count}
          ${conditions}
          ${validations}
        </div>
      </details>
    `;
  }).join(''));
}

/**
 * Open the UAT assertions drawer.
 */
function openUatAssertionsDrawer() {
  const activeSite = state.sessions.find(s => s.id === state.settings?.selectedSessionId)?.site || '';
  const sites = Array.from(new Set(Object.keys(state.uatConfigs || {}))).sort();
  if (elements.uatAssertionsSite) {
    setHTML(elements.uatAssertionsSite, sites.map(value => `<option value="${value}">${value}</option>`).join('') || '<option value=\"\">Select a site</option>');
    if (activeSite && sites.includes(activeSite)) {
      elements.uatAssertionsSite.value = activeSite;
    }
  }
  const selectedSite = elements.uatAssertionsSite?.value || activeSite || '';
  const config = selectedSite ? state.uatConfigs?.[selectedSite] : null;
  if (elements.uatAssertionsMeta) {
    elements.uatAssertionsMeta.textContent = selectedSite ? `Site: ${selectedSite}` : 'No site selected';
  }
  renderUatAssertionsDrawer(selectedSite, config);
  elements.uatAssertionsDrawer?.classList.remove('translate-x-full');
  elements.uatAssertionsOverlay?.classList.remove('hidden');
  if (elements.uatAssertionsOverlay) {
    elements.uatAssertionsOverlay.onclick = () => closeUatAssertionsDrawer();
  }
}

/**
 * Close the UAT assertions drawer.
 */
function closeUatAssertionsDrawer() {
  elements.uatAssertionsDrawer?.classList.add('translate-x-full');
  elements.uatAssertionsOverlay?.classList.add('hidden');
}

if (elements.viewUatAssertions) {
  elements.viewUatAssertions.addEventListener('click', () => {
    openUatAssertionsDrawer();
  });
}

if (elements.uatAssertionsClose) {
  elements.uatAssertionsClose.addEventListener('click', () => {
    closeUatAssertionsDrawer();
  });
}

if (elements.uatAssertionsDownload) {
  elements.uatAssertionsDownload.addEventListener('click', () => {
    const site = elements.uatAssertionsSite?.value
      || state.sessions.find(s => s.id === state.settings?.selectedSessionId)?.site
      || '';
    if (!site || !state.uatConfigs?.[site]) {
      toast('No UAT config available');
      return;
    }
    const blob = new Blob([JSON.stringify(state.uatConfigs[site], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${site}-uat-assertions.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

if (elements.uatAssertionsSite) {
  elements.uatAssertionsSite.addEventListener('change', () => {
    const site = elements.uatAssertionsSite?.value || '';
    const config = site ? state.uatConfigs?.[site] : null;
    if (elements.uatAssertionsMeta) {
      elements.uatAssertionsMeta.textContent = site ? `Site: ${site}` : 'No site selected';
    }
    renderUatAssertionsDrawer(site, config);
  });
}

if (elements.allowlistCancel) {
  elements.allowlistCancel.addEventListener('click', () => {
    elements.allowlistDialog.close();
  });
}

if (elements.allowlistSave) {
  elements.allowlistSave.addEventListener('click', () => {
    const fields = Array.from(elements.allowlistFields.querySelectorAll('input[data-domain]'));
    const entries = fields.map(input => input.value.trim()).filter(Boolean);
    const mappings = Array.from(elements.allowlistFields.querySelectorAll('[data-mapping-row]'))
      .map(row => {
        const domain = row.querySelector('input[data-domain]')?.value.trim();
        const serviceId = row.querySelector('select[data-service]')?.value;
        const customName = row.querySelector('input[data-custom-name]')?.value.trim();
        if (!domain) return null;
        if (serviceId === 'custom' && customName) {
          return { domain, customName };
        }
        if (serviceId && serviceId !== 'none' && serviceId !== 'custom') {
          return { domain, serviceId };
        }
        return null;
      })
      .filter(Boolean);
    const selectedServiceIds = Array.from(elements.allowlistServices?.querySelectorAll('input[data-service-id]:checked') || [])
      .map(input => input.getAttribute('data-service-id'))
      .filter(Boolean);
    const serviceDomains = buildAllowlistFromServices(selectedServiceIds);
    const merged = dedupeDomains([...serviceDomains, ...entries]);
    updateSettings({
      allowlist: merged.length ? merged : DEFAULT_ALLOWLIST,
      enableHooks: !!elements.enableHooks?.checked,
      debugHooks: !!state.settings?.debugHooks,
      serviceMappings: mappings
    });
    elements.allowlistDialog.close();
    toast('Allowlist updated');
  });
}

if (elements.allowlistAdd) {
  elements.allowlistAdd.addEventListener('click', () => {
    elements.allowlistFields.appendChild(createAllowlistRow(''));
  });
}

if (elements.newSession) {
  elements.newSession.addEventListener('click', () => {
    state.sessionMode = 'new';
    state.sessionEditId = null;
    openSessionDialog();
  });
}

if (elements.sessionCancel) {
  elements.sessionCancel.addEventListener('click', () => {
    elements.sessionDialog.close();
  });
}

if (elements.sessionSave) {
  elements.sessionSave.addEventListener('click', () => {
    const site = getSelectedSite();
    if (!site) {
      elements.sessionSiteError.classList.remove('hidden');
      return;
    }
    if (elements.sessionTabError) elements.sessionTabError.classList.add('hidden');
    const name = elements.sessionNameInput.value.trim();
    const lockTabId = getSelectedTabId();
    if (lockTabId === null) {
      if (elements.sessionTabError) elements.sessionTabError.classList.remove('hidden');
      toast('Select a tab to observe');
      return;
    }
    const uatEnabled = !!elements.sessionUatToggle?.checked;
    if (state.sessionMode === 'update' && state.sessionEditId) {
      api.runtime.sendMessage({ type: 'updateSession', id: state.sessionEditId, name, site, lockTabId, uatEnabled }, () => {
        elements.sessionDialog.close();
        renderSessions();
        updateSessionSummary();
        toast('Session updated');
      });
      return;
    }

    api.runtime.sendMessage({ type: 'startSession', name, site, lockTabId, uatEnabled }, response => {
      if (!response?.session) return;
      state.settings.selectedSessionId = response.session.id;
      state.settings.capturePaused = false;
      elements.sessionDialog.close();
      elements.observingState.classList.remove('hidden');
      elements.emptyState.classList.add('hidden');
      renderSessions();
      applySearch();
      updateSessionSummary();
      toast('Session started');
    });
  });
}

if (elements.sessionSiteNew) {
  elements.sessionSiteNew.addEventListener('click', () => {
    elements.sessionSiteInput.classList.toggle('hidden');
    if (!elements.sessionSiteInput.classList.contains('hidden')) {
      elements.sessionSiteInput.focus();
    }
    updateUatToggle();
  });
}

if (elements.sessionSiteSelect) {
  elements.sessionSiteSelect.addEventListener('change', () => {
    if (elements.sessionSiteInput) {
      elements.sessionSiteInput.classList.add('hidden');
      elements.sessionSiteInput.value = '';
    }
    updateUatToggle();
  });
}

if (elements.sessionSiteInput) {
  elements.sessionSiteInput.addEventListener('input', () => {
    updateUatToggle();
  });
}

if (elements.clearSessions) {
  elements.clearSessions.addEventListener('click', () => {
    if (elements.confirmTitle) elements.confirmTitle.textContent = 'Clear all sessions?';
    if (elements.confirmBody) elements.confirmBody.textContent = 'This will delete all sessions and captured requests. This action cannot be undone.';
    elements.confirmDialog.dataset.action = '';
    elements.confirmDialog.showModal();
  });
}

if (elements.clearData) {
  elements.clearData.addEventListener('click', () => {
    if (elements.confirmTitle) elements.confirmTitle.textContent = 'Clear all data?';
    if (elements.confirmBody) elements.confirmBody.textContent = 'This will delete sessions, requests, sites, and UAT assertions. This action cannot be undone.';
    elements.confirmDialog.dataset.action = 'clear-all-data';
    elements.confirmDialog.showModal();
  });
}

if (elements.confirmCancel) {
  elements.confirmCancel.addEventListener('click', () => {
    elements.confirmDialog.close();
  });
}

if (elements.confirmOk) {
  elements.confirmOk.addEventListener('click', () => {
    const action = elements.confirmDialog.dataset.action;
    if (action === 'clear-all-data') {
      api.runtime.sendMessage({ type: 'clearAllData' }, () => {
        state.sessions = [];
        state.requests = [];
        state.filtered = [];
        state.selectedId = null;
        state.sites = [];
        state.uatConfigs = {};
        state.settings.selectedSessionId = null;
        elements.details.classList.add('hidden');
        elements.observingState.classList.add('hidden');
        elements.emptyState.classList.remove('hidden');
        renderSessions();
        applySearch();
        updateSessionSummary();
        toast('All data cleared');
        elements.confirmDialog.close();
      });
      return;
    }
    api.runtime.sendMessage({ type: 'clearSessions' }, () => {
      state.sessions = [];
      state.requests = [];
      state.filtered = [];
      state.selectedId = null;
      state.settings.selectedSessionId = null;
      elements.details.classList.add('hidden');
      elements.observingState.classList.add('hidden');
      elements.emptyState.classList.remove('hidden');
      renderSessions();
      applySearch();
      updateSessionSummary();
      toast('All sessions cleared');
      elements.confirmDialog.close();
    });
  });
}

if (elements.openHelp) {
  elements.openHelp.addEventListener('click', () => {
    elements.helpDialog?.showModal();
    requestAnimationFrame(() => setHelpTab('overview'));
  });
}

if (elements.helpClose) {
  elements.helpClose.addEventListener('click', () => {
    elements.helpDialog?.close();
  });
}

if (elements.payloadSearch) {
  elements.payloadSearch.addEventListener('input', event => {
    state.payloadSearch = event.target.value || '';
    if (state.selectedId) selectRequest(state.selectedId);
  });
}

if (elements.querySearch) {
  elements.querySearch.addEventListener('input', event => {
    state.querySearch = event.target.value || '';
    if (state.selectedId) selectRequest(state.selectedId);
  });
}

document.querySelectorAll('[data-expand]').forEach(button => {
  button.addEventListener('click', () => {
    state.payloadExpand = button.getAttribute('data-expand');
    if (state.selectedId) selectRequest(state.selectedId);
  });
});

elements.tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.getAttribute('data-tab');
    setActiveTab(tab);
  });
});

if (elements.tabsSelect) {
  elements.tabsSelect.addEventListener('change', event => {
    setActiveTab(event.target.value);
  });
}

document.addEventListener('input', event => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.id !== 'allowlist-services-search-inner') return;
  const value = event.target.value;
  state.allowlistServiceSearch = value;
  const allowlist = Array.isArray(state.settings?.allowlist) ? state.settings.allowlist : DEFAULT_ALLOWLIST;
  renderAllowlistServices(allowlist);
  requestAnimationFrame(() => {
    const input = document.getElementById('allowlist-services-search-inner');
    if (!input) return;
    input.value = value;
    input.focus();
    input.setSelectionRange(value.length, value.length);
  });
});

api.runtime.onMessage.addListener(message => {
  if (!message || !message.type) return;
  if (message.type === 'requestAdded') {
    state.requests.push(message.request);
    const maxEntries = state.settings?.maxEntries || 2000;
    if (state.requests.length > maxEntries) {
      const overflow = state.requests.length - maxEntries;
      if (overflow > 0) state.requests.splice(0, overflow);
      const sessionKey = message.request?.sessionId || 'global';
      if (!state.requestCapNotified[sessionKey]) {
        state.requestCapNotified[sessionKey] = true;
        toast('Request limit reached', `Oldest requests were trimmed to keep ${maxEntries} entries.`);
      }
    }
    applySearch();
    renderSessions();
  }
  if (message.type === 'requestUpdated') {
    const idx = state.requests.findIndex(r => r.id === message.request.id);
    if (idx !== -1) state.requests[idx] = message.request;
    applySearch();
    if (state.selectedId === message.request.id) {
      selectRequest(state.selectedId);
    }
  }
  if (message.type === 'settingsUpdated') {
    state.settings = message.settings;
    updateDebugBadge();
  }
  if (message.type === 'uatConfigsUpdated') {
    state.uatConfigs = message.uatConfigs || {};
    updateUatToggle();
  }
  if (message.type === 'requestsCleared') {
    const sessionId = state.settings?.selectedSessionId;
    if (sessionId) {
      state.requests = state.requests.filter(r => r.sessionId !== sessionId);
    } else {
      state.requests = [];
    }
    state.filtered = [];
    renderSessions();
    applySearch();
  }
  if (message.type === 'sessionsUpdated') {
    state.sessions = message.sessions || [];
    state.currentSessionId = message.currentSessionId || null;
    renderSessions();
    applySearch();
    updateSessionSummary();
  }
  if (message.type === 'sitesUpdated') {
    state.sites = message.sites || [];
  }
});

document.querySelectorAll('.help-tab').forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.getAttribute('data-help-tab');
    if (tab) setHelpTab(tab);
  });
});

refreshState();
initTour();

// Expose debug hook toggle for developers via extension page console.
window.LaunchObserverDebug = {
  enableHookLogging(value = true) {
    updateSettings({ debugHooks: !!value });
    return !!value;
  },
  disableHookLogging() {
    updateSettings({ debugHooks: false });
    return false;
  },
  isHookLoggingEnabled() {
    return !!state.settings?.debugHooks;
  }
};

/**
 * Switch help modal tabs.
 * @param {string} tabId
 */
function setHelpTab(tabId) {
  document.querySelectorAll('.help-tab').forEach(button => {
    const isActive = button.getAttribute('data-help-tab') === tabId;
    button.classList.toggle('border-slate-900', isActive);
    button.classList.toggle('text-slate-900', isActive);
    button.classList.toggle('border-transparent', !isActive);
    if (!isActive) {
      button.classList.add('text-slate-500');
    } else {
      button.classList.remove('text-slate-500');
    }
  });
  document.querySelectorAll('.help-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
}

/**
 * Toggle the debug mode badge under the version number.
 */
function updateDebugBadge() {
  if (!elements.debugModeBadge) return;
  if (state.settings?.debugHooks) {
    elements.debugModeBadge.classList.remove('hidden');
  } else {
    elements.debugModeBadge.classList.add('hidden');
  }
}
