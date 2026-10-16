// storage.js — Phase 3 offline-first persistence. No THREE imports.
// IndexedDB for profile/currency/match history/unlocks.
// LocalStorage for settings/session (audio, controls, last car).
// Sync-queue stub shaped like future backend API calls.
import { createDefaultProfile, getLevelFromXP, getTier } from './economy.js';

export const DB_NAME = 'roadkill-db';
export const DB_VERSION = 1;
export const PROFILE_ID = 'main';
export const LEGACY_PROFILE_KEY = 'rk.profile.v2';
export const SETTINGS_KEY = 'rk.settings.v1';
export const SYNC_LS_FALLBACK_KEY = 'rk.syncqueue.v1';

function normalizeProfile(p) {
  const d = createDefaultProfile();
  if (!p || typeof p !== 'object') return d;
  const out = { ...d, ...p };
  if (!Array.isArray(out.unlockedSkins)) out.unlockedSkins = ['default'];
  if (!out.equippedSkin) out.equippedSkin = 'default';
  if (typeof out.money !== 'number') out.money = d.money;
  if (typeof out.gems !== 'number') out.gems = d.gems;
  if (typeof out.xp !== 'number') out.xp = 0;
  out.level = getLevelFromXP(out.xp);
  out.tier = getTier(out.level).name;
  if (!out.stats || typeof out.stats !== 'object') out.stats = { ...d.stats };
  if (typeof out.seasonPoints !== 'number') out.seasonPoints = 0;
  if (!Array.isArray(out.seasonClaimed)) out.seasonClaimed = [];
  for (const k of ['races', 'wins', 'kills', 'moneyCollected', 'bestPos']) {
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
    const rec = await idbGet('profile', PROFILE_ID);
    if (rec && rec.data) return normalizeProfile(rec.data);
    return null;
  } catch { return null; }
}

export async function saveProfileIDB(profile) {
  const data = normalizeProfile(profile);
  try {
    await idbPut('profile', { id: PROFILE_ID, data, updatedAt: Date.now() });
  } catch {}
  return data;
}

export function loadProfileLS() {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch { return null; }
}

export function saveProfileLS(profile) {
  try {
    const data = normalizeProfile(profile);
    localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(data));
  } catch {}
}

// Unified: IDB wins, else migrate LS, else default. Migrates LS -> IDB.
export async function loadProfileUnified() {
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
  saveProfileLS(profile);
  if (opts.immediate) {
    saveProfileIDB(profile);
    if (!opts.noSync) enqueueSyncOp('profile.save', { money: profile.money, gems: profile.gems, xp: profile.xp, equippedSkin: profile.equippedSkin, unlockedSkins: profile.unlockedSkins, stats: profile.stats });
  } else {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveProfileIDB(profile);
      if (!opts.noSync) enqueueSyncOp('profile.save', { money: profile.money, gems: profile.gems, xp: profile.xp, equippedSkin: profile.equippedSkin, unlockedSkins: profile.unlockedSkins, stats: profile.stats });
    }, 250);
  }
  return profile;
}

// ---------- Settings / session (LocalStorage per spec) ----------
export function createDefaultSettings() {
  return { audio: true, quality: 'auto', touchControls: true, lastCar: 'default', lastPlayedAt: 0, installedAt: 0 };
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
    date: Date.now(),
    rank: result.rank ?? 6,
    laps: result.laps ?? 3,
    kills: result.kills ?? 0,
    moneyBonus: result.moneyBonus ?? 0,
    xpGain: result.xpGain ?? 0,
    moneyCollected: result.moneyCollected ?? 0,
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
  try { return await idbGetAll('matches', limit); }
  catch { return []; }
}

export async function getMatchStats() {
  const list = await getMatches(200);
  const stats = { races: list.length, wins: 0, bestPos: 6, kills: 0, xp: 0, money: 0 };
  for (const m of list) {
    if (m.rank === 1) stats.wins++;
    stats.bestPos = Math.min(stats.bestPos, m.rank || 6);
    stats.kills += m.kills || 0;
    stats.xp += m.xpGain || 0;
    stats.money += m.moneyBonus || 0;
  }
  if (!list.length) stats.bestPos = 0;
  return stats;
}

// ---------- Sync-queue stub (shaped like future POST /api/sync) ----------
export function readLSQueue() {
  try {
    const raw = localStorage.getItem(SYNC_LS_FALLBACK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeLSQueue(arr) {
  try { localStorage.setItem(SYNC_LS_FALLBACK_KEY, JSON.stringify(arr.slice(-200))); } catch {}
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
