// sim_phase13.mjs — Phase 13 online-only rework audit. Boots the real server on
// :8143 with real ws clients: identity tags, quick-match wait + bot backfill,
// private rooms + host early-start, server-minted tokens. Restores db.json.
// Usage: node sim/sim_phase13.mjs
import { spawn } from 'child_process';
import { copyFileSync, unlinkSync } from 'fs';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';

const PORT = 8143;
const DBP = new URL('../server/db.json', import.meta.url);
const BAKP = new URL('../server/db.json.sim13-bak', import.meta.url);
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
async function waitFor(c, pred, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = c.inbox.findIndex(pred);
    if (i >= 0) return c.inbox.splice(i, 1)[0];
    await sleep(100);
  }
  return null;
}

const srv = spawn('node', ['server.js', String(PORT)], { cwd: new URL('../server/', import.meta.url).pathname });
srv.on('error', (e) => console.log('server spawn failed:', e.message));
// wait until the admin port answers (slow CI/host-safe)
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/health`);
    if (r.ok) break;
  } catch {}
  await sleep(250);
}
await sleep(1500);
try {
  console.log('IDENTITY TAGS');
  console.log('='.repeat(64));
  const a = await connect();
  send(a, { type: 'hello', accountId: 'tag-a' });
  const accA = await waitFor(a, (m) => m.type === 'account');
  check('account carries RK tag', !!accA && /^RK-[A-Z0-9]{4}$/.test(accA.tag || ''));
  const a2 = await connect();
  send(a2, { type: 'hello', accountId: 'tag-a' });
  const accA2 = await waitFor(a2, (m) => m.type === 'account');
  check('same account, same tag (stable identity)', !!accA2 && accA2.tag === accA.tag);
  const b = await connect();
  send(b, { type: 'hello', accountId: 'tag-b' });
  const accB = await waitFor(b, (m) => m.type === 'account');
  check('different account, different tag', !!accB && accB.tag !== accA.tag);
  try { a2.ws.close(); } catch {}

  console.log('\nQUICK MATCH: WAIT + BOT BACKFILL');
  console.log('='.repeat(64));
  send(a, { type: 'join', mode: 'quick' });
  const ja = await waitFor(a, (m) => m.type === 'joined');
  check('quick join ok', !!ja && !!ja.roomCode);
  const early = await waitFor(a, (m) => m.type === 'start', 3000);
  check('no instant start (gathering wait)', !early);
  send(b, { type: 'join', mode: 'quick' });
  const jb = await waitFor(b, (m) => m.type === 'joined');
  check('second human shares the waiting room', !!jb && jb.roomCode === ja.roomCode);
  const ros = await waitFor(a, (m) => m.type === 'roster' && m.roster.length === 2, 4000);
  check('roster shows tags, never usernames', !!ros && ros.roster.every((r) => r.tag && !r.name));
  const startA = await waitFor(a, (m) => m.type === 'start', 20000);
  const startB = await waitFor(b, (m) => m.type === 'start', 3000);
  check('START after ~15 s wait', !!startA && !!startB);
  check('bots backfill to 6 (2 humans + 4 bots)', !!startA && startA.bots === 4 && startA.humans.length === 2);

  console.log('\nPRIVATE ROOMS + HOST START');
  console.log('='.repeat(64));
  const h = await connect();
  send(h, { type: 'hello', accountId: 'tag-h' });
  await waitFor(h, (m) => m.type === 'account');
  send(h, { type: 'join', mode: 'host' });
  const jh = await waitFor(h, (m) => m.type === 'joined');
  check('host creates room (host flag + code)', !!jh && jh.host === true && !!jh.roomCode && jh.private === true);
  const g = await connect();
  send(g, { type: 'hello', accountId: 'tag-g' });
  await waitFor(g, (m) => m.type === 'account');
  send(g, { type: 'join', mode: 'code', code: jh.roomCode });
  const jg = await waitFor(g, (m) => m.type === 'joined');
  check('guest joins by code (invite link flow)', !!jg && jg.roomCode === jh.roomCode && !jg.host);
  const noStart = await waitFor(g, (m) => m.type === 'start', 2500);
  check('no auto-start while waiting (host decides)', !noStart);
  send(h, { type: 'start-req', bots: false });
  const sH = await waitFor(h, (m) => m.type === 'start', 3000);
  const sG = await waitFor(g, (m) => m.type === 'start', 3000);
  check('host early-start works', !!sH && !!sG);
  check('host opted out of bots', !!sH && sH.bots === 0 && sH.humans.length === 2);

  console.log('\nSERVER-MINTED TOKENS');
  console.log('='.repeat(64));
  send(a, { type: 'token', value: 12 });
  const aw = await waitFor(a, (m) => m.type === 'award' && m.reason === 'token');
  check('token claim pays via AWARD', !!aw && aw.coins === 12);
  send(a, { type: 'token', value: 999 });
  const aw2 = await waitFor(a, (m) => m.type === 'award' && m.reason === 'token');
  check('token capped at 48', !!aw2 && aw2.coins === 48);

  for (const x of [a, b, h, g]) try { x.ws.close(); } catch {}
} finally {
  srv.kill();
  try { if (hadDb) copyFileSync(BAKP, DBP); } catch {}
  try { unlinkSync(BAKP); } catch {}
}

console.log('='.repeat(64));
console.log(fail === 0 ? 'ALL MATCHMAKING CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
