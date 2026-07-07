// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared research report links.

import { authManager, SUPABASE_URL, SUPABASE_KEY } from './supabase-client.js';
import { renderReport, renderError } from './render-report.js';

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

  document.getElementById('btn-download-pdf')?.addEventListener('click', () => window.print());
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());
  initShareToolbar();
  initAuthModal();

  // Reports are public — anyone with the link sees it, no sign-in required.
  await loadReport();
});

// ─── Report Load ─────────────────────────────────────────────────────────────

async function loadReport() {
  const reportId = new URLSearchParams(window.location.search).get('id');
  if (!reportId) {
    renderError('invalid');
    return;
  }

  try {
    const report = await fetchReport(reportId);
    renderReport(report);
  } catch (err) {
    console.error('[UX Research Report Fetch Error]', err);
    renderError(err.isNotFound ? 'notfound' : 'failed');
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

// ─── Sign-in / Register Modal ───────────────────────────────────────────────

function initAuthModal(onSignedIn = () => {}) {
  const modal       = document.getElementById('auth-modal');
  const closeBtn    = document.getElementById('btn-auth-close');
  const toggleLink  = document.getElementById('auth-toggle-link');
  const toggleCopy  = document.getElementById('auth-toggle-copy');
  const titleEl     = document.getElementById('auth-modal-title');
  const submitBtn   = document.getElementById('auth-submit-btn');
  const googleBtn   = document.getElementById('auth-google-btn');
  const errorEl     = document.getElementById('auth-error');
  const emailInput  = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');

  let mode = 'signin';

  function render() {
    const isRegister = mode === 'register';
    titleEl.textContent    = isRegister ? 'Create your account' : 'Sign in to view this report';
    submitBtn.textContent  = isRegister ? 'Create account' : 'Sign in';
    toggleCopy.textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
    toggleLink.textContent = isRegister ? 'Sign in' : 'Register';
  }

  function showError(message) {
    if (errorEl) errorEl.textContent = message || '';
  }

  function open(message) {
    modal?.setAttribute('aria-hidden', 'false');
    showError(message);
    requestAnimationFrame(() => emailInput?.focus());
  }

  function close() {
    modal?.setAttribute('aria-hidden', 'true');
    showError('');
  }

  async function submit() {
    const email    = emailInput?.value.trim() ?? '';
    const password = passwordInput?.value ?? '';

    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }
    showError('');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';

    try {
      if (mode === 'register') {
        await authManager.signUp(email, password);
      } else {
        await authManager.signIn(email, password);
      }
      if (authManager.isLoggedIn()) {
        close();
        await onSignedIn();
      } else {
        showError('Check your inbox to confirm your email, then sign in.');
      }
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      render();
    }
  }

  function submitGoogle() {
    googleBtn.disabled = true;
    googleBtn.textContent = 'Redirecting…';
    authManager.signInWithGoogle();
  }

  toggleLink?.addEventListener('click', () => {
    mode = mode === 'register' ? 'signin' : 'register';
    showError('');
    render();
  });

  closeBtn?.addEventListener('click', close);

  modal?.addEventListener('click', e => {
    if (e.target === modal) close();
  });

  submitBtn?.addEventListener('click', submit);
  googleBtn?.addEventListener('click', submitGoogle);

  [emailInput, passwordInput].forEach(input => {
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });

  return { open, close };
}
