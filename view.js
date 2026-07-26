// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared research report links.

// Cache-busted import specifiers (?v=2) — GitHub Pages serves no custom
// Cache-Control/ETag headers we can tune from this repo, so a browser that
// already has these modules in its HTTP cache from before a fix shipped
// would otherwise keep serving the stale copy indefinitely. Bump the ?v=
// on these two lines (and on view.html's <script> and <link> tags) whenever
// a future fix here needs to force a refetch.
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-client.js?v=5';
import { renderReport, renderError } from './render-report.js?v=3';

// ─── Theme Bootstrap ─────────────────────────────────────────────────────────
(function () {
  try {
    if (localStorage.getItem('ux_research_theme') === 'dark') {
      document.documentElement.classList.add('dark-theme');
      if (document.body) document.body.classList.add('dark-theme');
    }
  } catch (_) {}
}());

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const isDark = localStorage.getItem('ux_research_theme') === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  } catch {
    document.documentElement.classList.remove('dark-theme');
  }

  if (window.feather) window.feather.replace();

  initShareToolbar();
  wireToolbarActions();

  document.getElementById('btn-add-to-chrome')?.addEventListener('click', () => {
    // TODO: replace with live Chrome Web Store URL when extension is published
    // window.open('https://chromewebstore.google.com/detail/ux-research-companion/<id>', '_blank');
    toast('UX Research Companion is coming soon to the Chrome Web Store');
  });

  // Reports are public — anyone with the link sees the full report.
  await loadReport();
});

// ─── Report Load ─────────────────────────────────────────────────────────────

let _currentReport = null;

async function loadReport() {
  const reportId = new URLSearchParams(window.location.search).get('id');
  if (!reportId) {
    renderError('invalid');
    return;
  }

  try {
    const report = await fetchReport(reportId);
    _currentReport = report;
    renderReport(report);
  } catch (err) {
    console.error('[UX Research Report Fetch Error]', err);
    renderError(err.isNotFound ? 'notfound' : 'failed');
  }
}

function wireToolbarActions() {
  document.getElementById('btn-download-pdf')?.addEventListener('click', () => downloadReportHtml());
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());
}

// ─── Direct HTML Download ────────────────────────────────────────────────────
// Replaces the old window.print() flow: no print dialog, no new tab — the
// rendered #report-content markup is bundled with style.css into a single
// self-contained file and saved straight to disk via the blob/anchor pattern
// used elsewhere in the extension (see research-export.js's downloadJson).
// The saved file always renders light, matching the existing @media print
// rules — it's built without the dark-theme class regardless of the current
// on-screen theme.

async function downloadReportHtml() {
  const contentEl = document.getElementById('report-content');
  if (!_currentReport || !contentEl) return;

  try {
    const cssText = await fetch('style.css?v=3').then(res => res.text());
    const typeLabel = document.title || 'UX Research Report';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${typeLabel}</title>
<style>${cssText}</style>
</head>
<body>
<div class="report-page-body"><div id="report-content">${contentEl.innerHTML}</div></div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const a = Object.assign(document.createElement('a'), {
      href:     url,
      download: `ux-research-${_currentReport.project_type}-${date}.html`,
      style:    'display:none',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[UX Research Report Download Error]', err);
    toast('Download failed. Please try again.');
  }
}

async function fetchReport(reportId) {
  // Anonymous, unauthenticated call — the RPC is security definer and reports
  // are public to view.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_research_report_by_id`, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ report_id: reportId }),
  });

  if (res.status === 404) {
    throw Object.assign(new Error('Report not found.'), { isNotFound: true });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 150) || res.statusText}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw Object.assign(new Error('Report not found.'), { isNotFound: true });
  }
  return rows[0];
}

// ─── Toast ───────────────────────────────────────────────────────────────────

let _toastTimer = null;

function toast(message, durationMs = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(_toastTimer);
  el.textContent = message;
  el.classList.add('is-visible');
  _toastTimer = setTimeout(() => el.classList.remove('is-visible'), durationMs);
}

// ─── Share Toolbar ───────────────────────────────────────────────────────────

function initShareToolbar() {
  document.getElementById('share-link')?.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      return;
    }
    this.classList.add('is-copied');
    setTimeout(() => this.classList.remove('is-copied'), 1500);
  });

  document.getElementById('share-wa')?.addEventListener('click', () => {
    window.open(`https://wa.me/?text=${encodeURIComponent('Research report: ' + window.location.href)}`, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('share-tg')?.addEventListener('click', () => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent('Research report')}`, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('share-x')?.addEventListener('click', () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent('Research report')}&url=${encodeURIComponent(window.location.href)}`, '_blank', 'noopener,noreferrer');
  });
}
