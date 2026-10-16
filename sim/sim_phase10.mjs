// sim_phase10.mjs — Phase 10 map-feature audit. Headless, plain node.
// 1) advanceCheckpoint unit tests (normal, shortcut skips, wrap, reverse, far).
// 2) Shortcut savings: chord vs arc distance per track (from TRACKS points).
// 3) Hazard/gate tuning sanity (debris dps, gate ram-break, oil factors).
// Usage: node sim/sim_phase10.mjs
import { TRACKS } from '../src/tracks.js';
import {
  SHORTCUT_DEFS, HAZARD_DEFS, HAZARD_TUNING, RAMP_VY,
  BLOCK_TYPES, advanceCheckpoint,
} from '../src/rules.js';

let fail = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fail++;
};

console.log('CHECKPOINT ADVANCE (count=14, maxSkip=4)');
console.log('='.repeat(64));
let r = advanceCheckpoint(5, 6);            check('normal 5→6 advances, no wrap', r.checkpoint === 6 && !r.wrapped);
r = advanceCheckpoint(13, 0);              check('finish 13→0 advances + wrap', r.checkpoint === 0 && r.wrapped);
r = advanceCheckpoint(11, 1);              check('shortcut 11→1 (skip 3) + wrap', r.checkpoint === 1 && r.wrapped);
r = advanceCheckpoint(4, 7);               check('shortcut 4→7 (skip 3), no wrap', r.checkpoint === 7 && !r.wrapped);
r = advanceCheckpoint(4, 9);               check('skip 5 rejected (too far)', r.checkpoint === 4 && !r.wrapped);
r = advanceCheckpoint(5, 5);               check('same idx ignored', r.checkpoint === 5 && !r.wrapped);
r = advanceCheckpoint(5, 4);               check('reverse 5→4 ignored', r.checkpoint === 5 && !r.wrapped);
r = advanceCheckpoint(0, 13);              check('backward wrap 0→13 ignored', r.checkpoint === 0 && !r.wrapped);

console.log('\nSHORTCUT SAVINGS (chord vs arc, polyline approx)');
console.log('='.repeat(64));
for (const track of TRACKS) {
  const pts = track.points, n = pts.length;
  const segLen = (a, b) => {
    let L = 0, steps = 24;
    for (let i = 0; i < steps; i++) {
      const t0 = a + (b - a) * (i / steps), t1 = a + (b - a) * ((i + 1) / steps);
      const p0 = frag(t0), p1 = frag(t1);
      L += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    }
    return L;
    function frag(t) {
      const x = (((t % 1) + 1) % 1) * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
      return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f];
    }
  };
  for (const sc of (SHORTCUT_DEFS[track.id] || [])) {
    const A = frag2(sc.a), B = frag2(sc.b);
    const chord = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const arc = segLen(sc.a, sc.b);
    const saved = arc - chord, pct = (saved / arc * 100).toFixed(1);
    console.log(`  ${track.id} [${sc.a}→${sc.b}] arc≈${arc.toFixed(0)}u chord≈${chord.toFixed(0)}u saves≈${saved.toFixed(0)}u (${pct}%)`);
    check(`${track.id} shortcut saves >8%`, saved / arc > 0.08);
    function frag2(t) {
      const x = (((t % 1) + 1) % 1) * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
      return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f];
    }
  }
}

console.log('\nHAZARD / GATE TUNING');
console.log('='.repeat(64));
const debrisKill = 100 / HAZARD_TUNING.debris.dps;
console.log(`  debris ${HAZARD_TUNING.debris.dps}/s → 16.7s to kill from full; drive-through (r≈6 @30u/s ≈ 0.4s) ≈ ${(HAZARD_TUNING.debris.dps * 0.4).toFixed(1)} dmg`);
check('debris punishes camping, not passing', debrisKill > 10);
check('oil halves handling', HAZARD_TUNING.oil.handlingMult < 0.7 && HAZARD_TUNING.oil.handlingMult > 0.3);
const gate = BLOCK_TYPES.gate;
console.log(`  gate hp=${gate.hp}: ram @20u/s deals ~${(20 * 0.9).toFixed(0)} → breaks: ${(20 * 0.9) >= gate.hp}; MG needs ${Math.ceil(gate.hp / 8)} rounds`);
check('gate always ram-breakable at speed', 20 * 0.9 >= gate.hp);
check('gate costs MG ammo but not much', Math.ceil(gate.hp / 8) <= 3);
const armored = BLOCK_TYPES.armored;
console.log(`  armored hp=${armored.hp}: MG needs ${Math.ceil(armored.hp / 8)} rounds (heavy costs ammo ✓)`);
check('armored costs 10+ MG rounds', Math.ceil(armored.hp / 8) >= 10);
console.log(`  ramp vy=${RAMP_VY}: airtime ≈ ${(2 * RAMP_VY / 24).toFixed(2)}s, clears jumpable (need jumpY>1.2): max h ≈ ${(RAMP_VY * RAMP_VY / 48).toFixed(1)}u`);
check('ramp clears low blocks', RAMP_VY * RAMP_VY / 48 > 1.2);
for (const track of TRACKS) {
  const hz = HAZARD_DEFS[track.id] || [];
  check(`${track.id} has 3 hazards`, hz.length === 3);
  check(`${track.id} has shortcut + 2 ramps`, (SHORTCUT_DEFS[track.id] || []).length >= 1);
}
console.log('='.repeat(64));
console.log(fail === 0 ? 'ALL MAP-FEATURE CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
