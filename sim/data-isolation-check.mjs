#!/usr/bin/env node
// data-isolation-check.mjs — proves one device can hold several players
// without their data bridging, and that a pre-existing save is carried over
// exactly once.
//
// Runs against the REAL src/identity.js + src/storage.js in a browser context
// (Vite serves them, so no bundling step), but without booting the game — this
// is about persistence, not rendering. Accounts are switched the same way a
// future sign-up page would call setAccountId(uid).

import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const results = [];
const record = (n, ok, d) => { results.push({ n, ok, d }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(40)} ${d}`); };

const ORIGIN = process.env.RK_ORIGIN || 'http://127.0.0.1:5199';
const BROWSER = process.env.RK_CHROMIUM || '/data/data/com.termux/files/usr/bin/chromium-browser';

const browser = await puppeteer.launch({
  executablePath: BROWSER, headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--no-zygote', '--disable-webgl'],
});
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 844, height: 390 });

  // Same origin as the app, but a JSON file so the game itself never boots.
  await page.goto(`${ORIGIN}/shop-config.json`, { waitUntil: 'domcontentloaded' });

  await page.evaluate(async () => {
    // Import ONLY storage.js: it re-exports the account API from the very
    // instance of identity.js it keys by. Importing './src/identity.js'
    // separately would load a second copy (Vite stamps internal imports with
    // ?t=<mtime>), and switching through that copy would move the key builder
    // without moving storage's — exactly the split this test is checking for.
    window.st = await import('/src/storage.js');
    window.eco = await import('/src/economy.js');
  });

  // ---------- 1. an existing single-slot save is carried over once ----------
  const legacy = await page.evaluate(async () => {
    const out = {};
    // Seed the pre-isolation save and clear any prior claim.
    localStorage.setItem('rk.profile.v2', JSON.stringify(
      { ...window.eco.createDefaultProfile(), coins: 777, xp: 50, gems: 9 }));
    localStorage.removeItem('rk.legacy-claimed.v1');
    localStorage.removeItem('rk.identity.v1');

    const first = await window.st.loadProfileUnified();
    out.firstCoins = first.coins;
    out.claimed = !!localStorage.getItem('rk.legacy-claimed.v1');
    out.idA = window.st.accountId();
    out.keyA = window.st.lsKey('profile.v2');

    // Poison the legacy record, then migrate again: the claim marker must
    // prevent a second copy, so this must NOT resurface 999 anywhere.
    localStorage.setItem('rk.profile.v2', JSON.stringify(
      { ...window.eco.createDefaultProfile(), coins: 999 }));
    const again = await window.st.loadProfileUnified();
    out.secondCoins = again.coins;
    out.stillClaimed = !!localStorage.getItem('rk.legacy-claimed.v1');
    return out;
  });
  record('legacy save migrated into the namespace',
    legacy.firstCoins === 777 && legacy.claimed === true,
    `coins=${legacy.firstCoins} claimMarker=${legacy.claimed}`);
  record('migration happens exactly once', legacy.secondCoins === 777,
    `re-running migrate kept coins=${legacy.secondCoins} (poisoned 999 did not apply)`);

  // ---------- 2. account A writes its own progress ----------
  const aWrite = await page.evaluate(async () => {
    const p = await window.st.loadProfileUnified();
    p.coins = 4242;
    await window.st.saveProfileUnified(p, { immediate: true, noSync: true });
    const storedLs = JSON.parse(localStorage.getItem(window.st.lsKey('profile.v2')) || '{}');
    return { idA: window.st.accountId(), keyA: window.st.lsKey('profile.v2'),
             lsCoins: storedLs.coins, idbKey: window.st.profileKey() };
  });
  record('account A stores under its own key', aWrite.lsCoins === 4242
    && aWrite.keyA === `rk.${aWrite.idA}.profile.v2` && aWrite.idbKey === `${aWrite.idA}:profile`,
    `LS=${aWrite.keyA} (${aWrite.lsCoins}) IDB=${aWrite.idbKey}`);

  // ---------- 3. switching namespace must NOT hand over A's data ----------
  const bRead = await page.evaluate(async () => {
    const idA = window.st.accountId();
    const next = window.st.setAccountId('e2e-acct-b');   // what a sign-up would do
    const p = await window.st.loadProfileUnified();
    return {
      idA, idB: next.accountId, coins: p.coins,
      keyB: window.st.lsKey('profile.v2'),
      keyAStill: `rk.${idA}.profile.v2`,
      mirrored: localStorage.getItem('rk.account.v1'),   // backend id must follow
    };
  });
  record('account B sees defaults, not A\'s progress',
    bRead.idB !== bRead.idA && bRead.coins === 80,
    `id ${bRead.idA} -> ${bRead.idB}, B coins=${bRead.coins} (A had 4242)`);
  record('B writes to a different key', bRead.keyB !== bRead.keyAStill,
    `${bRead.keyAStill} vs ${bRead.keyB}`);
  record('sign-up id is mirrored to backend sync key', bRead.mirrored === 'e2e-acct-b',
    `rk.account.v1=${bRead.mirrored}`);

  // ---------- 4. B writes, then A must be untouched ----------
  const noBridge = await page.evaluate(async () => {
    const pB = await window.st.loadProfileUnified();
    pB.coins = 555; pB.stats.wins = 7;
    await window.st.saveProfileUnified(pB, { immediate: true, noSync: true });
    return { bCoins: pB.coins };
  });

  const backToA = await page.evaluate(async (idA) => {
    window.st.setAccountId(idA);
    const pA = await window.st.loadProfileUnified();
    const mA = await window.st.getMatches(50);
    return { coins: pA.coins, wins: (pA.stats && pA.stats.wins) || 0, matches: mA.length };
  }, aWrite.idA);
  record('B\'s 555 coins did not bridge into A', backToA.coins === 4242 && backToA.wins === 0,
    `A coins=${backToA.coins} (expected 4242), A wins=${backToA.wins} (B set 7)`);

  // ---------- 4b. a save still inside its debounce window must not follow a switch ----------
  // The sign-up scenario: save, then setAccountId() on the same tick. Before
  // the namespace was captured at schedule time, profileKey() was resolved
  // when the timer FIRED — i.e. after the switch — so the guest's profile was
  // filed under the new account's id and overwrote it. That is a direct
  // account-to-account bridge, so it gets its own test.
  const deferred = await page.evaluate(async (idA) => {
    window.st.setAccountId(idA);                        // back on A
    const pA = await window.st.loadProfileUnified();
    pA.coins = 4242;
    window.st.saveProfileUnified(pA, { noSync: true }); // DEBOUNCED, 250ms
    window.st.setAccountId('e2e-acct-b');               // switch inside the window
    await new Promise((r) => setTimeout(r, 600));       // let that timer fire
    const pB = await window.st.loadProfileUnified();
    window.st.setAccountId(idA);
    const pBack = await window.st.loadProfileUnified();
    return { aCoins: pBack.coins, bCoins: pB.coins };
  }, aWrite.idA);
  record('pending save cannot land in the next account',
    deferred.aCoins === 4242 && deferred.bCoins === 555,
    `A's delayed save still filed as A (${deferred.aCoins}); B kept its own ${deferred.bCoins}`);

  // ---------- 5. match history is scoped to the account ----------
  const matches = await page.evaluate(async (idA) => {
    const before = await window.st.getMatches(50);
    await window.st.recordMatch({ rank: 1, laps: 3, kills: 2, coinsBonus: 100, xpGain: 50,
                                   coinsCollected: 30, durationSec: 90 });   // recorded as A
    const asA = await window.st.getMatches(50);

    window.st.setAccountId('e2e-acct-b');
    const asB = await window.st.getMatches(50);
    const statsB = await window.st.getMatchStats();

    window.st.setAccountId(idA);
    const backA = await window.st.getMatches(50);
    return { before: before.length, asA: asA.length, asB: asB.length,
             statsBRaces: statsB.races, backA: backA.length,
             stamped: !!(asA[0] && asA[0].accountId) };
  }, aWrite.idA);
  record('A\'s race is recorded and stamped', matches.asA > matches.before && matches.stamped,
    `${matches.before} -> ${matches.asA} matches, stamped=${matches.stamped}`);
  record('B cannot read A\'s match history', matches.asB === 0 && matches.statsBRaces === 0,
    `B sees ${matches.asB} matches / stats.races=${matches.statsBRaces}`);
  record('history returns intact when A resumes', matches.backA === matches.asA,
    `A sees ${matches.backA} matches again`);

  // ---------- 6. the sync queue survives the key rename ----------
  const queue = await page.evaluate(async () => {
    const ok = await window.st.enqueueSyncOp('profile.save', { coins: 1, source: 'isolation-check' })
      .then(() => true).catch((e) => 'threw: ' + e.message);
    const read = window.st.readLSQueue();
    return { ok, len: read.length, key: window.st.syncQueueKey(),
             types: read.map((o) => o.type) };
  });
  record('sync queue writes and reads (no missing key)',
    queue.ok === true && Array.isArray(queue.types),
    `key=${queue.key} queued=${queue.len} types=${queue.types.join(',')}`);

  // ---------- 7. sign-out leaves no readable trace of the signed-in id ----------
  const out = await page.evaluate(async (idA) => {
    const g = window.st.signOut();
    const p = await window.st.loadProfileUnified();
    return { newId: g.accountId, isGuest: window.st.isGuest(), coins: p.coins,
             changed: g.accountId !== idA, backendKey: localStorage.getItem('rk.account.v1') };
  }, aWrite.idA);
  record('sign-out mints a fresh guest slot', out.isGuest === true && out.changed
    && out.coins === 80 && out.backendKey === out.newId,
    `new=${out.newId} guest=${out.isGuest} coins=${out.coins} backend=${out.backendKey}`);

  // ---------- 8. no page errors ----------
  const appErrors = errors.filter((e) => !/WebGL|THREE|Shader|VALIDATE|Program Info/i.test(e));
  record('no page errors during isolation tests', appErrors.length === 0,
    appErrors.length ? appErrors.slice(0, 3).join(' | ') : 'none');

  if (results.some((r) => !r.ok)) failed = true;
  console.log('\n' + (failed ? 'DATA ISOLATION CHECK: FAILURES' : 'DATA ISOLATION CHECK: ALL PASS'));
} catch (e) {
  console.log('ERROR: ' + (e && e.message));
  failed = true;
} finally { await browser.close().catch(() => {}); }
process.exit(failed ? 1 : 0);
