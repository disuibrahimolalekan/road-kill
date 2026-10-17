// rules.js — Phase 8 race rules + resources. Pure JS, no THREE, no DOM.
// Imported by src/main.js (rendering) AND sim/sim_phase8.mjs (headless balance tests).

export const FUEL_MAX = 100;
export const FUEL_START = 60;
// drain per second
export const FUEL_BASE = 0.55;      // engine idling/driving
export const FUEL_THROTTLE = 0.45;  // extra at full throttle
export const FUEL_BOOST = 2.3;      // extra while boosting
export const FUEL_PICKUP = 20;      // fuel-can bonus
export const FUEL_PER_LAP = 16;     // pit-stop bonus per completed lap
export const FUEL_REVIVE = 45;      // fuel granted on gem revive

export function fuelDrain(dt, { throttle = 0.5, boosting = false } = {}) {
  return (FUEL_BASE + FUEL_THROTTLE * Math.max(0, throttle) + (boosting ? FUEL_BOOST : 0)) * dt;
}

// Gradual, sensible degradation. Never sudden: smooth factors, crawl floor while fuel lasts.
export function perfFactor(fuel, hp) {
  const fuelNorm = Math.max(0, Math.min(1, fuel / FUEL_MAX));
  const dmgNorm = Math.max(0, Math.min(1, hp / 100));
  const fuelF = 0.35 + 0.65 * fuelNorm;      // 0.35 at empty .. 1.0 full
  const dmgF = 0.45 + 0.55 * dmgNorm;        // 0.45 wrecked .. 1.0 pristine
  const speed = Math.max(0.18, Math.min(1, fuelF * dmgF));
  const accel = Math.max(0.25, Math.min(1, (0.4 + 0.6 * fuelNorm) * (0.5 + 0.5 * dmgNorm)));
  const handling = Math.max(0.4, Math.min(1, 0.55 + 0.45 * dmgNorm));
  return { speed, accel, handling };
}

// Mounted (non-expiring) gun. Pickups stay bonus extras that still expire.
export const MOUNTED_START_AMMO = 150;
export const MOUNTED_MAX_AMMO = 300;
export const MOUNTED_REVIVE_AMMO = 120;
export const AMMO_PICKUP = 60; // ammo-box bonus

// Roadblocks. destructible: weapons break them. heavy: costs lots of ammo.
// jumpable: Phase 7 jump clears them when airborne high enough.
export const BLOCK_TYPES = {
  cone:    { hp: 20,  dmg: 8,  slow: 0.62, destructible: true,  heavy: false, jumpable: true,  r: 1.7, label: 'CONE' },
  barrier: { hp: 45,  dmg: 12, slow: 0.55, destructible: true,  heavy: false, jumpable: true,  r: 2.1, label: 'BARRIER' },
  armored: { hp: 120, dmg: 24, slow: 0.40, destructible: true,  heavy: true,  jumpable: false, r: 2.4, label: 'ARMORED' },
  tires:   { hp: -1,  dmg: 16, slow: 0.50, destructible: false, heavy: true,  jumpable: false, r: 2.2, label: 'TIRE WALL' },
  gate:    { hp: 12,  dmg: 2,  slow: 0.92, destructible: true,  heavy: false, jumpable: false, r: 2.2, label: 'CRASH GATE' },
};
export const BLOCK_COUNT = 14;
export const BLOCK_RESPAWN_S = 20;
export const BLOCK_RAM_DMG = 30; // ram damage dealt TO a destructible block, scaled by speed

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Deterministic per-track layout: same blocks every race on a track.
export function genRoadblocks(trackId, count = BLOCK_COUNT) {
  const rnd = mulberry32(hashSeed('rk-block-' + trackId));
  const keys = Object.keys(BLOCK_TYPES);
  const out = [];
  for (let i = 0; i < count; i++) {
    const trackT = (i + 0.5) / count + (rnd() - 0.5) * 0.02;
    const type = keys[Math.floor(rnd() * keys.length)];
    const lateral = (rnd() - 0.5) * 12; // -6..6 inside 22u road
    out.push({ id: i, type, trackT: ((trackT % 1) + 1) % 1, lateral });
  }
  return out;
}

// Approx track length (m) from control points; curve factor accounts for Catmull-Rom smoothing.
export function trackLengthApprox(points) {
  let L = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L * 1.08;
}

// ---------- PHASE 10 — map features (pure data + pure helpers) ----------
// Shortcuts: chords cutting a corner between two loop fractions. Cars inside
// the corridor skip the wall clamp; checkpoints tolerate skips up to 4.
export const SHORTCUT_DEFS = {
  sunset: [{ a: 0.06, b: 0.24, width: 9 }],
  canyon: [{ a: 0.30, b: 0.48, width: 9 }],
  volcano: [{ a: 0.55, b: 0.74, width: 9 }],
};
// Hazards: oil (slicken handling) + debris (damage field). Fractions of loop.
export const HAZARD_DEFS = {
  sunset: [
    { t: 0.38, lateral: -3, r: 6, type: 'oil' },
    { t: 0.62, lateral: 4, r: 5.5, type: 'debris' },
    { t: 0.85, lateral: 0, r: 6, type: 'oil' },
  ],
  canyon: [
    { t: 0.15, lateral: 3, r: 5.5, type: 'debris' },
    { t: 0.60, lateral: -4, r: 6, type: 'oil' },
    { t: 0.88, lateral: 2, r: 5, type: 'debris' },
  ],
  volcano: [
    { t: 0.20, lateral: -2, r: 6, type: 'oil' },
    { t: 0.45, lateral: 5, r: 5.5, type: 'debris' },
    { t: 0.90, lateral: -4, r: 6, type: 'oil' },
  ],
};
export const HAZARD_TUNING = {
  oil: { handlingMult: 0.55, lateralGrip: 0.35, effectTime: 1.5 },
  debris: { dps: 6, slowPerSec: 0.4 },
};
export const RAMP_DEFS = {
  sunset: [{ t: 0.33, lateral: 0 }, { t: 0.78, lateral: -4 }],
  canyon: [{ t: 0.10, lateral: 2 }, { t: 0.70, lateral: 0 }],
  volcano: [{ t: 0.40, lateral: -3 }, { t: 0.82, lateral: 3 }],
};
export const RAMP_VY = 11;
export const SHORTCUT_BONUS = 10;

// Checkpoint advance with shortcut tolerance. count = checkpoints per lap.
export function advanceCheckpoint(cur, seen, count = 14, maxSkip = 4) {
  const diff = (((seen - cur) % count) + count) % count;
  if (diff >= 1 && diff <= maxSkip) return { checkpoint: seen, wrapped: seen < cur };
  return { checkpoint: cur, wrapped: false };
}
