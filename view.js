// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared research report links.
//
// Phase 2: auth wired up (sign-in/register/Google OAuth). Report fetch +
// render land in Phase 3.

import { authManager } from './supabase-client.js';

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

  const authModal = initAuthModal();

  let redirectError = null;
  try {
    await authManager.init();
  } catch (err) {
    redirectError = err.message || 'Google sign-in failed. Please try again.';
  }

  if (redirectError) authModal.open(redirectError);
});

// ─── Sign-in / Register Modal ───────────────────────────────────────────────

function initAuthModal() {
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
