// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared research report links.

// Cache-busted import specifiers (?v=2) — GitHub Pages serves no custom
// Cache-Control/ETag headers we can tune from this repo, so a browser that
// already has these modules in its HTTP cache from before a fix shipped
// would otherwise keep serving the stale copy indefinitely. Bump the ?v=
// on these two lines (and on view.html's <script> and <link> tags) whenever
// a future fix here needs to force a refetch.
import { authManager, SUPABASE_URL, SUPABASE_KEY } from './supabase-client.js?v=5';
import { renderReport, renderError } from './render-report.js?v=4';

// ─── Theme Bootstrap ─────────────────────────────────────────────────────────
(function () {
  try {
    if (localStorage.getItem('ux_research_theme') === 'dark') {
      document.documentElement.classList.add('dark-theme');
      if (document.body) document.body.classList.add('dark-theme');
    }
  } catch (_) {}
}());

const LEMONSQUEEZY_CHECKOUT_URL =
  'https://navidsemi.lemonsqueezy.com/checkout/buy/4bcace87-55a0-40b7-8388-2ceef27a40c1';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const isDark = localStorage.getItem('ux_research_theme') === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  } catch {
    document.documentElement.classList.remove('dark-theme');
  }

  if (window.feather) window.feather.replace();

  // Pro status is about the signed-in VIEWER, not the report's original
  // author — known as soon as auth restores, independent of which report
  // gets fetched below. There's no sign-in UI on this page at all — a
  // session only exists here if it was already established elsewhere
  // (e.g. the audit viewer, which shares this origin's localStorage) — so
  // this is a read-only check, not something a visitor can act on directly.
  await authManager.init();
  const isPremium = authManager.hasProToolAccess();

  const authModal = initAuthModal();
  const openPaywall = () => authModal.open();

  // Toolbar download/print/share — gated the same way the audit viewer's
  // _initReportGate() does it: a free-tier visitor gets a single
  // intercepting listener per control that opens the paywall and nothing
  // else; the real action listeners are wired only for Pro visitors, so
  // the two code paths never both attach to the same button.
  if (isPremium) {
    initShareToolbar();
    wireToolbarActions();
  } else {
    initReportGate(openPaywall);
  }

  document.getElementById('btn-add-to-chrome')?.addEventListener('click', () => {
    if (!isPremium) { openPaywall(); return; }
    // TODO: replace with live Chrome Web Store URL when extension is published
    // window.open('https://chromewebstore.google.com/detail/ux-research-companion/<id>', '_blank');
    toast('UX Research Companion is coming soon to the Chrome Web Store');
  });

  // Reports are public to fetch — anyone with the link can load the record.
  // Whether the full body renders or the gated preview does depends on the
  // viewer's own Pro status above, not on anything report-specific.
  await loadReport(isPremium, openPaywall);

  // Same redundant belt-and-suspenders hide as the audit viewer's own
  // view.js: render-report.js's buildHeader() already only puts the
  // watermark span in the DOM at all when !isPremium, so this is a no-op
  // in practice — kept for parity with audit's pattern in case a future
  // rendering path ever emits it unconditionally.
  if (isPremium) {
    const watermark = document.getElementById('report-branding-watermark');
    if (watermark) watermark.style.display = 'none';
  }
});

// ─── Report Load ─────────────────────────────────────────────────────────────

let _currentReport = null;

async function loadReport(isPremium, openPaywall) {
  const reportId = new URLSearchParams(window.location.search).get('id');
  if (!reportId) {
    renderError('invalid');
    return;
  }

  try {
    const report = await fetchReport(reportId);
    _currentReport = report;
    renderReport(report, isPremium);
    if (!isPremium) {
      document.getElementById('premium-blurred-report-zone')?.classList.add('gated');
      document.getElementById('premium-blurred-report-zone')?.addEventListener('click', openPaywall);
    }
  } catch (err) {
    console.error('[UX Research Report Fetch Error]', err);
    renderError(err.isNotFound ? 'notfound' : 'failed');
  }
}

// Real toolbar download/print actions — only ever wired for Pro visitors
// (see the isPremium branch in DOMContentLoaded); free-tier visitors get
// initReportGate()'s intercepting listeners on these same button IDs instead.
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
    const cssText = await fetch('style.css?v=5').then(res => res.text());
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
  // are public to view. No Authorization header on purpose: a stale/expired
  // token has no business affecting a public read.
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
// Real share actions — only ever wired for Pro visitors (see wireToolbarActions).

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

// ─── Report Gate ─────────────────────────────────────────────────────────────
// Ported from the audit viewer's export-handler.js _initReportGate(): every
// gated toolbar control gets a single intercepting listener instead of the
// real one, so a free-tier click always opens the paywall and never falls
// through to the real action (stopImmediatePropagation guards against any
// other listener on the same element firing first).
const GATED_ACTION_IDS = [
  'btn-download-pdf', 'btn-print',
  'share-link', 'share-wa', 'share-tg', 'share-x',
];

function initReportGate(openPaywall) {
  for (const id of GATED_ACTION_IDS) {
    document.getElementById(id)?.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPaywall();
    });
  }
}

// ─── Upgrade Modal ───────────────────────────────────────────────────────────
// Single-purpose paywall — no sign-in form anywhere on this page. Pro status
// comes from whatever session already exists in this origin's localStorage
// (authManager.init() above); a non-Pro visitor's only path forward here is
// the LemonSqueezy checkout link below.

function initAuthModal() {
  const modal      = document.getElementById('auth-modal');
  const closeBtn    = document.getElementById('btn-auth-close');
  const upgradeBtn  = document.getElementById('auth-upgrade-btn');

  function open() {
    modal?.setAttribute('aria-hidden', 'false');
  }

  function close() {
    modal?.setAttribute('aria-hidden', 'true');
  }

  closeBtn?.addEventListener('click', close);

  modal?.addEventListener('click', e => {
    if (e.target === modal) close();
  });

  upgradeBtn?.addEventListener('click', () => {
    const user   = authManager.getUser();
    const params = new URLSearchParams();
    if (user?.email) params.set('checkout[email]', user.email);
    if (user?.id)    params.set('checkout[custom][user_id]', user.id);
    const qs = params.toString();
    window.open(LEMONSQUEEZY_CHECKOUT_URL + (qs ? '?' + qs : ''), '_blank', 'noopener,noreferrer');
  });

  return { open, close };
}
