// identity.js — who is playing on this device right now.
//
// Road Kill is local-first: progress (currency, unlocks, XP, stats, match
// history) lives in IndexedDB and localStorage on the device. Until now that
// storage was addressed with ONE hard-coded key — 'main' in IndexedDB and
// 'rk.profile.v2' in localStorage. That is fine for a single player, but the
// moment a second person uses the same browser they read and write the same
// record: coins, gems, skins and stats would bridge straight between them.
//
// This module supplies the namespace that every per-player storage key is
// built from. With no sign-in yet, a stable per-browser "guest" id is created
// once and kept forever, so today's behaviour is unchanged for one player.
// When the sign-up page lands, setAccountId(uid) moves the whole storage layer
// onto that account's namespace and nothing in the guest slot is readable from
// it.
//
// SECURITY — read this before wiring a real sign-in:
//   * accountId() is a NAMESPACE, not a credential. It proves nothing about
//     who is playing. It exists only so two accounts on one device cannot see
//     each other's local data.
//   * It must NEVER be trusted by the server as proof of identity. The server
//     keys progress by the uid from its own signed session, and treats any
//     client-supplied accountId as an opaque hint at most.
//   * Nothing here is encrypted. Local storage is only as private as the
//     device; anyone with the device can read it. That is inherent to a
//     local-first game and is why currency that must be trustworthy has to be
//     held server-side after sign-in, not merely mirrored here.
//   * A guest account is disposable by design. Signing in must UPLOAD the
//     guest progress once and then abandon the guest namespace, never merge
//     two namespaces silently.

const IDENTITY_KEY = 'rk.identity.v1';
// Pre-existing account id owned by backend.js (server wallet mirror,
// exportSyncCode, the Supabase REST stub). Read directly rather than imported
// because backend.js imports economy.js, which imports THIS module — importing
// it back would be a cycle.
const LEGACY_ACCOUNT_KEY = 'rk.account.v1';
// Namespace only — letters, digits, _ and - so it can be embedded in a key.
const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * The id this device already had, before this module existed.
 *
 * Adopted instead of minting a second one: an existing player already has
 * rk.account.v1, it is what their wallet mirror and exportSyncCode are keyed
 * by, and creating a parallel id here would split one person's data across two
 * namespaces — the opposite of what this module is for.
 */
function existingAccountId() {
  try {
    const id = localStorage.getItem(LEGACY_ACCOUNT_KEY);
    if (id && ID_RE.test(id)) return id;
  } catch { /* private mode -> mint a fresh guest */ }
  return null;
}

/**
 * Keep backend.js's key in step with the namespace.
 *
 * One id for storage AND sync, so a future sign-up lands on a single identity
 * instead of two that can drift. Deliberately NOT automatic in the other
 * direction: when the server sends an accountId on connect, main.js may update
 * rk.account.v1, and this module must not follow it mid-session — the profile
 * still in memory belongs to the previous namespace, and saving it under a new
 * name is exactly the cross-account bridge this exists to prevent. A namespace
 * switch happens only at an explicit boundary (setAccountId/signOut + reload).
 */
function mirrorAccountId(id) {
  try { localStorage.setItem(LEGACY_ACCOUNT_KEY, String(id)); } catch { /* private mode */ }
}

function randomId() {
  const a = new Uint8Array(12);
  try { crypto.getRandomValues(a); }
  catch { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; }
  // 'g' marks a guest slot, so a guest id can never collide with a server uid.
  return 'g' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && ID_RE.test(o.accountId || '')) return o;
  } catch { /* corrupt -> fall through to a fresh guest slot */ }
  return null;
}

function writeIdentity(o) {
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(o)); } catch { /* private mode */ }
}

let current = null;
let listeners = [];

export function identity() {
  if (current) return current;
  const stored = readIdentity();
  if (stored) { current = stored; return current; }
  current = { accountId: existingAccountId() || randomId(), kind: 'guest', createdAt: Date.now() };
  writeIdentity(current);
  return current;
}

/** The namespace every per-player storage key is built from. */
export function accountId() { return identity().accountId; }

/**
 * localStorage key for a named per-account value: rk.<accountId>.<name>.
 *
 * It lives HERE — in the namespace owner — rather than in storage.js, because
 * economy.js needs it too and storage.js already imports economy.js. Defining
 * it there would make economy.js -> storage.js -> economy.js, and the key
 * format would then have to exist in two places, which is exactly how a
 * per-player key escapes namespacing in the first place.
 */
export const lsKey = (name) => `rk.${accountId()}.${name}`;

export function isGuest() { return identity().kind !== 'account'; }

/** Switch the whole storage layer onto a signed-in account's namespace. */
export function setAccountId(uid) {
  if (!ID_RE.test(String(uid || ''))) throw new Error('bad account id');
  const next = { accountId: String(uid), kind: 'account', createdAt: Date.now() };
  current = next;
  writeIdentity(next);
  mirrorAccountId(next.accountId);   // storage and sync must share one id
  for (const fn of listeners) { try { fn(next); } catch { /* a bad listener must not block the switch */ } }
  return next;
}

/** Return to the local guest slot (sign out). */
export function signOut() {
  const next = { accountId: randomId(), kind: 'guest', createdAt: Date.now() };
  current = next;
  writeIdentity(next);
  mirrorAccountId(next.accountId);   // sign-out must not keep the old server id
  for (const fn of listeners) { try { fn(next); } catch { /* ignore */ } }
  return next;
}

/** Subscribe to account switches. Returns an unsubscribe function. */
export function onAccountChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}
