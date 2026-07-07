// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared research report links.
//
// Phase 1: visual shell only. Auth wiring lands in Phase 2, report fetch +
// render in Phase 3.

// ─── Theme Bootstrap ─────────────────────────────────────────────────────────
(function () {
  try {
    if (localStorage.getItem('ux_research_theme') === 'dark') {
      document.documentElement.classList.add('dark-theme');
      if (document.body) document.body.classList.add('dark-theme');
    }
  } catch (_) {}
}());

document.addEventListener('DOMContentLoaded', () => {
  try {
    const isDark = localStorage.getItem('ux_research_theme') === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  } catch {
    document.documentElement.classList.remove('dark-theme');
  }

  if (window.feather) window.feather.replace();

  initAuthModalChrome();
});

// ─── Sign-in / Register Modal (chrome only — no auth calls yet) ─────────────

function initAuthModalChrome() {
  const modal       = document.getElementById('auth-modal');
  const closeBtn    = document.getElementById('btn-auth-close');
  const toggleLink  = document.getElementById('auth-toggle-link');
  const toggleCopy  = document.getElementById('auth-toggle-copy');
  const titleEl     = document.getElementById('auth-modal-title');
  const submitBtn   = document.getElementById('auth-submit-btn');

  let mode = 'signin';

  function render() {
    const isRegister = mode === 'register';
    titleEl.textContent    = isRegister ? 'Create your account' : 'Sign in to view this report';
    submitBtn.textContent  = isRegister ? 'Create account' : 'Sign in';
    toggleCopy.textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
    toggleLink.textContent = isRegister ? 'Sign in' : 'Register';
  }

  toggleLink?.addEventListener('click', () => {
    mode = mode === 'register' ? 'signin' : 'register';
    render();
  });

  closeBtn?.addEventListener('click', () => {
    modal?.setAttribute('aria-hidden', 'true');
  });

  modal?.addEventListener('click', e => {
    if (e.target === modal) modal.setAttribute('aria-hidden', 'true');
  });
}
