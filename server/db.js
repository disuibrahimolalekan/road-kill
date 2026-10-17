// db.js — Phase 5 file-backed store. Same shape as SUPABASE_SCHEMA.sql tables
// (accounts, profiles, matches, leaderboard) so it can be swapped for Postgres.
// Currency is awarded by the server only — clients can never grant themselves.
// Phase 9: server-checked shop purchases (vehicles/upgrades/weapons) from shop-config.json.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AWARD_KILL_COINS, AWARD_KILL_XP, AWARD_FINISH_COINS, AWARD_FINISH_XP, SEASON_ID } from '../src/netproto.js';

const PATH = new URL('./db.json', import.meta.url);

let SHOP = null;
try {
  SHOP = JSON.parse(readFileSync(new URL('../shop-config.json', import.meta.url), 'utf8'));
} catch { SHOP = { vehicles: [], upgrades: {}, weapons: [] }; }
export function shopConfig() { return SHOP; }

let BANNERS = null;
try {
  BANNERS = JSON.parse(readFileSync(new URL('../banners-config.json', import.meta.url), 'utf8'));
} catch { BANNERS = { brands: [], people: [] }; }
export function bannerConfig() { return BANNERS; }
export function bannerIds() {
  return [...(BANNERS.brands || []), ...(BANNERS.people || [])].map((b) => b.id);
}

function blank() {
  return { accounts: {}, matches: [], seq: 1 };
}

export function loadDB() {
  try {
    if (existsSync(PATH)) return { ...blank(), ...JSON.parse(readFileSync(PATH, 'utf8')) };
  } catch {}
  return blank();
}

let saveTimer = null;
export function saveDB(db) {
  // debounced so 20Hz ticks never touch disk
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeFileSync(PATH, JSON.stringify(db)); } catch {}
  }, 1000);
}

export function saveDBNow(db) {
  try { writeFileSync(PATH, JSON.stringify(db)); } catch {}
}

function profileOf(db, accountId) {
  if (!db.accounts[accountId]) {
    db.accounts[accountId] = {
      id: accountId, name: 'Racer', skin: 'default',
      coins: 80, gems: 14, gold: 0, xp: 0,
      stats: { races: 0, wins: 0, kills: 0, bestPos: 6 },
      seasonPoints: 0, seasonId: SEASON_ID,
      inventory: { vehicles: ['falcon_s'], weapons: ['mg'], upgrades: {}, skins: ['default'] },
      createdAt: Date.now(), lastSeen: Date.now(),
    };
  }
  const p = db.accounts[accountId];
  if (typeof p.coins !== 'number') p.coins = (typeof p.money === 'number') ? p.money : 80;
  delete p.money; // Phase 14 rename
  if (typeof p.gold !== 'number') p.gold = 0;
  if (!p.inventory) p.inventory = { vehicles: ['falcon_s'], weapons: ['mg'], upgrades: {}, skins: ['default'] };
  if (!Array.isArray(p.inventory.vehicles)) p.inventory.vehicles = ['falcon_s'];
  if (!Array.isArray(p.inventory.weapons)) p.inventory.weapons = ['mg'];
  if (!Array.isArray(p.inventory.skins)) p.inventory.skins = ['default'];
  if (!p.inventory.upgrades) p.inventory.upgrades = {};
  return p;
}

export function getOrCreateAccount(db, accountId, name, skin) {
  const p = profileOf(db, accountId || ('g' + Math.random().toString(36).slice(2, 10)));
  if (name) p.name = String(name).slice(0, 16);
  if (skin) p.skin = String(skin).slice(0, 24);
  p.lastSeen = Date.now();
  saveDB(db);
  return p;
}

// Server-side kill award. Returns {coins, xp} granted.
export function awardKill(db, killerAccountId) {
  const p = profileOf(db, killerAccountId);
  p.coins += AWARD_KILL_COINS;
  p.xp += AWARD_KILL_XP;
  p.seasonPoints += AWARD_KILL_XP;
  p.stats.kills++;
  saveDB(db);
  return { coins: AWARD_KILL_COINS, xp: AWARD_KILL_XP };
}

// Server-side finish award. rank is validated by caller (1..6, room size).
export function awardFinish(db, accountId, rank) {
  const p = profileOf(db, accountId);
  const i = Math.max(0, Math.min(5, (rank | 0) - 1));
  const coins = AWARD_FINISH_COINS[i], xp = AWARD_FINISH_XP[i];
  p.coins += coins;
  p.xp += xp;
  p.seasonPoints += xp;
  p.stats.races++;
  if (rank === 1) p.stats.wins++;
  p.stats.bestPos = Math.min(p.stats.bestPos || 6, rank);
  db.matches.push({ id: db.seq++, accountId, rank, coins, xp, date: Date.now(), season: SEASON_ID });
  if (db.matches.length > 500) db.matches.splice(0, db.matches.length - 500);
  saveDB(db);
  return { coins, xp };
}

export function leaderboard(db, limit = 10) {
  return Object.values(db.accounts)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((p) => ({ name: p.name, xp: p.xp, wins: p.stats.wins, races: p.stats.races }));
}

// ---------- PHASE 11 — banners: 24h-only stats (views/bumps/likes) ----------
// Nothing older than 24h is kept. Shape is admin-friendly for the later project.
export const BANNER_WINDOW_MS = 24 * 3600 * 1000;
function bannerState(db) {
  if (!db.banners) db.banners = {};
  return db.banners;
}
function pruneTs(list, now) {
  return (list || []).filter((ts) => now - ts < BANNER_WINDOW_MS);
}
// One like per account per banner per calendar day.
function likeKey(id, accountId, now) {
  return `${id}:${accountId}:${new Date(now).toISOString().slice(0, 10)}`;
}
export function recordBanner(db, accountId, action, id) {
  const now = Date.now();
  if (!['view', 'bump', 'like'].includes(action)) return { ok: false, reason: 'no-action' };
  if (!bannerIds().includes(id)) return { ok: false, reason: 'no-item' };
  const st = bannerState(db);
  if (!st[id]) st[id] = { views: [], bumps: [], likes: [], likeKeys: {} };
  const b = st[id];
  b.views = pruneTs(b.views, now); b.bumps = pruneTs(b.bumps, now); b.likes = pruneTs(b.likes, now);
  for (const k of Object.keys(b.likeKeys)) {
    if (now - b.likeKeys[k] > BANNER_WINDOW_MS) delete b.likeKeys[k];
  }
  if (action === 'like') {
    const k = likeKey(id, accountId, now);
    if (b.likeKeys[k]) return { ok: false, reason: 'liked' };
    b.likeKeys[k] = now;
    b.likes.push(now);
  } else if (action === 'bump') {
    b.bumps.push(now);
  } else {
    b.views.push(now);
  }
  saveDB(db);
  return { ok: true, action, id };
}
export function bannerSummary(db, windowH = 24) {
  const now = Date.now(), win = Math.min(24, Math.max(1, windowH | 0 || 24)) * 3600 * 1000;
  const out = {};
  const st = bannerState(db);
  for (const id of bannerIds()) {
    const b = st[id] || { views: [], bumps: [], likes: [] };
    out[id] = {
      views: b.views.filter((ts) => now - ts < win).length,
      bumps: (b.bumps || []).filter((ts) => now - ts < win).length,
      likes: (b.likes || []).filter((ts) => now - ts < win).length,
      windowH: win / 3600000,
    };
  }
  return out;
}

// Phase 9 — server-checked shop. Prices/flags come from shop-config.json;
// the client can never grant itself items or currency.
// vehicle: vehicle id for upgrade purchases (undefined otherwise).
export function buyItem(db, accountId, kind, item, level, vehicle) {
  const p = profileOf(db, accountId);
  const inv = p.inventory;
  const charge = (price, currency) => {
    if (price === 0) return true;
    if (currency === 'gems') { if (p.gems < price) return false; p.gems -= price; }
    else { if (p.coins < price) return false; p.coins -= price; }
    return true;
  };
  const done = (extra = {}) => {
    saveDB(db);
    return { ok: true, kind, item, coins: p.coins, gems: p.gems, inventory: inv, ...extra };
  };
  if (kind === 'vehicle') {
    const v = SHOP.vehicles.find((x) => x.id === item);
    if (!v) return { ok: false, reason: 'no-item' };
    if (inv.vehicles.includes(item)) return { ok: false, reason: 'owned' };
    if (!charge(v.price, v.currency)) return { ok: false, reason: 'funds' };
    inv.vehicles.push(item);
    return done({ price: v.price, currency: v.currency });
  }
  if (kind === 'weapon') {
    const w = SHOP.weapons.find((x) => x.id === item);
    if (!w) return { ok: false, reason: 'no-item' };
    if (inv.weapons.includes(item)) return { ok: false, reason: 'owned' };
    if (!charge(w.price, w.currency)) return { ok: false, reason: 'funds' };
    inv.weapons.push(item);
    return done({ price: w.price, currency: w.currency });
  }
  if (kind === 'upgrade') {
    // item = upgrade line, level = next level index, vehicle = vehicle id
    const U = SHOP.upgrades[item];
    const vid = vehicle;
    if (!U || !vid || !Number.isInteger(level) || level < 1 || level >= U.levels.length)
      return { ok: false, reason: 'no-item' };
    if (!SHOP.vehicles.some((x) => x.id === vid)) return { ok: false, reason: 'no-item' };
    if (!inv.vehicles.includes(vid)) return { ok: false, reason: 'locked' };
    if (!inv.upgrades[vid]) inv.upgrades[vid] = {};
    const cur = inv.upgrades[vid][item] | 0;
    if (level !== cur + 1) return { ok: false, reason: 'level' };
    const cost = U.levels[level];
    if (!charge(cost.price, cost.currency)) return { ok: false, reason: 'funds' };
    inv.upgrades[vid][item] = level;
    return done({ price: cost.price, currency: cost.currency, level, vehicle: vid });
  }
  return { ok: false, reason: 'no-item' };
}

// ---------- PHASE 12 — server-owned revives + ammo ledger ----------
// Gem revive costs mirror the client tiers; the server counts successful
// revives per race (room resets the counter on LOADOUT/FINISH/JOIN).
export const REVIVE_GEM_COSTS = [1, 5, 30];
export function serverRevive(db, accountId, usedCount) {
  if (!Number.isInteger(usedCount) || usedCount < 0) return { ok: false, reason: 'level' };
  if (usedCount >= REVIVE_GEM_COSTS.length) return { ok: false, reason: 'wrecked-out' };
  const cost = REVIVE_GEM_COSTS[usedCount];
  const p = profileOf(db, accountId);
  if (p.gems < cost) return { ok: false, reason: 'funds' };
  p.gems -= cost;
  saveDB(db);
  return { ok: true, cost, gems: p.gems };
}
// Build a bounded ammo ledger from a LOADOUT: raceAmmo ×2 headroom covers
// legit pickup refills; anything beyond is rejected (full pickup authority = later).
export function loadoutAmmoLedger(mounts) {
  const ledger = { mg: 300 };
  for (const m of mounts || []) {
    if (!m || typeof m.type !== 'string') continue;
    const race = Math.max(0, Math.min(999, m.ammo | 0));
    ledger[m.type.slice(0, 12)] = Math.max(ledger[m.type.slice(0, 12)] || 0, race * 2);
  }
  return ledger;
}

// Phase 13 — server-minted coins tokens (replaces the local wallet).
// Bounded per claim so collectors can't invent cash.
export const TOKEN_MAX_VALUE = 48;
export function awardToken(db, accountId, value) {
  const v = Math.max(0, Math.min(TOKEN_MAX_VALUE, value | 0));
  if (!v) return { coins: 0 };
  const p = profileOf(db, accountId);
  p.coins += v;
  p.stats.coinsCollected = (p.stats.coinsCollected || 0) + v;
  saveDB(db);
  return { coins: v };
}
