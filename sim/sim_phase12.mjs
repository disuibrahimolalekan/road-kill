// sim_phase12.mjs — Phase 12 launch integration test. Boots the real server on
// :8140, drives it with real ws clients: practice rooms, loadout, ammo ledger,
// server revive ladder, banner events, admin HTTP. Kills the server after.
// Usage: node sim/sim_phase12.mjs
import { spawn } from 'child_process';
import { copyFileSync, existsSync, unlinkSync } from 'fs';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';

const PORT = 8140;
// never pollute the real ledger with sim accounts: back up + restore db.json
const DBP = new URL('../server/db.json', import.meta.url);
const BAKP = new URL('../server/db.json.sim12-bak', import.meta.url);
let hadDb = false;
try { copyFileSync(DBP, BAKP); hadDb = true; } catch {}
let fail = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const inbox = [];
    ws.on('message', (buf) => { try { inbox.push(JSON.parse(buf.toString())); } catch {} });
    ws.on('open', () => resolve({ ws, inbox }));
    ws.on('error', reject);
  });
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
async function waitFor(c, pred, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = c.inbox.findIndex(pred);
    if (i >= 0) return c.inbox.splice(i, 1)[0];
    await sleep(50);
  }
  return null;
}
const get = async (path) => {
  const r = await fetch(`http://localhost:${PORT}${path}`);
  return r.json();
};

const srv = spawn('node', ['server.js', String(PORT)], { cwd: new URL('../server/', import.meta.url).pathname });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(250);
  try { await get('/api/health'); ready = true; } catch {}
}
try {
  check('server boots with admin API', ready);
  if (!ready) throw new Error('no server');

  console.log('PRACTICE + ACCOUNT');
  console.log('='.repeat(64));
  const a = await connect();
  send(a, { type: 'hello', name: 'SimA', accountId: 'sim-a' });
  const acc = await waitFor(a, (m) => m.type === 'account');
  check('account issued with inventory', !!acc && !!acc.accountId && Array.isArray(acc.inventory.vehicles));
  send(a, { type: 'join', mode: 'practice' });
  const joined = await waitFor(a, (m) => m.type === 'joined');
  check('practice room joined (practice flag)', !!joined && joined.practice === true);
  const b = await connect();
  send(b, { type: 'hello', name: 'SimB', accountId: 'sim-b' });
  await waitFor(b, (m) => m.type === 'account');
  send(b, { type: 'join', mode: 'practice' });
  const joinedB = await waitFor(b, (m) => m.type === 'joined');
  check('practice rooms isolated (own room each)', !!joinedB && joinedB.roomCode !== joined.roomCode);

  console.log('\nLOADOUT + AMMO LEDGER');
  console.log('='.repeat(64));
  send(a, { type: 'loadout', vehicle: 'falcon_s', mounts: [{ type: 'plasma', ammo: 14 }], fuel: 70 });
  await sleep(200);
  let fires = 0, noAmmo = 0;
  for (let i = 0; i < 30; i++) {
    send(a, { type: 'fire', weapon: 'plasma', yaw: 0 });
    await sleep(100); // under the 12/s flood limit
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    const e = a.inbox.findIndex((m) => m.type === 'error' && m.reason === 'no-ammo');
    if (e >= 0) { noAmmo++; a.inbox.splice(e, 1); }
    else await sleep(100);
  }
  // ledger = 14×2 = 28; 30 shots → ≥1 rejected (extra shots may also flood-limit, not counted)
  check('ammo ledger enforced (plasma capped at 28)', noAmmo >= 1);
  send(a, { type: 'fire', weapon: 'deathray', yaw: 0 });
  const bad = await waitFor(a, (m) => m.type === 'error' && m.reason === 'bad-weapon');
  check('unknown weapon rejected', !!bad);

  console.log('\nSERVER REVIVE LADDER');
  console.log('='.repeat(64));
  // quick room with 2 clients so A can wreck B via validated hits
  const c = await connect();
  send(c, { type: 'hello', name: 'SimC', accountId: 'sim-c' });
  await waitFor(c, (m) => m.type === 'account');
  send(c, { type: 'join', mode: 'quick' });
  const cJoined = await waitFor(c, (m) => m.type === 'joined');
  const cId = (await waitFor(c, (m) => m.type === 'welcome') || {}).clientId;
  const d = await connect();
  send(d, { type: 'hello', name: 'SimD', accountId: 'sim-d' });
  const dAcc = await waitFor(d, (m) => m.type === 'account');
  send(d, { type: 'join', mode: 'quick' });
  const dJoined = await waitFor(d, (m) => m.type === 'joined');
  check('quick room shared', !!dJoined && dJoined.roomCode && !dJoined.practice);
  // learn real client ids from the roster (never hit self)
  await sleep(400);
  const ros = c.inbox.filter((m) => m.type === 'roster').pop();
  const victimId = ros && ros.roster.map((r) => r.id).find((x) => x && x !== cId);
  check('roster exposes rival id', !!victimId);
  const wreckVictim = async () => {
    for (let i = 0; i < 6; i++) {
      send(c, { type: 'hit', targetId: victimId, dmg: 60, weapon: 'mg' });
      const ev = await waitFor(c, (m) => m.type === 'event:hit' && m.killed, 500);
      if (ev) return true;
      await sleep(120);
    }
    return false;
  };
  check('server hit registration wrecks (hp owned by server)', await wreckVictim());
  // D revives twice (1 + 5 gems; fresh account has 14)
  send(d, { type: 'revive' });
  const r1 = await waitFor(d, (m) => m.type === 'revive-ok');
  check('revive #1 costs 1 gem (server)', !!r1 && r1.ok && r1.cost === 1);
  await wreckVictim();
  await sleep(300);
  send(d, { type: 'revive' });
  const r2 = await waitFor(d, (m) => m.type === 'revive-ok' && m.cost === 5, 3000);
  check('revive #2 costs 5 gems (server)', !!r2 && r2.ok);
  void dAcc; void cJoined;

  console.log('\nBANNERS + ADMIN');
  console.log('='.repeat(64));
  send(a, { type: 'banner', action: 'view', id: 'brand_nitro' });
  send(a, { type: 'banner', action: 'like', id: 'p_ava' });
  await sleep(400);
  const sum = await get('/api/banners/summary');
  check('banner view recorded (24h)', sum.stats.brand_nitro.views >= 1);
  check('banner like recorded (24h)', sum.stats.p_ava.likes >= 1);
  const h = await get('/api/health');
  check('health endpoint', h.ok && h.phase === 12);

  for (const x of [a, b, c, d]) try { x.ws.close(); } catch {}
} finally {
  srv.kill();
  try { if (hadDb) copyFileSync(BAKP, DBP); } catch {}
  try { unlinkSync(BAKP); } catch {}
}

console.log('='.repeat(64));
console.log(fail === 0 ? 'ALL LAUNCH CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
