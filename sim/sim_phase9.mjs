// sim_phase9.mjs — Phase 9 audit. Headless, plain node.
// 1) Every vehicle finishes every track careful-style (fuel/speed math).
// 2) Weapon DPS + ammo table. 3) Shop totals + free/paid flags.
// Usage: node sim/sim_phase9.mjs
import { readFileSync } from 'fs';
import { TRACKS } from '../src/tracks.js';
import {
  setShopConfig, vehicleStats, CLASSES,
} from '../src/vehicles.js';
import { WEAPON_DEFS } from '../src/combat.js';
import {
  FUEL_PER_LAP, FUEL_PICKUP, fuelDrain, perfFactor, trackLengthApprox,
} from '../src/rules.js';

const SHOP = JSON.parse(readFileSync(new URL('../shop-config.json', import.meta.url), 'utf8'));
setShopConfig(SHOP);

const LAPS = 3, DT = 0.25;
let fail = 0;

console.log('PHASE 9 VEHICLE AUDIT — careful run, 1 can/lap, no boost spam');
console.log('='.repeat(86));
for (const v of SHOP.vehicles) {
  const st = vehicleStats(v.id, { engine: 0, armor: 0, tank: 0, suspension: 0 });
  const line = [];
  for (const track of TRACKS) {
    const total = trackLengthApprox(track.points) * LAPS;
    let dist = 0, fuel = st.fuel, t = 0, nextCan = (total / LAPS) * 0.5, cans = 0, laps = 0, nextLap = total / LAPS;
    const cruise = st.top * 0.85;
    while (dist < total && fuel > 0 && t < 1200) {
      const perf = perfFactor(fuel, st.hp);
      dist += cruise * perf.speed * DT;
      fuel = Math.max(0, fuel - fuelDrain(DT, { throttle: 0.7, boosting: false }) * st.fuelUse);
      t += DT;
      if (dist >= nextLap) { laps++; fuel = Math.min(st.fuel, fuel + FUEL_PER_LAP); nextLap += total / LAPS; }
      if (cans < LAPS && dist >= nextCan) { fuel = Math.min(st.fuel, fuel + FUEL_PICKUP); cans++; nextCan += total / LAPS; }
    }
    const ok = dist >= total;
    if (!ok) fail++;
    line.push(`${track.id}:${ok ? `OK f=${Math.round(fuel)}` : 'FAIL'}`);
  }
  console.log(`  ${v.name.padEnd(13)} [${v.class.padEnd(5)}] top=${st.top} hp=${st.hp} fuel=${st.fuel}x${st.fuelUse} slots=${st.slots} → ${line.join('  ')}`);
}

console.log('\nWEAPON TABLE (ballistics from combat.js, shop from shop-config.json)');
console.log('='.repeat(86));
for (const w of SHOP.weapons) {
  const d = WEAPON_DEFS[w.id];
  const dps = d && d.cooldown ? (d.damage * (d.volley || 1) / d.cooldown).toFixed(0) : '—';
  const fx = d ? [d.splash ? `splash${d.splash}` : null, d.empTime ? `emp${d.empTime}s` : null, d.homing ? 'homing' : null].filter(Boolean).join('+') || '—' : 'n/a';
  console.log(`  ${(d ? d.icon + ' ' : '') + w.name.padEnd(14)} dmg=${d ? d.damage * (d.volley || 1) : '?'} cd=${d ? d.cooldown : '?'}s dps≈${dps} raceAmmo=${w.raceAmmo} fx=${fx} price=${w.free || w.price === 0 ? 'FREE' : w.price + ' ' + w.currency} mountable=${w.mountable}`);
}

let gold = 0, gems = 0, freeCount = 0;
for (const v of SHOP.vehicles) { if (v.free || v.price === 0) freeCount++; else if (v.currency === 'gems') gems += v.price; else gold += v.price; }
for (const w of SHOP.weapons) { if (w.free || w.price === 0) freeCount++; else if (w.currency === 'gems') gems += w.price; else gold += w.price; }
for (const line of Object.values(SHOP.upgrades)) for (const lv of line.levels) { if (lv.free || lv.price === 0) freeCount++; else if (lv.currency === 'gems') gems += lv.price; else gold += lv.price; }
console.log('\nSHOP TOTALS: buy-everything = $' + gold + ' gold + ' + gems + ' gems · ' + freeCount + ' free entries · '
  + SHOP.vehicles.length + ' vehicles / ' + Object.keys(SHOP.upgrades).length + ' upgrade lines / ' + SHOP.weapons.length + ' weapons');
console.log('='.repeat(86));
console.log(fail === 0 ? 'ALL VEHICLE CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
