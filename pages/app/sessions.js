import { api, elements, state } from './state.js';
import { escapeHtml, formatTime, setHTML } from './utils.js';
import { applySearch } from './requests.js';
import { toast } from './ui.js';

/**
 * Render the sessions list in the sidebar.
 */
export function renderSessions() {
  const list = elements.sessionList;
  if (!list) return;
  if (!state.sessions.length) {
    setHTML(list, '<div class="p-4 text-sm text-slate-500">No sessions yet.</div>');
    return;
  }
  const selectedId = state.settings?.selectedSessionId;
  const grouped = state.sessions.reduce((acc, session) => {
    const site = session.site || 'Unknown';
    acc[site] = acc[site] || [];
    acc[site].push(session);
    return acc;
  }, {});

  setHTML(list, Object.entries(grouped).map(([site, siteSessions]) => {
    const sessionRows = siteSessions.map(session => {
      const count = state.requests.filter(r => r.sessionId === session.id).length;
      const active = session.id === selectedId ? 'bg-slate-50' : 'bg-white';
      const isPaused = !!session.paused;
      return `
        <div class="border-b ${active}">
          <div class="px-4 py-3 flex items-start justify-between gap-3">
            <button class="flex-1 text-left" data-session-id="${session.id}">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold">${escapeHtml(session.name || 'Untitled')}</div>
                <div class="text-xs text-slate-400">${count}</div>
              </div>
              <div class="text-xs text-slate-500">${formatTime(session.createdAt)}</div>
            </button>
            <div class="flex items-center gap-1">
              <button class="p-1 rounded hover:bg-slate-100 text-slate-500" data-rename-id="${session.id}" title="Rename session">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="h-4 w-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                </svg>
              </button>
              <button class="p-1 rounded hover:bg-rose-50 text-rose-600" data-delete-id="${session.id}" title="Delete session">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="h-4 w-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
              <button class="p-1 rounded hover:bg-slate-100 text-slate-500 ${isPaused ? 'hidden' : ''}" data-pause-id="${session.id}" title="Pause listening">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="h-4 w-4">
                  <path d="M6.75 5.25A.75.75 0 0 1 7.5 4.5h2.25a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm6.75 0a.75.75 0 0 1 .75-.75h2.25a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1-.75-.75V5.25Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="border-b">
        <div class="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">${escapeHtml(site)}</div>
        ${sessionRows}
      </div>
    `;
  }).join(''));

  list.querySelectorAll('button[data-session-id]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-session-id');
      selectSession(id);
    });
  });

  list.querySelectorAll('button[data-rename-id]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-rename-id');
      const session = state.sessions.find(s => s.id === id);
      if (!session) return;
      state.sessionMode = 'update';
      state.sessionEditId = id;
      openSessionDialog(session);
    });
  });

  list.querySelectorAll('button[data-delete-id]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-delete-id');
      deleteSession(id);
    });
  });

  list.querySelectorAll('button[data-pause-id]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const id = button.getAttribute('data-pause-id');
      api.runtime.sendMessage({ type: 'pauseSession', id }, () => {
        if (state.settings) {
          state.settings.capturePaused = true;
          state.settings.selectedSessionId = id;
        }
        updateSessionSummary();
        toast('Stopped listening');
      });
    });
  });
}

/**
 * Select an existing session.
 * @param {string} id
 */
export function selectSession(id) {
  if (!id) return;
  api.runtime.sendMessage({ type: 'selectSession', id }, () => {
    if (state.settings) state.settings.selectedSessionId = id;
    state.selectedId = null;
    elements.details.classList.add('hidden');
    elements.observingState.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    applySearch();
    renderSessions();
    updateSessionSummary();
  });
}

/**
 * Delete a session and its requests.
 * @param {string} id
 */
export function deleteSession(id) {
  api.runtime.sendMessage({ type: 'deleteSession', id }, () => {
    state.sessions = state.sessions.filter(s => s.id !== id);
    state.requests = state.requests.filter(r => r.sessionId !== id);
    if (state.settings?.selectedSessionId === id) {
      state.settings.selectedSessionId = state.sessions[0]?.id || null;
    }
    state.selectedId = null;
    elements.details.classList.add('hidden');
    if (state.settings?.selectedSessionId) {
      elements.observingState.classList.remove('hidden');
    } else {
      elements.emptyState.classList.remove('hidden');
    }
    applySearch();
    renderSessions();
    updateSessionSummary();
  });
}

/**
 * Populate site dropdown options.
 */
export function buildSiteOptions() {
  const select = elements.sessionSiteSelect;
  if (!select) return;
  const sites = Array.from(new Set(state.sites.filter(Boolean))).sort();
  const options = sites.map(site => `<option value="${escapeHtml(site)}">${escapeHtml(site)}</option>`).join('');
  setHTML(select, options || '<option value="">Select a site</option>');
}

/**
 * Populate lock-tab selector options.
 */
export function populateTabOptions(preferredTabId) {
  if (!elements.sessionLockTab) return;
  api.tabs.query({}, tabs => {
    const filtered = tabs.filter(tab => !isExtensionTab(tab));
    state.tabsCache = filtered;
    const options = filtered.map(tab => ({
      id: String(tab.id),
      label: `${tab.title || tab.url || 'Untitled'}`
    }));
    setHTML(elements.sessionLockTab, options.map(opt => {
      return `<option value="${opt.id}">${escapeHtml(opt.label)}</option>`;
    }).join(''));
    if (preferredTabId !== null && preferredTabId !== undefined) {
      elements.sessionLockTab.value = String(preferredTabId);
    } else if (elements.sessionLockTab.options.length) {
      elements.sessionLockTab.selectedIndex = 0;
    }
  });
}

/**
 * Resolve selected lock-tab ID.
 * @returns {number|null}
 */
export function getSelectedTabId() {
  const value = elements.sessionLockTab?.value;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Check whether a tab is the extension UI.
 * @param {object} tab
 * @returns {boolean}
 */
export function isExtensionTab(tab) {
  const url = tab.url || '';
  return url.startsWith('chrome-extension://') || url.startsWith('moz-extension://');
}

/**
 * Resolve selected site from dialog inputs.
 * @returns {string}
 */
export function getSelectedSite() {
  const useNew = !elements.sessionSiteInput.classList.contains('hidden') && elements.sessionSiteInput.value.trim();
  const site = useNew ? elements.sessionSiteInput.value.trim() : (elements.sessionSiteSelect.value || '').trim();
  return site;
}

/**
 * Open the session modal for create/rename.
 * @param {object} session
 */
export function openSessionDialog(session) {
  buildSiteOptions();
  populateTabOptions(session?.lockTabId);
  elements.sessionSiteInput.classList.add('hidden');
  elements.sessionSiteError.classList.add('hidden');
  if (elements.sessionTabError) elements.sessionTabError.classList.add('hidden');
  elements.sessionNameInput.value = session?.name || '';
  elements.sessionDialogTitle.textContent = state.sessionMode === 'update' ? 'Update Session' : 'Start Session';
  if (elements.sessionSave) {
    elements.sessionSave.textContent = state.sessionMode === 'update' ? 'Update' : 'Start';
  }

  if (session?.site) {
    const options = Array.from(elements.sessionSiteSelect.options).map(opt => opt.value);
    if (options.includes(session.site)) {
      elements.sessionSiteSelect.value = session.site;
    } else {
      elements.sessionSiteInput.classList.remove('hidden');
      elements.sessionSiteInput.value = session.site;
    }
  }
  if (elements.sessionUatToggle) {
    elements.sessionUatToggle.checked = !!session?.uatEnabled;
  }
  updateUatToggle();
  elements.sessionDialog.showModal();
}

/**
 * Update the session summary line.
 */
export function updateSessionSummary() {
  if (!elements.sessionSummary) return;
  const session = state.sessions.find(s => s.id === state.settings?.selectedSessionId);
  if (!session) {
    elements.sessionSummary.textContent = '';
    return;
  }
  if (state.settings?.capturePaused) {
    elements.sessionSummary.textContent = 'Stopped listening';
    return;
  }
  const tabLabel = getTabLabel(session.lockTabId);
  elements.sessionSummary.textContent = `${session.site} · ${session.name || 'Untitled'} · ${tabLabel}`;
}

/**
 * Get label for the locked tab selection.
 * @param {number|null} lockTabId
 * @returns {string}
 */
export function getTabLabel(lockTabId) {
  if (lockTabId === null || lockTabId === undefined) return 'All tabs';
  const tab = state.tabsCache.find(t => t.id === lockTabId);
  if (tab) return tab.title || tab.url || `Tab ${lockTabId}`;
  return `Tab ${lockTabId}`;
}

/**
 * Update UAT toggle availability and helper text.
 */
export function updateUatToggle() {
  if (!elements.sessionUatToggle || !elements.sessionUatNote) return;
  const site = getSelectedSite();
  const config = site ? state.uatConfigs?.[site] : null;
  if (!config) {
    elements.sessionUatToggle.checked = false;
    elements.sessionUatToggle.disabled = true;
    elements.sessionUatNote.textContent = 'No UAT config for this site. Import assertions to enable.';
    return;
  }
  elements.sessionUatToggle.disabled = false;
  const count = Array.isArray(config.assertions) ? config.assertions.length : 0;
  elements.sessionUatNote.textContent = `Uses ${count} assertion${count === 1 ? '' : 's'} for this site.`;
}
