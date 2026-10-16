// vehicles.js — Phase 9 catalog + shop logic. Pure JS (no THREE, no DOM).
// Prices/flags live in shop-config.json (game root). This module never reads
// the file itself so it runs in browser (Vite JSON import), Node sims, and
// the server alike — each host injects the config via setShopConfig().
let SHOP = null;

export function setShopConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.vehicles)) throw new Error('bad shop config');
  SHOP = cfg;
  return true;
}
export function shop() {
  if (!SHOP) throw new Error('shop config not loaded — call setShopConfig first');
  return SHOP;
}

export const CLASSES = ['super', 'scifi', 'war', 'tank', 'crazy'];
export const CLASS_NAMES = { super: 'SUPERCAR', scifi: 'SCI-FI', war: 'WAR', tank: 'TANK', crazy: 'CRAZY' };

export function vehicle(id) { return shop().vehicles.find((v) => v.id === id) || null; }
export function vehiclesByClass(cls) { return shop().vehicles.filter((v) => v.class === cls); }
export function shopWeapon(id) { return shop().weapons.find((w) => w.id === id) || null; }
export function mountableWeapons() { return shop().weapons.filter((w) => w.mountable); }

export function upgLevels(profile, vehicleId) {
  const u = (profile.upgrades && profile.upgrades[vehicleId]) || {};
  return { engine: u.engine | 0, armor: u.armor | 0, tank: u.tank | 0, suspension: u.suspension | 0 };
}

// Effective stats with upgrades applied. Levels index into levels[] (0 = stock).
export function vehicleStats(vehicleId, levels = { engine: 0, armor: 0, tank: 0, suspension: 0 }) {
  const v = vehicle(vehicleId);
  if (!v) return null;
  const U = shop().upgrades;
  const e = U.engine.levels[Math.min(levels.engine, U.engine.levels.length - 1)] || {};
  const a = U.armor.levels[Math.min(levels.armor, U.armor.levels.length - 1)] || {};
  const t = U.tank.levels[Math.min(levels.tank, U.tank.levels.length - 1)] || {};
  const s = U.suspension.levels[Math.min(levels.suspension, U.suspension.levels.length - 1)] || {};
  return {
    id: v.id, name: v.name, cls: v.class, slots: v.slots,
    top: v.top + (e.top || 0),
    accel: v.accel + (e.accel || 0),
    handling: v.handling + (s.handling || 0),
    hp: v.hp + (a.hp || 0),
    fuel: v.fuel + (t.fuel || 0),
    fuelUse: Math.max(0.5, v.fuelUse + (t.use || 0)),
    levels,
  };
}

export function upgradeCost(line, curLevel) {
  const U = shop().upgrades[line];
  if (!U) return null;
  const next = curLevel + 1;
  if (next >= U.levels.length) return null; // maxed
  return { ...U.levels[next], line, level: next, maxed: false };
}
export function maxUpgradeLevel(line) { return shop().upgrades[line].levels.length - 1; }

export function priceText(item) {
  if (!item || item.price === 0 || item.free) return 'FREE';
  return item.currency === 'gems' ? `${item.price} 💎` : `$${item.price}`;
}
function canAfford(profile, price, currency) {
  return currency === 'gems' ? profile.gems >= price : profile.money >= price;
}
function pay(profile, price, currency) {
  if (price === 0) return true;
  if (currency === 'gems') { if (profile.gems < price) return false; profile.gems -= price; }
  else { if (profile.money < price) return false; profile.money -= price; }
  return true;
}

// ---- local (solo) purchase validation. Online: server runs the same checks
// in server/shop.js shape — client only applies after BUY_OK. ----
export function buyVehicle(profile, id, opts = {}) {
  const v = vehicle(id);
  if (!v) return { ok: false, reason: 'no-item' };
  migrateShop(profile);
  if (profile.vehicles.includes(id)) return { ok: false, reason: 'owned' };
  if (!opts.server && !pay(profile, v.price, v.currency)) return { ok: false, reason: 'funds' };
  profile.vehicles.push(id);
  return { ok: true, price: v.price, currency: v.currency };
}
export function buyUpgrade(profile, vehicleId, line, opts = {}) {
  const v = vehicle(vehicleId);
  if (!v) return { ok: false, reason: 'no-item' };
  migrateShop(profile);
  if (!profile.vehicles.includes(vehicleId)) return { ok: false, reason: 'locked' };
  const cur = upgLevels(profile, vehicleId)[line] | 0;
  const cost = upgradeCost(line, cur);
  if (!cost) return { ok: false, reason: 'maxed' };
  if (!opts.server && !pay(profile, cost.price, cost.currency)) return { ok: false, reason: 'funds' };
  if (!profile.upgrades[vehicleId]) profile.upgrades[vehicleId] = {};
  profile.upgrades[vehicleId][line] = cost.level;
  return { ok: true, price: cost.price, currency: cost.currency, level: cost.level };
}
export function buyWeapon(profile, id, opts = {}) {
  const w = shopWeapon(id);
  if (!w) return { ok: false, reason: 'no-item' };
  migrateShop(profile);
  if (profile.weapons.includes(id)) return { ok: false, reason: 'owned' };
  if (!opts.server && !pay(profile, w.price, w.currency)) return { ok: false, reason: 'funds' };
  profile.weapons.push(id);
  return { ok: true, price: w.price, currency: w.currency };
}
export function equipVehicle(profile, id) {
  migrateShop(profile);
  if (!profile.vehicles.includes(id)) return { ok: false, reason: 'locked' };
  profile.equippedVehicle = id;
  // mounts that no longer fit (slots/weapon sold?) fall back to mg
  const st = vehicleStats(id, upgLevels(profile, id));
  const owned = (w) => w && (profile.weapons.includes(w) || w === 'mg');
  if (!owned(profile.mounts.slot1)) profile.mounts.slot1 = 'mg';
  if (st.slots < 2) profile.mounts.slot2 = null;
  else if (!owned(profile.mounts.slot2)) profile.mounts.slot2 = null;
  return { ok: true };
}
export function setMount(profile, slot, weaponId) {
  migrateShop(profile);
  const w = shopWeapon(weaponId);
  if (!w || !w.mountable) return { ok: false, reason: 'no-item' };
  if (!profile.weapons.includes(weaponId)) return { ok: false, reason: 'locked' };
  const st = vehicleStats(profile.equippedVehicle, upgLevels(profile, profile.equippedVehicle));
  const maxSlot = st ? st.slots : 1;
  if (slot < 1 || slot > maxSlot) return { ok: false, reason: 'no-slot' };
  profile.mounts['slot' + slot] = weaponId;
  return { ok: true };
}

// Backfill for profiles saved before Phase 9.
export function migrateShop(profile) {
  if (!Array.isArray(profile.vehicles)) profile.vehicles = ['falcon_s'];
  if (!profile.equippedVehicle) profile.equippedVehicle = profile.vehicles[0] || 'falcon_s';
  if (!Array.isArray(profile.weapons)) profile.weapons = ['mg'];
  if (!profile.mounts) profile.mounts = { slot1: 'mg', slot2: null };
  if (!profile.upgrades) profile.upgrades = {};
  return profile;
}
