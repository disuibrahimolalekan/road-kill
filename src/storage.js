// storage.js — Phase 3 offline-first persistence. No THREE imports.
// IndexedDB for profile/currency/match history/unlocks.
// LocalStorage for settings/session (audio, controls, last car).
// Sync-queue stub shaped like future backend API calls.
import { createDefaultProfile, getLevelFromXP, getTier } from './economy.js';
import { accountId, lsKey, setAccountId, signOut, isGuest, onAccountChange } from './identity.js';

export const DB_NAME = 'roadkill-db';
export const DB_VERSION = 1;

// STEP 2 — per-account namespacing. Everything a player *owns* (currency,
// unlocks, XP, stats, match history, queued sync ops) is addressed through
// accountId(), so two people on one browser can never read or write each
// other's record. The old keys are kept only as one-shot migration sources.
// See src/identity.js for the security model and its limits.
export const LEGACY_PROFILE_ID = 'main';           // pre-namespacing IDB record
export const LEGACY_PROFILE_KEY = 'rk.profile.v2'; // pre-namespacing LS mirror
export const LEGACY_SYNC_LS_KEY = 'rk.syncqueue.v1';

/** IDB record key for the active account's profile. */
export const profileKey = () => `${accountId()}:profile`;
/** localStorage key for a named per-account value. Defined in identity.js
 *  (the namespace owner) and re-exported here for existing callers. */
// The whole account API is re-exported from the namespace owner so callers get
// ONE instance of identity.js. Importing './identity.js' separately instead
// gives you a second copy under the dev server (Vite stamps its own imports
// with ?t=<mtime>), and switching accounts through that copy would move the
// key builder without moving storage's — the namespace would silently split.
export { accountId, lsKey, setAccountId, signOut, isGuest, onAccountChange };

// Settings stay DEVICE-scoped on purpose: audio, quality, touch controls and
// orientation are properties of the handset, not of the player, and main.js
// reads this key directly in three places. They carry no progress, so there
// is nothing to bridge between accounts.
export const SETTINGS_KEY = 'rk.settings.v1';
export const syncQueueKey = () => lsKey('syncqueue.v1');

function normalizeProfile(p) {
  const d = createDefaultProfile();
  if (!p || typeof p !== 'object') return d;
  const out = { ...d, ...p };
  if (!Array.isArray(out.unlockedSkins)) out.unlockedSkins = ['default'];
  if (!out.equippedSkin) out.equippedSkin = 'default';
  if (typeof out.coins !== 'number') out.coins = d.coins;
  if (typeof out.gems !== 'number') out.gems = d.gems;
  if (typeof out.xp !== 'number') out.xp = 0;
  out.level = getLevelFromXP(out.xp);
  out.tier = getTier(out.level).name;
  if (!out.stats || typeof out.stats !== 'object') out.stats = { ...d.stats };
  if (typeof out.seasonPoints !== 'number') out.seasonPoints = 0;
  if (!Array.isArray(out.seasonClaimed)) out.seasonClaimed = [];
  for (const k of ['races', 'wins', 'kills', 'coinsCollected', 'bestPos']) {
    if (typeof out.stats[k] !== 'number') out.stats[k] = d.stats[k] ?? 0;
  }
  out.version = 2;
  return out;
}

export function isIndexedDBAvailable() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

let dbPromise = null;
export function openDB() {
  if (!isIndexedDBAvailable()) return Promise.reject(new Error('indexeddb-unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { dbPromise = null; reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('idb-open-failed')); };
    req.onblocked = () => {};
  });
  return dbPromise;
}

function idbTx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(store, mode); } catch (e) { reject(e); return; }
    const os = tx.objectStore(store);
    let req;
    try { req = fn(os); } catch (e) { reject(e); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-op-failed'));
  }));
}

export const idbGet = (store, key) => idbTx(store, 'readonly', (os) => os.get(key));
export const idbPut = (store, val) => idbTx(store, 'readwrite', (os) => os.put(val));
export const idbAdd = (store, val) => idbTx(store, 'readwrite', (os) => os.add(val));
export function idbGetAll(store, limit = 100) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const out = [];
    let tx;
    try { tx = db.transaction(store, 'readonly'); } catch (e) { reject(e); return; }
    const cursorReq = tx.objectStore(store).openCursor(null, 'prev');
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur || out.length >= limit) { resolve(out); return; }
      out.push(cur.value);
      cur.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error || new Error('idb-cursor-failed'));
  }));
}
export function idbCount(store) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-count-failed'));
  }));
}
export function idbClear(store) {
  return idbTx(store, 'readwrite', (os) => os.clear());
}

// ---------- Profile (IndexedDB primary, localStorage mirror for sync gameplay) ----------
export async function loadProfileIDB() {
  try {
    const rec = await idbGet('profile', profileKey());
    if (rec && rec.data) return normalizeProfile(rec.data);
    return null;
  } catch { return null; }
}

// `key` is the namespace captured when the save was SCHEDULED, not when it
// lands. The write may be debounced by 250ms, and a sign-up page calls
// setAccountId() on the same tick it saves — resolving profileKey() at fire
// time would then store this player's profile under the next player's id,
// which is the cross-account bridge this module exists to prevent.
export async function saveProfileIDB(profile, key = profileKey()) {
  const data = normalizeProfile(profile);
  try {
    await idbPut('profile', { id: key, data, updatedAt: Date.now() });
  } catch {}
  return data;
}

export function loadProfileLS() {
  try {
    const raw = localStorage.getItem(lsKey('profile.v2'));
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch { return null; }
}

export function saveProfileLS(profile, key = lsKey('profile.v2')) {
  try {
    const data = normalizeProfile(profile);
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

// Device-scoped claim marker, NOT per-account. The pre-namespacing keys hold
// exactly one player's data, and they may be claimed only once — by whoever
// loads first (the guest slot). If this marker were namespaced, the next
// account to sign in would find it absent and re-copy the old player's coins
// and unlocks into the new account.
const LEGACY_CLAIMED_KEY = 'rk.legacy-claimed.v1';

export async function migrateLegacyStorage() {
  try { if (localStorage.getItem(LEGACY_CLAIMED_KEY)) return false; } catch { return false; }
  let moved = false;
  try {
    const legacy = localStorage.getItem(LEGACY_PROFILE_KEY);
    // Never overwrite a namespaced record that already exists.
    if (legacy && !localStorage.getItem(lsKey('profile.v2'))) {
      localStorage.setItem(lsKey('profile.v2'), legacy);
      moved = true;
    }
  } catch {}
  try {
    if (isIndexedDBAvailable()) {
      const rec = await idbGet('profile', LEGACY_PROFILE_ID);
      if (rec && rec.data && !(await idbGet('profile', profileKey()))) {
        await idbPut('profile', { id: profileKey(), data: rec.data, updatedAt: Date.now() });
        moved = true;
      }
    }
  } catch {}
  try { localStorage.setItem(LEGACY_CLAIMED_KEY, String(Date.now())); } catch {}
  return moved;
}

// Unified: IDB wins, else migrate LS, else default. Migrates LS -> IDB.
export async function loadProfileUnified() {
  await migrateLegacyStorage();   // keep an existing player's progress
  const fromIDB = await loadProfileIDB();
  if (fromIDB) { saveProfileLS(fromIDB); return fromIDB; }
  const fromLS = loadProfileLS();
  if (fromLS) { saveProfileIDB(fromLS); return fromLS; }
  const d = createDefaultProfile();
  saveProfileLS(d);
  saveProfileIDB(d);
  return d;
}

// Save to both + queue a backend-shaped sync op (fire-and-forget safe).
let saveTimer = 0;
export function saveProfileUnified(profile, opts = {}) {
  const data = normalizeProfile(profile);
  Object.assign(profile, data);
  // Capture the destination namespace NOW. The write below may be debounced by
  // 250ms; if setAccountId() runs in between, resolving profileKey()/lsKey()
  // at fire time would file this player's profile under the next player's id.
  // Both the immediate and the deferred write use this one capture.
  const nsId = profileKey();
  const lsId = lsKey('profile.v2');
  saveProfileLS(profile, lsId);
  if (opts.immediate) {
    saveProfileIDB(profile, nsId);
    if (!opts.noSync) enqueueSyncOp('profile.save', { coins: profile.coins, gems: profile.gems, xp: profile.xp, equippedSkin: profile.equippedSkin, unlockedSkins: profile.unlockedSkins, stats: profile.stats });
  } else {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveProfileIDB(profile, nsId);
      if (!opts.noSync) enqueueSyncOp('profile.save', { coins: profile.coins, gems: profile.gems, xp: profile.xp, equippedSkin: profile.equippedSkin, unlockedSkins: profile.unlockedSkins, stats: profile.stats });
    }, 250);
  }
  return profile;
}

// ---------- Settings / session (LocalStorage per spec) ----------
export function createDefaultSettings() {
  // STEP 1: swapSteer = left-handed pad sides, autoAccel = hold-free throttle.
  return { audio: true, quality: 'auto', touchControls: true, swapSteer: false, autoAccel: false, lastCar: 'default', lastPlayedAt: 0, installedAt: 0 };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return createDefaultSettings();
    return { ...createDefaultSettings(), ...JSON.parse(raw) };
  } catch { return createDefaultSettings(); }
}

export function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  return s;
}

// ---------- Match history (IndexedDB) ----------
export async function recordMatch(result) {
  const entry = {
    // STEP 2: the owner rides along on the record. The 'matches' store uses
    // auto-increment keys shared by every account on the device, so ownership
    // cannot be inferred from the key and must be carried explicitly.
    accountId: accountId(),
    date: Date.now(),
    rank: result.rank ?? 6,
    laps: result.laps ?? 3,
    kills: result.kills ?? 0,
    coinsBonus: result.coinsBonus ?? 0,
    xpGain: result.xpGain ?? 0,
    coinsCollected: result.coinsCollected ?? 0,
    durationSec: result.durationSec ?? 0,
  };
  try {
    const id = await idbAdd('matches', entry);
    entry.id = id;
    enqueueSyncOp('match.add', entry);
  } catch {}
  return entry;
}

export async function getMatches(limit = 20) {
  try {
    // STEP 2: only this account's races. Without the filter, history and the
    // stats derived from it (wins, best position, kills, XP) would be shared
    // by everyone who used the device. Entries written before this change
    // carry no accountId; they stay visible because in the single-slot era
    // they could only ever have belonged to whoever is playing now.
    const mine = accountId();
    const all = await idbGetAll('matches', Math.max(limit * 20, 400));
    return all.filter((m) => !m.accountId || m.accountId === mine).slice(0, limit);
  } catch { return []; }
}

export async function getMatchStats() {
  const list = await getMatches(200);
  const stats = { races: list.length, wins: 0, bestPos: 6, kills: 0, xp: 0, coins: 0 };
  for (const m of list) {
    if (m.rank === 1) stats.wins++;
    stats.bestPos = Math.min(stats.bestPos, m.rank || 6);
    stats.kills += m.kills || 0;
    stats.xp += m.xpGain || 0;
    stats.coins += m.coinsBonus || 0;
  }
  if (!list.length) stats.bestPos = 0;
  return stats;
}

// ---------- Sync-queue stub (shaped like future POST /api/sync) ----------
export function readLSQueue() {
  try {
    const raw = localStorage.getItem(syncQueueKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeLSQueue(arr) {
  try { localStorage.setItem(syncQueueKey(), JSON.stringify(arr.slice(-200))); } catch {}
}

export async function enqueueSyncOp(type, payload) {
  const op = {
    type,
    // Future backend shape: POST /api/sync { op, payload, clientTs }
    method: 'POST',
    path: '/api/sync',
    op: type,
    payload,
    clientTs: Date.now(),
    synced: false,
  };
  try {
    await idbAdd('syncQueue', op);
  } catch {
    const q = readLSQueue();
    q.push(op);
    writeLSQueue(q);
  }
  return op;
}

export async function getSyncQueue(limit = 100) {
  try {
    const rows = await idbGetAll('syncQueue', limit);
    return rows.filter((r) => !r.synced);
  } catch {
    return readLSQueue();
  }
}

export async function getSyncQueueCount() {
  try { return (await getSyncQueue(1000)).length; }
  catch { return 0; }
}

// Stub flush: would POST each op when backend exists. For now just marks them
// synced locally and returns what *would* have been sent.
export async function flushSyncQueueStub() {
  const pending = await getSyncQueue(200);
  if (!pending.length) return { sent: 0, ops: [] };
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) return { sent: 0, ops: [], reason: 'offline' };
  // No backend yet — mark IDB rows synced so queue doesn't grow forever.
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      const os = tx.objectStore('syncQueue');
      pending.forEach((op) => { if (op.id != null) os.put({ ...op, synced: true }); });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    writeLSQueue([]);
  }
  return { sent: pending.length, ops: pending.map((o) => ({ op: o.op || o.type, path: o.path, clientTs: o.clientTs })) };
}

// ---------- Service worker ----------
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve({ ok: false, reason: 'unsupported' });
  const isFile = location.protocol === 'file:';
  if (isFile) return Promise.resolve({ ok: false, reason: 'file-protocol' });
  return navigator.serviceWorker.register('./sw.js').then(
    (reg) => ({ ok: true, scope: reg.scope }),
    (err) => ({ ok: false, reason: String(err && err.message || err) }),
  );
}
