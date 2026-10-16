// sim_phase8.mjs — Phase 8 balance proof. Headless, runs with plain node.
// Proves: a careful run finishes every track; a careless run goes out.
// Usage: node sim/sim_phase8.mjs
import { TRACKS } from '../src/tracks.js';
import {
  FUEL_START, FUEL_MAX, fuelDrain, perfFactor, FUEL_PICKUP, FUEL_PER_LAP,
  MOUNTED_START_AMMO, AMMO_PICKUP, BLOCK_TYPES, BLOCK_COUNT, genRoadblocks,
  trackLengthApprox, mulberry32, hashSeed,
} from '../src/rules.js';

const LAPS = 3;
const DT = 0.25;

function simulate(track, style) {
  const rnd = mulberry32(hashSeed('sim-' + track.id + '-' + style)); // deterministic
  const lapLen = trackLengthApprox(track.points);
  const total = lapLen * LAPS;
  const blocks = genRoadblocks(track.id, BLOCK_COUNT);
  let dist = 0, fuel = FUEL_START, hp = 100, t = 0, laps = 0;
  let ammo = MOUNTED_START_AMMO, blockHits = 0, fuelCans = 0, boostUsed = 0;
  const cfg = {
    careful: { cruise: 34, throttle: 0.7, boostFrac: 0.03, hitPerLap: 0, cansPerLap: 1, dmgPerLap: 8 },
    normal:  { cruise: 37, throttle: 0.85, boostFrac: 0.10, hitPerLap: 2, cansPerLap: 1.0, dmgPerLap: 16 },
    wasteful: { cruise: 40, throttle: 1.0, boostFrac: 0.65, hitPerLap: 0, cansPerLap: 0, dmgPerLap: 10 },
    careless: { cruise: 42, throttle: 1.0, boostFrac: 0.30, hitPerLap: 4, cansPerLap: 0, dmgPerLap: 30 },
  }[style];
  const hitQueue = [];
  for (let lap = 0; lap < LAPS; lap++)
    for (let h = 0; h < cfg.hitPerLap; h++)
      hitQueue.push({ at: lapLen * (lap + rnd() * 0.9 + 0.05), heavy: h === 0 });
  hitQueue.sort((a, b) => a.at - b.at);
  let nextLapMark = lapLen;
  let cansTaken = 0;
  const totalCans = Math.round(cfg.cansPerLap * LAPS);
  let nextCanAt = lapLen * 0.5;
  const canInterval = total > 0 && totalCans > 0 ? total / totalCans : Infinity;
  while (dist < total && fuel > 0 && hp > 0) {
    const boosting = rnd() < cfg.boostFrac;
    if (boosting) boostUsed += DT;
    const perf = perfFactor(fuel, hp);
    const spd = cfg.cruise * perf.speed * (boosting ? 1.55 : 1);
    dist += spd * DT;
    fuel = Math.max(0, fuel - fuelDrain(DT, { throttle: cfg.throttle, boosting }));
    t += DT;
    while (hitQueue.length && dist >= hitQueue[0].at) {
      hitQueue.shift(); blockHits++;
      hp = Math.max(0, hp - (blockHits % 4 === 0 ? 22 : 10)); // every 4th hit is heavy
    }
    if (dist >= nextLapMark) {
      laps++;
      fuel = Math.min(FUEL_MAX, fuel + FUEL_PER_LAP);
      hp = Math.max(0, hp - cfg.dmgPerLap * 0.4); // wall scrapes + crossfire per lap
      nextLapMark += lapLen;
    }
    // cans are scooped continuously along the racing line, not at lap lines
    if (cansTaken < totalCans && dist >= nextCanAt) {
      fuel = Math.min(FUEL_MAX, fuel + FUEL_PICKUP); fuelCans++; cansTaken++;
      nextCanAt += canInterval;
    }
    if (t > 1200) break; // sanity cap
  }
  // ammo audit: ~3 MG rounds per light block destroyed + fights; half the cans are ammo
  const ammoCans = Math.round(cfg.cansPerLap * LAPS / 2);
  const ammoNeeded = blockHits * 3 + 30; // +30 for fights
  const ammoAvailable = MOUNTED_START_AMMO + ammoCans * AMMO_PICKUP;
  return {
    track: track.id, style, finished: dist >= total,
    fuelLeft: Math.round(fuel), hpLeft: Math.round(hp),
    timeSec: Math.round(t), laps, blockHits, fuelCans,
    ammoNeeded, ammoAvailable, ammoOk: ammoAvailable >= ammoNeeded,
  };
}

let fail = 0;
console.log('PHASE 8 BALANCE SIM — 3 laps, fuel/ammo/blocks');
console.log('='.repeat(78));
for (const track of TRACKS) {
  const lapLen = Math.round(trackLengthApprox(track.points));
  console.log(`\nTRACK ${track.id}  lap≈${lapLen}u  race≈${lapLen * LAPS}u`);
  for (const style of ['careful', 'normal', 'wasteful', 'careless']) {
    const r = simulate(track, style);
    const verdict = (style === 'careless' || style === 'wasteful')
      ? (!r.finished ? 'PASS (goes out as designed)' : 'FAIL (should NOT finish)')
      : (r.finished ? 'PASS' : 'FAIL (must finish)');
    if (verdict.startsWith('FAIL')) fail++;
    console.log(`  ${style.padEnd(8)} finish=${r.finished} fuel=${r.fuelLeft} hp=${r.hpLeft} t=${r.timeSec}s laps=${r.laps} blocksHit=${r.blockHits} cans=${r.fuelCans} ammo ${r.ammoNeeded}/${r.ammoAvailable} ${r.ammoOk ? 'ok' : 'SHORT'}  → ${verdict}`);
  }
}
console.log('\n' + '='.repeat(78));
console.log(fail === 0 ? 'ALL BALANCE CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
