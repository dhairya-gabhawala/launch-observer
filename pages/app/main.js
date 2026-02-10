import { api, elements, state } from './state.js';
import { DEFAULT_ALLOWLIST, buildAllowlistFromServices, createAllowlistRow, dedupeDomains, getCustomAllowlistEntries, renderAllowlistFields, renderAllowlistServices } from './allowlist.js';
import { applySearch, selectRequest } from './requests.js';
import { deleteSession, getSelectedSite, getSelectedTabId, openSessionDialog, renderSessions, selectSession, updateSessionSummary } from './sessions.js';
import { setActiveTab, toggleSidebar, toast } from './ui.js';

function updateSettings(patch) {
  if (!state.settings) return;
  const next = { ...state.settings, ...patch };
  api.runtime.sendMessage({ type: 'setSettings', settings: next }, response => {
    if (response?.settings) {
      state.settings = response.settings;
    }
  });
}

function refreshState() {
  api.runtime.sendMessage({ type: 'getState' }, response => {
    if (!response) return;
    state.settings = response.settings;
    state.requests = response.requests || [];
    state.sessions = response.sessions || [];
    state.currentSessionId = response.currentSessionId || null;
    state.sites = response.sites || [];
    applySearch();
    renderSessions();
    if (state.selectedId) selectRequest(state.selectedId);
    if (state.settings?.selectedSessionId) {
      elements.observingState.classList.remove('hidden');
      elements.emptyState.classList.add('hidden');
    }
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
    const name = elements.sessionNameInput.value.trim();
    const lockTabId = getSelectedTabId();
    if (state.sessionMode === 'rename' && state.sessionEditId) {
      api.runtime.sendMessage({ type: 'renameSession', id: state.sessionEditId, name }, () => {
        const session = state.sessions.find(s => s.id === state.sessionEditId);
        if (session) session.name = name || session.name;
        elements.sessionDialog.close();
        renderSessions();
        updateSessionSummary();
        toast('Session updated');
      });
      return;
    }

    api.runtime.sendMessage({ type: 'startSession', name, site, lockTabId }, response => {
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
  });
}

if (elements.clearSessions) {
  elements.clearSessions.addEventListener('click', () => {
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
    applySearch();
    renderSessions();
  }
  if (message.type === 'requestUpdated') {
    const idx = state.requests.findIndex(r => r.id === message.request.id);
    if (idx !== -1) state.requests[idx] = message.request;
    applySearch();
  }
  if (message.type === 'settingsUpdated') {
    state.settings = message.settings;
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

refreshState();
