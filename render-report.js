// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// render-report.js — Renders a fetched research report into #report-content.

const PROJECT_TYPE_LABELS = {
  competitor: 'Competitor Research',
  discovery:  'Discovery Research',
  usability:  'Usability Testing',
};

const SEVERITY_META = {
  1: { key: 'critical', label: 'Critical' },
  2: { key: 'high',     label: 'High'     },
  3: { key: 'medium',   label: 'Medium'   },
  4: { key: 'low',      label: 'Low'      },
};

const ERROR_MESSAGES = {
  invalid:  { title: 'Invalid Link',         body: 'This shared report URL is missing its identification token.' },
  notfound: { title: 'Report Not Found',      body: 'This report may have been deleted, or the link has expired.' },
  failed:   { title: 'Could Not Load Report', body: 'Something went wrong while fetching this report. Please try again later.' },
};

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderError(kind = 'failed') {
  const contentEl = document.getElementById('report-content');
  if (!contentEl) return;
  const { title, body } = ERROR_MESSAGES[kind] || ERROR_MESSAGES.failed;
  contentEl.innerHTML = `
    <div class="report-error">
      <strong class="report-error-title">${escHtml(title)}</strong>
      ${escHtml(body)}
    </div>`;
}

export function renderReport(report) {
  const contentEl = document.getElementById('report-content');
  if (!contentEl) return;

  const steps = coerceArray(report.steps);

  let visibleCount = 0;
  const stepsHtml = steps.map(step => {
    if (!step.skipped) visibleCount++;
    return buildStep(step, visibleCount);
  }).join('');

  contentEl.innerHTML =
    `<div class="pdf-report">${buildHeader(report)}${buildProgress(steps)}${stepsHtml}</div>`;

  if (window.feather) window.feather.replace();
}

// ─── Header ──────────────────────────────────────────────────────────────────

function buildHeader(report) {
  const typeLabel = PROJECT_TYPE_LABELS[report.project_type] || 'Research Report';

  const rows = [];
  if (report.project_name)    rows.push(metaRow('Project Name', report.project_name));
  if (report.researcher_name) rows.push(metaRow('Researcher', report.researcher_name));
  rows.push(metaRow('Export Date', formatDate(report.created_at)));

  return `
<div class="pdf-cover">
  <div class="pdf-header-bar">
    <div class="pdf-header-left">
      <span class="pdf-header-mark" aria-hidden="true">◼</span>
      <span>${escHtml(typeLabel)}</span>
    </div>
  </div>
  <div class="pdf-cover-body">
    <h1 class="pdf-report-h1">${escHtml(typeLabel)}</h1>
    <table class="pdf-meta-table">${rows.join('')}</table>
  </div>
</div>`;
}

function metaRow(key, value) {
  return `<tr><td class="pdf-meta-key">${escHtml(key)}</td><td class="pdf-meta-val">${escHtml(value)}</td></tr>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch { return '—'; }
}

// ─── Progress summary ────────────────────────────────────────────────────────

function buildProgress(steps) {
  const visible = steps.filter(s => !s.skipped);
  const done    = visible.filter(s => s.completed).length;
  const total   = visible.length;
  const pct     = total ? Math.round((done / total) * 100) : 0;

  return `
<div class="pdf-progress-section">
  <div class="pdf-section-label">Progress</div>
  <div class="pdf-prog-track"><div class="pdf-prog-fill" style="width:${pct}%"></div></div>
  <div class="pdf-prog-pct">${done} of ${total} steps completed</div>
</div>`;
}

// ─── Step section ────────────────────────────────────────────────────────────

function buildStep(step, number) {
  const skipped   = !!step.skipped;
  const completed = !!step.completed;
  const elements  = coerceArray(step.elements);
  const isEmptyStep = !skipped && elements.every(isElementEmpty);

  const titleText = skipped
    ? `<span class="pdf-step-skip-label">Skipped</span> ${escHtml(step.title || '')}`
    : `${number}. ${escHtml(step.title || '')}`;
  const completeIcon = (!skipped && completed)
    ? `<i data-feather="check-circle" class="pdf-step-complete-icon" aria-hidden="true"></i>`
    : '';

  const guidanceHtml = step.guidance
    ? `<div class="pdf-item-note pdf-step-guidance">${nl2br(escHtml(step.guidance))}</div>`
    : '';
  const elementsHtml = elements.length
    ? elements.map(buildElement).join('')
    : `<p class="pdf-el-empty">No elements in this step.</p>`;

  const sectionClasses = ['pdf-pillar-section'];
  if (skipped) sectionClasses.push('is-skipped');
  if (isEmptyStep) sectionClasses.push('is-empty');

  return `
<section class="${sectionClasses.join(' ')}">
  <div class="pdf-pillar-hd">
    <div class="pdf-pillar-title-wrap">
      <h2 class="pdf-pillar-name">${titleText}${completeIcon}</h2>
    </div>
  </div>
  <div class="pdf-items">
    ${guidanceHtml}
    ${elementsHtml}
  </div>
</section>`;
}

// A step is "empty" when every element in it has no user-entered data —
// checked independently of step.completed, since a step can be marked
// complete with nothing filled in.
function isElementEmpty(el) {
  switch (el.kind) {
    case 'text':       return !(el.body || '').trim();
    case 'checklist':  return !coerceArray(el.items).some(it => it.checked);
    case 'table':      return coerceArray(el.rows).every(row => coerceArray(row).every(cell => !String(cell ?? '').trim()));
    case 'attachment': return coerceArray(el.files).length === 0;
    case 'link':       return !(el.url || '').trim();
    case 'rating':     return el.value === null || el.value === undefined;
    case 'participant':return !(el.name || '').trim() && !(el.segment || '').trim() && !(el.notes || '').trim();
    case 'quote':      return !(el.text || '').trim() && !(el.source || '').trim();
    case 'severity':   return (el.level === null || el.level === undefined) && !(el.description || '').trim();
    case 'qa':         return !(el.question || '').trim() && !(el.answer || '').trim();
    default:            return true;
  }
}

// ─── Element dispatch ────────────────────────────────────────────────────────

function buildElement(el) {
  const title = `<div class="pdf-item-label">${escHtml(el.title || '')}</div>`;
  const inner = buildElementBody(el);
  return `<div class="pdf-item pdf-el pdf-el--${escHtml(el.kind || 'unknown')}">${title}${inner}</div>`;
}

function buildElementBody(el) {
  switch (el.kind) {
    case 'text':        return buildText(el);
    case 'checklist':    return buildChecklist(el);
    case 'table':        return buildTable(el);
    case 'attachment':   return buildAttachment(el);
    case 'link':         return buildLink(el);
    case 'rating':       return buildRating(el);
    case 'participant':  return buildParticipant(el);
    case 'quote':        return buildQuote(el);
    case 'severity':     return buildSeverity(el);
    case 'qa':           return buildQa(el);
    default:              return emptyNote();
  }
}

function buildText(el) {
  const body = (el.body || '').trim();
  return body ? `<p class="pdf-el-body">${nl2br(escHtml(body))}</p>` : emptyNote();
}

function buildChecklist(el) {
  const items = coerceArray(el.items);
  if (!items.length) return emptyNote();
  return `<ul class="pdf-checklist">${items.map(it => `
    <li class="pdf-checklist-row${it.checked ? ' is-checked' : ''}">
      <span class="pdf-checklist-box" aria-hidden="true">${it.checked ? '☑' : '☐'}</span>
      <span class="pdf-checklist-text">${escHtml(it.label || '')}</span>
    </li>`).join('')}</ul>`;
}

function buildTable(el) {
  const columns = coerceArray(el.columns);
  const rows    = coerceArray(el.rows);
  if (!columns.length && !rows.length) return emptyNote();

  const theadHtml = columns.length
    ? `<thead><tr>${columns.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>`
    : '';
  const tbodyHtml = rows.map(row =>
    `<tr>${coerceArray(row).map(cell => `<td>${escHtml(cell ?? '')}</td>`).join('')}</tr>`
  ).join('');

  return `<div class="pdf-table-wrap"><table class="pdf-table">${theadHtml}<tbody>${tbodyHtml}</tbody></table></div>`;
}

function buildAttachment(el) {
  const files = coerceArray(el.files);
  if (!files.length) return emptyNote();
  return `<ul class="pdf-file-list">${files.map(f => `
    <li class="pdf-file-chip"><i data-feather="paperclip" aria-hidden="true"></i><span>${escHtml(f.name || 'Untitled file')}</span></li>`).join('')}</ul>`;
}

function buildLink(el) {
  const url = (el.url || '').trim();
  if (!url) return emptyNote();
  const isSafe   = /^https?:\/\//i.test(url);
  const linkHtml = isSafe
    ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a>`
    : escHtml(url);
  const noteHtml = el.note ? `<div class="pdf-item-note">${nl2br(escHtml(el.note))}</div>` : '';
  return `<p class="pdf-el-link">${linkHtml}</p>${noteHtml}`;
}

function buildRating(el) {
  const noteHtml = el.note ? `<div class="pdf-item-note">${nl2br(escHtml(el.note))}</div>` : '';
  if (el.value === null || el.value === undefined) {
    return `<p class="pdf-el-empty">Not rated</p>${noteHtml}`;
  }
  return `<p><span class="pdf-badge">${escHtml(el.value)} / ${escHtml(el.scale)}</span></p>${noteHtml}`;
}

function buildParticipant(el) {
  const hasAny = el.name || el.segment || el.notes;
  if (!hasAny) return emptyNote();
  return `
<div class="pdf-participant-card">
  ${el.name    ? `<div class="pdf-participant-name">${escHtml(el.name)}</div>` : ''}
  ${el.segment ? `<div class="pdf-participant-segment">${escHtml(el.segment)}</div>` : ''}
  ${el.notes   ? `<p class="pdf-participant-notes">${nl2br(escHtml(el.notes))}</p>` : ''}
</div>`;
}

function buildQuote(el) {
  const text = (el.text || '').trim();
  if (!text) return emptyNote();
  const sourceHtml = el.source ? `<footer class="pdf-quote-source">— ${escHtml(el.source)}</footer>` : '';
  return `<blockquote class="pdf-quote">${nl2br(escHtml(text))}${sourceHtml}</blockquote>`;
}

function buildSeverity(el) {
  const meta = SEVERITY_META[el.level] || null;
  const pillHtml = meta ? `<span class="pdf-sev-pill pdf-sev-pill--${meta.key}">${meta.label}</span>` : '';
  const description = (el.description || '').trim();
  if (!meta && !description) return emptyNote();
  const bodyHtml = description
    ? `<p class="pdf-el-body">${nl2br(escHtml(description))}</p>`
    : (meta ? '' : emptyNote());
  return `${pillHtml}${bodyHtml}`;
}

function buildQa(el) {
  const question = (el.question || '').trim();
  const answer   = (el.answer || '').trim();
  if (!question && !answer) return emptyNote();
  const questionHtml = question ? `<p class="pdf-el-question">${escHtml(question)}</p>` : '';
  const answerHtml   = answer ? `<p class="pdf-el-body">${nl2br(escHtml(answer))}</p>` : `<p class="pdf-el-empty">No response yet</p>`;
  return `${questionHtml}${answerHtml}`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function emptyNote() {
  return `<p class="pdf-el-empty">No response yet</p>`;
}

function coerceArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function nl2br(escapedStr) {
  return escapedStr.replace(/\n/g, '<br>');
}
