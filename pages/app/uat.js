import { elements, state } from './state.js';
import { escapeHtml, formatTime, setHTML } from './utils.js';
import { buildUatTemplate, validateUatConfig } from '../../lib/uat.js';

export function renderUatForRequest(req) {
  if (!elements.uatStatus) return;
  if (elements.uatOpenDrawer) elements.uatOpenDrawer.classList.add('hidden');
  if (!req) {
    setStatusLine('idle', 'UAT not enabled for this session.');
    return;
  }
  const uat = req.uat;
  if (!uat) {
    const session = state.sessions.find(s => s.id === state.settings?.selectedSessionId);
    const hasConfig = session?.site && state.uatConfigs?.[session.site];
    if (session?.uatEnabled && hasConfig) {
      setStatusLine('loading', 'UAT validation in progress');
    } else {
      setStatusLine('idle', 'UAT not enabled for this session.');
    }
    return;
  }
  if (uat.status === 'pending') {
    setStatusLine('loading', 'UAT validation in progress');
    return;
  }
  if (!uat.results || !uat.results.length) {
    setStatusLine('idle', 'UAT not applicable for this request.');
    return;
  }
  const failed = uat.results.filter(r => r.status === 'failed');
  if (failed.length) {
    setStatusLine('failed', 'UAT validation failed');
  } else {
    setStatusLine('passed', 'UAT validation passed');
  }
  if (elements.uatOpenDrawer) {
    elements.uatOpenDrawer.classList.remove('hidden');
    elements.uatOpenDrawer.onclick = () => openUatDrawer(req);
  }
}

function setStatusLine(state, label) {
  if (!elements.uatStatus) return;
  let icon = '';
  let toneClass = 'text-slate-500';
  if (state === 'loading') {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 text-slate-400 animate-spin">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v2m0 8v2m6-6h-2M8 12H6m9.07-4.07-1.41 1.41M8.34 15.66l-1.41 1.41m0-8.48 1.41 1.41m6.32 6.32 1.41 1.41" />
      </svg>
    `;
    toneClass = 'text-slate-500';
  } else if (state === 'passed') {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4 text-emerald-700">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    `;
    toneClass = 'text-emerald-700';
  } else if (state === 'failed') {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4 text-rose-700">
        <path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    `;
    toneClass = 'text-rose-700';
  } else {
    icon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4 text-slate-400">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    `;
    toneClass = 'text-slate-500';
  }
  setHTML(elements.uatStatus, `${icon}<span class="${toneClass}">${escapeHtml(label)}</span>`);
}

export function openUatDetail(result) {
  if (!elements.uatDetailDialog || !elements.uatDetailBody || !elements.uatDetailTitle) return;
  elements.uatDetailTitle.textContent = result.title || 'Assertion Details';

  const conditionsHtml = result.conditions.map(cond => {
    const actual = cond.actual && cond.actual.length ? cond.actual.join(', ') : '—';
    const expected = cond.expected !== undefined ? JSON.stringify(cond.expected) : '—';
    return `
      <div class="rounded border px-3 py-2">
        <div class="text-xs text-slate-500">${escapeHtml(cond.source)} · ${escapeHtml(cond.path || '(root)')} · ${escapeHtml(cond.operator)}</div>
        <div class="mt-1 text-sm"><span class="font-semibold">Expected:</span> ${escapeHtml(expected)}</div>
        <div class="text-sm"><span class="font-semibold">Actual:</span> ${escapeHtml(actual)}</div>
        <div class="mt-1 text-xs ${cond.passed ? 'text-emerald-600' : 'text-rose-600'}">${cond.passed ? 'Passed' : 'Failed'}</div>
      </div>
    `;
  }).join('');

  const countHtml = result.count
    ? `
      <div class="rounded border px-3 py-2">
        <div class="text-xs text-slate-500">Count validation · ${escapeHtml(result.count.count || '')}</div>
        <div class="mt-1 text-sm"><span class="font-semibold">Expected:</span> ${escapeHtml(String(result.count.expected))}</div>
        <div class="text-sm"><span class="font-semibold">Actual:</span> ${escapeHtml(String(result.count.actual))}</div>
      </div>
    `
    : '';

  setHTML(elements.uatDetailBody, `
    <div class="space-y-3">
      ${conditionsHtml}
      ${countHtml}
    </div>
  `);

  elements.uatDetailDialog.showModal();
}

export function closeUatDetail() {
  elements.uatDetailDialog?.close();
}

export function openUatDrawer(req) {
  if (!elements.uatDrawer || !elements.uatDrawerBody || !elements.uatDrawerOverlay) return;
  const uat = req?.uat;
  if (!uat || !uat.results?.length) return;
  if (elements.uatDrawerMeta) {
    elements.uatDrawerMeta.textContent = `${req.domain || ''} · ${formatTime(req.timeStamp)}`;
  }
  setHTML(elements.uatDrawerBody, renderUatDrawerResults(uat.results));
  elements.uatDrawer.classList.remove('translate-x-full');
  elements.uatDrawerOverlay.classList.remove('hidden');
  elements.uatDrawerOverlay.onclick = () => closeUatDrawer();
}

export function closeUatDrawer() {
  elements.uatDrawer?.classList.add('translate-x-full');
  elements.uatDrawerOverlay?.classList.add('hidden');
}

function renderUatDrawerResults(results) {
  const sections = ['failed', 'passed'];
  return sections.map(status => {
    const items = results.filter(r => r.status === status);
    if (!items.length) return '';
    const tone = status === 'failed' ? 'rose' : 'emerald';
    return `
      <div class="mb-4">
        <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-${tone}-700 mb-2">
          <span>${status}</span>
          <span class="text-slate-400">${items.length}</span>
        </div>
        <div class="space-y-3">
          ${items.map(renderUatDrawerItem).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderUatDrawerItem(result) {
  const conditionList = result.conditions.map(cond => {
    const actual = cond.actual && cond.actual.length ? cond.actual.join(', ') : '—';
    const expected = cond.expected !== undefined ? JSON.stringify(cond.expected) : '—';
    return `
      <div class="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate font-semibold text-slate-700">${escapeHtml(cond.path || '(root)')}</div>
            <div class="text-[10px] uppercase tracking-wide text-slate-400">${escapeHtml(cond.source || 'payload')}</div>
          </div>
          <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">${escapeHtml(cond.operator)}</span>
        </div>
        <div class="mt-2 grid grid-cols-1 gap-1">
          <div><span class="font-semibold text-slate-700">Expected</span> <span class="text-slate-500">•</span> ${escapeHtml(expected)}</div>
          <div><span class="font-semibold text-slate-700">Actual</span> <span class="text-slate-500">•</span> ${escapeHtml(actual)}</div>
        </div>
      </div>
    `;
  }).join('');
  const countBlock = result.count
    ? `<div class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
         <div class="text-[10px] uppercase tracking-wide text-slate-400">Count validation</div>
         <div class="mt-1"><span class="font-semibold text-slate-700">Mode</span> <span class="text-slate-500">•</span> ${escapeHtml(result.count.count)}</div>
         <div class="mt-1"><span class="font-semibold text-slate-700">Expected</span> <span class="text-slate-500">•</span> ${escapeHtml(String(result.count.expected))}</div>
         <div class="mt-1"><span class="font-semibold text-slate-700">Actual</span> <span class="text-slate-500">•</span> ${escapeHtml(String(result.count.actual))}</div>
       </div>`
    : '';
  return `
    <details class="rounded border border-slate-200 bg-white p-3 group">
      <summary class="cursor-pointer text-sm font-semibold text-slate-800 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate">${escapeHtml(result.title)}</div>
          ${result.description ? `<div class="text-xs font-normal text-slate-500 mt-1">${escapeHtml(result.description)}</div>` : ''}
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" clip-rule="evenodd" />
        </svg>
      </summary>
      <div class="mt-3 space-y-3">
        ${conditionList}
        ${countBlock}
      </div>
    </details>
  `;
}

export function openUatReport() {
  if (!elements.uatReportDialog) return;
  const session = state.sessions.find(s => s.id === state.settings?.selectedSessionId);
  if (!session) return;
  const requests = state.requests.filter(r => r.sessionId === session.id);
  const { results, summary } = collectUatReportResults(requests);

  elements.uatReportMeta.textContent = `${session.site} · ${session.name || 'Untitled'} · ${formatTime(session.createdAt)}`;

  const summaryCard = `
    <div class="rounded border border-slate-200 bg-white p-4 mb-4">
      <div class="text-sm font-semibold">Summary</div>
      <div class="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>Total assertions: <span class="font-semibold text-slate-800">${summary.total}</span></div>
        <div>Passed: <span class="font-semibold text-emerald-700">${summary.passed}</span></div>
        <div>Failed: <span class="font-semibold text-rose-700">${summary.failed}</span></div>
        <div>Requests evaluated: <span class="font-semibold text-slate-800">${summary.requests}</span></div>
      </div>
    </div>
  `;

  if (!results.length) {
    setHTML(elements.uatReportBody, `${summaryCard}<div class=\"text-sm text-slate-500\">No UAT results for this session.</div>`);
  } else {
    setHTML(elements.uatReportBody, `${summaryCard}${results.map(renderUatReportCard).join('')}`);
  }

  elements.uatReportDialog.showModal();
}

function collectUatReportResults(requests) {
  const items = [];
  let passed = 0;
  let failed = 0;
  let requestCount = 0;
  requests.forEach(req => {
    if (!req.uat || !req.uat.results || !req.uat.results.length) return;
    requestCount += 1;
    req.uat.results.forEach(result => {
      if (result.status === 'passed') passed += 1;
      if (result.status === 'failed') failed += 1;
      items.push({
        requestId: req.id,
        requestUrl: req.url,
        timeStamp: req.timeStamp,
        result
      });
    });
  });
  return {
    results: items,
    summary: {
      total: passed + failed,
      passed,
      failed,
      requests: requestCount
    }
  };
}

function renderUatReportCard(item) {
  const result = item.result;
  const statusClass = result.status === 'passed' ? 'text-emerald-700' : 'text-rose-700';
  const conditionList = result.conditions.map(cond => {
    const actual = cond.actual && cond.actual.length ? cond.actual.join(', ') : '—';
    const expected = cond.expected !== undefined ? JSON.stringify(cond.expected) : '—';
    return `
      <li class="text-xs text-slate-600">
        <span class="font-semibold">${escapeHtml(cond.path || '(root)')}</span> · ${escapeHtml(cond.operator)} · expected ${escapeHtml(expected)} · actual ${escapeHtml(actual)}
      </li>
    `;
  }).join('');

  const countBlock = result.count
    ? `<div class="text-xs text-slate-600">Count ${escapeHtml(result.count.count)}: expected ${escapeHtml(String(result.count.expected))}, actual ${escapeHtml(String(result.count.actual))}</div>`
    : '';

  return `
    <div class="rounded border border-slate-200 bg-white p-4 mb-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-sm font-semibold">${escapeHtml(result.title)}</div>
          <div class="text-xs text-slate-500">${escapeHtml(item.requestUrl)}</div>
        </div>
        <div class="text-xs font-semibold ${statusClass}">${result.status.toUpperCase()}</div>
      </div>
      <ul class="mt-2 space-y-1">${conditionList}</ul>
      ${countBlock ? `<div class="mt-2">${countBlock}</div>` : ''}
    </div>
  `;
}

export function exportUatPdf() {
  const session = state.sessions.find(s => s.id === state.settings?.selectedSessionId);
  if (!session) return;
  const requests = state.requests.filter(r => r.sessionId === session.id);
  const { results, summary } = collectUatReportResults(requests);
  const doc = window.open('', '_blank');
  if (!doc) return;
  const summaryBlock = `
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:16px;">
      <div style="font-weight:600;margin-bottom:6px;">Summary</div>
      <div style="font-size:12px;color:#475569;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
        <div>Total assertions: <strong>${summary.total}</strong></div>
        <div>Passed: <strong style="color:#047857;">${summary.passed}</strong></div>
        <div>Failed: <strong style="color:#b91c1c;">${summary.failed}</strong></div>
        <div>Requests evaluated: <strong>${summary.requests}</strong></div>
      </div>
    </div>
  `;
  const body = results.length
    ? `${summaryBlock}${results.map(renderUatReportCard).join('')}`
    : `${summaryBlock}<div style="color:#64748b;font-size:14px;">No UAT results for this session.</div>`;

  doc.document.write(`<!doctype html>
    <html>
      <head>
        <title>Launch Observer UAT Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
          .header { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
          .logo { width:32px; height:32px; background:#0f172a; color:#fff; border-radius:8px; display:flex; align-items:center; justify-content:center; }
          .logo svg { width:18px; height:18px; }
          .title { font-size:20px; font-weight:600; }
          .site { color:#64748b; font-size:12px; margin-top:2px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <div>
            <div class="title">Launch Observer — UAT Report</div>
            <div class="site">Site: ${escapeHtml(session.site)}</div>
          </div>
        </div>
        <div class="meta">${escapeHtml(session.name || 'Untitled')} · ${escapeHtml(formatTime(session.createdAt))}</div>
        ${body.replaceAll('class="rounded border border-slate-200 bg-white p-4 mb-4"', 'class="card"')}
      </body>
    </html>`);
  doc.document.close();
  doc.focus();
  doc.print();
}

export function buildTemplateDownload() {
  const template = buildUatTemplate('example-site');
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'uat-template.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
