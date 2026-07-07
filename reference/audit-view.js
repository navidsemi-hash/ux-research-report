// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// view.js — Public web entry point for shared links. Parses URL tokens for backend database hydration.

import { initReportPage } from './export-handler.js';
import { authManager }    from './supabase-client.js';

// ─── Theme Bootstrap ─────────────────────────────────────────────────────────
(function () {
  try {
    if (localStorage.getItem('ux_audit_theme') === 'dark') {
      document.documentElement.classList.add('dark-theme');
      if (document.body) document.body.classList.add('dark-theme');
    }
  } catch (_) {}
}());

const LEMONSQUEEZY_CHECKOUT_URL =
  'https://navidsemi.lemonsqueezy.com/checkout/buy/YOUR_VARIANT_ID';

const RPW_STATE = Object.freeze({ AUTH: 'auth', UPGRADE: 'upgrade' });

document.addEventListener('DOMContentLoaded', async () => {
  // Pure web-safe theme enforcement
  try {
    const isDark = localStorage.getItem('ux_audit_theme') === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  } catch {
    document.documentElement.classList.remove('dark-theme');
  }

  // Initialize public auth manager instance
  await authManager.init();
  initReportPaywallModal();

  const contentEl  = document.getElementById('report-content');
  const isLoggedIn = authManager.isLoggedIn();
  const isPremium  = authManager.isUserPremium();

  // Extract the unique report token string out of the browser address bar
  const urlParams = new URLSearchParams(window.location.search);
  const reportId  = urlParams.get('id') || urlParams.get('reportId');

  if (!reportId) {
    if (contentEl) {
      contentEl.innerHTML =
        `<div style="padding:40px 24px;text-align:center;font-family:sans-serif;color:#505973;">
           <strong style="display:block;margin-bottom:8px;color:#dc2626;">Invalid Link</strong>
           This shared audit report URL is missing its identification token key.
         </div>`;
    }
    return;
  }

  try {
    // Hydrate the layout view by handing off the specific report database identifier 
    await initReportPage({
      reportId,
      isPremium,
      openPaywall: () => {
        showReportPaywall(isLoggedIn ? RPW_STATE.UPGRADE : RPW_STATE.AUTH);
      },
    });
    
    // Premium asset brand clearing loop
    if (isPremium) {
      const watermark = document.getElementById('report-branding-watermark');
      if (watermark) {
        watermark.style.display = 'none';
      }
    }
  } catch (err) {
    if (contentEl) {
      contentEl.innerHTML =
        `<div style="padding:40px 24px;text-align:center;font-family:sans-serif;color:#505973;">
           <strong style="display:block;margin-bottom:8px;color:#dc2626;">Could not fetch shared report</strong>
           The data records may have been deleted or the link has expired.
         </div>`;
    }
    console.error('[UX Audit Shared Report Fetch Error]', err);
  }
});

// ─── Report Paywall Modal ─────────────────────────────────────────────────────

function showReportPaywall(state) {
  const modal = document.getElementById('report-paywall-modal');
  if (!modal) return;
  document.getElementById('report-paywall-view-auth').hidden    = (state !== RPW_STATE.AUTH);
  document.getElementById('report-paywall-view-upgrade').hidden = (state !== RPW_STATE.UPGRADE);
  modal.setAttribute('aria-hidden', 'false');
  if (window.feather) window.feather.replace();
  if (state === RPW_STATE.AUTH) {
    requestAnimationFrame(() => document.getElementById('report-paywall-email')?.focus());
  }
}

function hideReportPaywall() {
  document.getElementById('report-paywall-modal')?.setAttribute('aria-hidden', 'true');
}

function initReportPaywallModal() {
  document.getElementById('btn-report-paywall-close')?.addEventListener('click', hideReportPaywall);
  document.getElementById('report-paywall-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideReportPaywall();
  });

  const signupBtn = document.getElementById('report-paywall-signup-btn');

  async function _doAuth() {
    const email    = document.getElementById('report-paywall-email')?.value.trim()  ?? '';
    const password = document.getElementById('report-paywall-password')?.value      ?? '';
    const errEl    = document.getElementById('report-paywall-error');

    if (!email || !password) {
      if (errEl) { errEl.style.color = ''; errEl.textContent = 'Please enter your email and password.'; }
      return;
    }
    if (errEl) { errEl.style.color = ''; errEl.textContent = ''; }
    if (signupBtn) { signupBtn.disabled = true; signupBtn.textContent = 'Please wait…'; }

    try {
      try {
        await authManager.signUp(email, password);
      } catch (e) {
        if (/already registered|user already/i.test(e.message)) {
          await authManager.signIn(email, password);
        } else {
          throw e;
        }
      }
      if (authManager.isLoggedIn()) {
        hideReportPaywall();
        window.location.reload();
      } else {
        if (errEl) {
          errEl.style.color = '#0f766e';
          errEl.textContent = 'Check your inbox to confirm your email, then try again.';
        }
      }
    } catch (e) {
      if (errEl) { errEl.style.color = ''; errEl.textContent = e.message; }
    } finally {
      if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = 'Create Your Account'; }
    }
  }

  signupBtn?.addEventListener('click', _doAuth);

  document.getElementById('report-paywall-upgrade-btn')?.addEventListener('click', () => {
    const user   = authManager.getUser();
    const params = new URLSearchParams();
    if (user?.email) params.set('checkout[email]', user.email);
    if (user?.id)    params.set('checkout[custom][user_id]', user.id);
    const qs  = params.toString();
    window.open(LEMONSQUEEZY_CHECKOUT_URL + (qs ? '?' + qs : ''), '_blank', 'noopener,noreferrer');
  });
}
