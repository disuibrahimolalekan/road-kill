// backend.js — Phase 5 backend adapter. No THREE.
// Providers: 'local' (IndexedDB, default offline) | 'server' (Node lobby
// server accounts + awards) | 'supabase' (REST stub — shaped like the real
// PostgREST calls, no-ops cleanly when env is empty).
// Cross-device sync: export/import code (base64 profile) — log in anywhere
// via the same accountId until Supabase Auth lands.
import { loadProfile, saveProfile } from './economy.js';

const ACCOUNT_KEY = 'rk.account.v1';

export function getAccountId() {
  try {
    let id = localStorage.getItem(ACCOUNT_KEY);
    if (!id) {
      id = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      localStorage.setItem(ACCOUNT_KEY, id);
    }
    return id;
  } catch { return 'guest'; }
}

export function setAccountId(id) {
  try { localStorage.setItem(ACCOUNT_KEY, String(id).slice(0, 32)); } catch {}
}

// Cross-device sync code: {v, accountId, profile} base64.
export function exportSyncCode(profile) {
  const payload = { v: 1, accountId: getAccountId(), profile };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export function importSyncCode(code) {
  const payload = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (!payload || payload.v !== 1 || !payload.profile) throw new Error('bad-code');
  if (payload.accountId) setAccountId(payload.accountId);
  const p = loadProfile();
  Object.assign(p, payload.profile);
  saveProfile(p);
  return p;
}

// Supabase REST stub — real calls when configured, silent skip otherwise.
export async function supabaseSync(profile) {
  const url = (import.meta.env?.VITE_SUPABASE_URL || '').trim();
  const key = (import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key || !fetch) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(`${url}/rest/v1/profiles?account_id=eq.${getAccountId()}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coins: profile.coins, xp: profile.xp, equipped_skin: profile.equippedSkin, updated_at: new Date().toISOString() }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}
