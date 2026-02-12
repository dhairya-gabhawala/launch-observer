import { elements, state } from './state.js';
import { escapeHtml, setHTML } from './utils.js';

/**
 * Toggle the sidebar open/closed.
 * @param {boolean} open
 */
export function toggleSidebar(open) {
  if (!elements.sidebar) return;
  if (open) {
    elements.sidebar.classList.remove('translate-x-[-100%]');
    elements.mobileOverlay?.classList.remove('hidden');
  } else {
    elements.sidebar.classList.add('translate-x-[-100%]');
    elements.mobileOverlay?.classList.add('hidden');
  }
}

/**
 * Activate a detail tab and update UI state.
 * @param {string} tabId
 */
export function setActiveTab(tabId) {
  state.activeTab = tabId;
  if (elements.tabsSelect) elements.tabsSelect.value = tabId;
  elements.tabButtons.forEach(btn => {
    const isActive = btn.getAttribute('data-tab') === tabId;
    btn.classList.toggle('border-slate-900', isActive);
    btn.classList.toggle('border-transparent', !isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
    if (!isActive) {
      btn.classList.remove('border-slate-900', 'text-slate-900');
      btn.classList.add('text-slate-500');
    } else {
      btn.classList.remove('text-slate-500');
      btn.classList.add('text-slate-900');
    }
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tabId}`);
  });
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} [detail='']
 */
export function toast(message, detail = '') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto w-full max-w-sm translate-y-0 transform rounded-lg bg-white opacity-100 shadow-lg outline-1 outline-black/5 transition duration-300 ease-out';
  setHTML(toast, `
    <div class="p-4">
      <div class="flex items-start">
        <div class="shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="size-6 text-green-400">
            <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="ml-3 w-0 flex-1 pt-0.5">
          <p class="text-sm font-medium text-gray-900">${escapeHtml(message)}</p>
          ${detail ? `<p class="mt-1 text-sm text-gray-500">${escapeHtml(detail)}</p>` : ''}
        </div>
        <div class="ml-4 flex shrink-0">
          <button type="button" class="inline-flex rounded-md text-gray-400 hover:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600">
            <span class="sr-only">Close</span>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="size-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  `);
  const closeBtn = toast.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => toast.remove());
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}
