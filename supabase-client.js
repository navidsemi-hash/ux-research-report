// Copyright © 2026 Navid Semi (navidsemi.com). All rights reserved.
// supabase-client.js — Supabase Auth manager for the public report viewer.
//
// Direct REST calls against /auth/v1 — no SDK, no CDN import, no vendored
// bundle. Session persists to localStorage so a shared report link stays
// signed in across visits. Same backend project as the UX Research
// Companion extension: a user signs in here with the same account they
// exported the report with.

export const SUPABASE_URL = 'https://ezoseqwigkedgmoqbhrz.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6b3NlcXdpZ2tlZGdtb3FiaHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjQzNzMsImV4cCI6MjA5NzA0MDM3M30.NTqs9Yj3GTct5ab_ZoZLwZeGrt04Tysm_yFzCt3dOoQ';

const TOKEN_KEY = 'ux_research_authToken';
const USER_KEY  = 'ux_research_authUser';

const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
  },
};

// Returns the exp claim (Unix seconds) from a JWT, or null if unreadable.
function _jwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch { return null; }
}

export const authManager = {
  _token: null,
  _user:  null,
  _ready: false,
  _isPremium:               false,
  _premiumStatusLoadFailed: false,
  _premiumStatusChecked:    false,
  _trialStartedAt:          null,

  // ── Restore persisted session, or capture one from a Google OAuth redirect ──
  async init() {
    if (this._ready) return;
    this._ready = true;

    const capturedFromRedirect = await this._handleOAuthRedirect();
    if (capturedFromRedirect) return;

    const token = storage.get(TOKEN_KEY);
    const user  = storage.get(USER_KEY);
    if (token?.access_token) {
      this._token = token;
      this._user  = user ?? null;
      await this._refreshSession();
      // _refreshSession() only re-persists (and so only re-checks premium
      // status) when the token is actually expiring soon — a still-valid
      // token returns early without touching premium state, so this covers
      // the common "returning visitor, token still fresh" case too.
      await this._checkPremiumStatus();
    }
  },

  // ── Sign up — creates account and establishes session (email confirm off) ────
  async signUp(email, password) {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method:  'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign-up failed.');
    if (data.access_token) await this._persistFromTokenResponse(data);
    return data;
  },

  // ── Sign in with email / password ─────────────────────────────────────────────
  async signIn(email, password) {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Sign-in failed.');
    await this._persistFromTokenResponse(data);
    return data;
  },

  // ── Sign in with Google — full-page redirect through Supabase's authorize URL ──
  // Supabase redirects back to redirectTo with the session in the URL hash;
  // _handleOAuthRedirect() (called from init()) picks it up on the next load.
  signInWithGoogle(redirectTo = window.location.href) {
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
    window.location.href = authUrl;
  },

  // ── Sign out ──────────────────────────────────────────────────────────────────
  async signOut() {
    const token = this._token?.access_token;
    if (token) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method:  'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    this._token = null;
    this._user  = null;
    this._isPremium               = false;
    this._premiumStatusLoadFailed = false;
    this._premiumStatusChecked    = false;
    this._trialStartedAt          = null;
    storage.remove(TOKEN_KEY);
    storage.remove(USER_KEY);
  },

  // ── Accessors ─────────────────────────────────────────────────────────────────
  getUser()    { return this._user ?? null; },
  getToken()   { return this._token?.access_token ?? null; },
  isLoggedIn() { return !!this._token?.access_token; },

  // Real Pro gate — same logic as the extension's supabase-client.js
  // hasProToolAccess(): true for actual premium subscribers, true during the
  // 30-day trial window, and true for grandfathered pre-trial accounts
  // (trial_started_at IS NULL — the account predates the trial feature).
  //
  // Fails closed until _checkPremiumStatus() has actually resolved once —
  // _premiumStatusChecked is what distinguishes a real grandfathered account
  // (fetch succeeded, row's trial_started_at genuinely NULL) from "we never
  // fetched" (logged-out visitor, or a fetch that hasn't run yet), since both
  // otherwise leave _trialStartedAt at its unset default of null.
  hasProToolAccess() {
    if (!this._premiumStatusChecked) return false;
    if (this._premiumStatusLoadFailed) return false;
    if (this._isPremium) return true;
    if (this._trialStartedAt === null) return true; // grandfathered pre-trial accounts
    const trialElapsedMs = Date.now() - new Date(this._trialStartedAt).getTime();
    return trialElapsedMs < 30 * 24 * 60 * 60 * 1000;
  },

  // ── Internal: fetch premium status from the profiles table ──────────────────
  // Same query shape as the extension's _checkPremiumStatus() — only the two
  // columns actually needed here (is_premium, trial_started_at); this viewer
  // has no trial-countdown UI or customer-portal link.
  async _checkPremiumStatus() {
    const token  = this._token?.access_token;
    const userId = this._user?.id;
    if (!token || !userId) {
      // No token/user to check against — same "we don't know ANYTHING"
      // failure as the branches below, so it fails closed the same way.
      this._premiumStatusLoadFailed = true;
      this._isPremium               = false;
      this._trialStartedAt          = null;
      this._premiumStatusChecked    = true;
      return;
    }
    this._premiumStatusLoadFailed = false;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_premium,trial_started_at&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        // A failed fetch means we don't know ANYTHING about the user's
        // status — fail closed rather than keep a stale cached value.
        this._premiumStatusLoadFailed = true;
        this._isPremium      = false;
        this._trialStartedAt = null;
        this._premiumStatusChecked = true;
        return;
      }
      const rows = await res.json();
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      this._isPremium      = row?.is_premium === true;
      this._trialStartedAt = row?.trial_started_at ?? null;
      this._premiumStatusChecked = true;
    } catch {
      this._premiumStatusLoadFailed = true;
      this._isPremium      = false;
      this._trialStartedAt = null;
      this._premiumStatusChecked = true;
    }
  },

  // ── Internal: pick up an access_token left in the URL hash by Google's
  // redirect back from Supabase, persist it, and scrub the hash from the
  // address bar. Returns true if a session was captured this way. ──────────────
  async _handleOAuthRedirect() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const error  = params.get('error_description') || params.get('error');
    const accessToken = params.get('access_token');
    if (!error && !accessToken) return false;

    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (error) throw new Error(error);

    const refreshToken = params.get('refresh_token');
    const expiresIn     = params.get('expires_in');
    const token = {
      access_token:  accessToken,
      refresh_token: refreshToken,
      token_type:    params.get('token_type') || 'bearer',
      expires_at:    expiresIn ? Math.floor(Date.now() / 1000) + Number(expiresIn) : null,
    };

    const user = await this._fetchUser(accessToken);
    await this._persist(token, user);
    return true;
  },

  // ── Internal: refresh the access_token if expired or expiring soon ──────────
  async _refreshSession() {
    const refreshToken = this._token?.refresh_token;
    if (!refreshToken) return;

    const expiresAt = this._token?.expires_at;
    if (expiresAt && (Date.now() / 1000) < expiresAt - 300) return;

    try {
      const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Refresh token rejected (expired or revoked) — sign out cleanly so the
        // UI shows a logged-out state instead of a stale broken session.
        await this.signOut();
        return;
      }
      await this._persistFromTokenResponse(data);
    } catch {
      // Network error — don't sign out; user may be offline.
    }
  },

  // ── Internal: fetch the auth user for a bare access token (used by Google flow) ──
  async _fetchUser(token) {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Failed to load user.');
    return data;
  },

  // ── Internal: split a Supabase token-endpoint response into token + user ────
  async _persistFromTokenResponse(data) {
    const { user, ...token } = data;
    if (!token.expires_at) token.expires_at = _jwtExp(token.access_token);
    await this._persist(token, user ?? null);
  },

  // Single point every path (signUp, signIn, _refreshSession via
  // _persistFromTokenResponse, and _handleOAuthRedirect directly) funnels
  // through — checking premium status here covers all of them uniformly.
  async _persist(token, user) {
    this._token = token;
    this._user  = user;
    storage.set(TOKEN_KEY, token);
    storage.set(USER_KEY, user);
    await this._checkPremiumStatus();
  },
};
