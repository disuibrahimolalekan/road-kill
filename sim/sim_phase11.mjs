// sim_phase11.mjs — Phase 11 banner audit. Headless, plain node.
// Tests recordBanner rate/shape rules, 24h pruning, summary, unknown ids.
// Backs up server/db.json first and restores it after (record fns persist).
// Usage: node sim/sim_phase11.mjs
import { readFileSync, writeFileSync, copyFileSync } from 'fs';

const DBPATH = new URL('../server/db.json', import.meta.url);
const BAKPATH = new URL('../server/db.json.sim-bak', import.meta.url);
try { copyFileSync(DBPATH, BAKPATH); } catch {}

const db = await import('../server/db.js');
let fail = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fail++;
};

try {
  const mem = { accounts: {}, matches: [], seq: 1 };
  console.log('BANNER EVENTS');
  console.log('='.repeat(64));
  db.getOrCreateAccount(mem, 'u1', 'U', 'd');
  const ids = db.bannerIds();
  check('15 banners in config (6 brands + 9 people)', ids.length === 15);
  let r = db.recordBanner(mem, 'u1', 'view', 'brand_nitro');
  check('view accepted', r.ok);
  r = db.recordBanner(mem, 'u1', 'bump', 'p_ava');
  check('bump accepted', r.ok);
  r = db.recordBanner(mem, 'u1', 'like', 'p_ava');
  check('like accepted', r.ok);
  r = db.recordBanner(mem, 'u1', 'like', 'p_ava');
  check('same-day like rejected', !r.ok && r.reason === 'liked');
  r = db.recordBanner(mem, 'u2', 'like', 'p_ava');
  check('other account can like', r.ok);
  r = db.recordBanner(mem, 'u1', 'view', 'ghost');
  check('unknown id rejected', !r.ok && r.reason === 'no-item');
  r = db.recordBanner(mem, 'u1', 'hug', 'p_ava');
  check('unknown action rejected', !r.ok);

  console.log('\n24H PRUNING');
  console.log('='.repeat(64));
  const old = Date.now() - 25 * 3600 * 1000;
  mem.banners.brand_nitro.views.push(old, old);
  mem.banners.p_ava.likes.push(old);
  const sum = db.bannerSummary(mem);
  check('old views pruned from summary', sum.brand_nitro.views === 1);
  check('old likes pruned from summary', sum.p_ava.likes === 2); // u1 + u2 today
  check('summary covers all ids', Object.keys(sum).length === 15);
  const sum1 = db.bannerSummary(mem, 1);
  check('windowH=1 respected', sum1.brand_nitro.windowH === 1);

  console.log('\nCONFIG SHAPE');
  console.log('='.repeat(64));
  const cfg = JSON.parse(readFileSync(new URL('../banners-config.json', import.meta.url), 'utf8'));
  const tracks = {};
  for (const b of [...cfg.brands, ...cfg.people]) {
    tracks[b.track] = tracks[b.track] || { brands: 0, people: 0 };
    if (cfg.brands.includes(b)) tracks[b.track].brands++;
    else tracks[b.track].people++;
    if (!(b.t >= 0 && b.t < 1)) throw new Error('bad t for ' + b.id);
  }
  for (const [t, c] of Object.entries(tracks)) {
    console.log(`  ${t}: ${c.brands} brands, ${c.people} people`);
    check(`${t} has 2 brands + 3 people`, c.brands === 2 && c.people === 3);
  }
} finally {
  try { copyFileSync(BAKPATH, DBPATH); } catch {}
  try { (await import('fs')).unlinkSync(BAKPATH); } catch {}
}

console.log('='.repeat(64));
console.log(fail === 0 ? 'ALL BANNER CHECKS PASS' : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
