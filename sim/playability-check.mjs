#!/usr/bin/env node
// playability-check.mjs — proves the four defects the player actually hit are
// gone, against a REAL local game server rather than a mock.
//
//   1. PLAY did nothing at all (#playBtn had no listener anywhere).
//   2. Revive never worked: the server answered reason:'alive' because bot and
//      environment damage are local-only, so it never learned the player was
//      wrecked — and the car stayed frozen forever.
//   3. There was no way back to the main menu once a race had started.
//   4. The garage overflowed the phone and looked unfinished.
//
// The server is started on a spare port and the client pointed at it through
// rk.server.url, so the revive path is exercised end-to-end (HELLO/account,
// INPUT carrying the wrecked flag, server REVIVE verdict).

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const PORT = 8137;
const URL = 'http://127.0.0.1:5199/';
const WS = `ws://127.0.0.1:${PORT}`;
const CHROME = '/data/data/com.termux/files/usr/bin/chromium-browser';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} ${detail}`);
};

// ---------- 1. local server ----------
const server = spawn(process.execPath, ['server/server.js', String(PORT)], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

for (let i = 0; i < 60 && !serverLog.includes('server on'); i++) await sleep(250);
if (!serverLog.includes('server on')) {
  console.log('server failed to start:\n' + serverLog);
  server.kill();
  process.exit(1);
}
console.log('local server up on :' + PORT + '\n');

let browser;
let failed = false;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--no-zygote', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });

  // point the client at the local server BEFORE the app boots
  await page.evaluateOnNewDocument((ws) => {
    try { localStorage.setItem('rk.server.url', ws); } catch {}
  }, WS);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
    { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait timed out'));
  await sleep(800);

  // ---------- 2. PLAY button ----------
  const playBefore = await page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    conn: document.getElementById('connOverlay').classList.contains('show'),
    online: document.getElementById('onlineOverlay').classList.contains('show'),
  }));
  await page.click('#playBtn');
  await sleep(6000);
  const playAfter = await page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    conn: document.getElementById('connOverlay').classList.contains('show'),
    online: document.getElementById('onlineOverlay').classList.contains('show'),
  }));
  const playWorked = !playBefore.racing && playBefore.online === false &&
    (playAfter.racing || playAfter.conn || playAfter.online);
  record('PLAY button starts a race', playWorked,
    `before=${JSON.stringify(playBefore)} after=${JSON.stringify(playAfter)}`);
  if (!playWorked) failed = true;

  // ---------- 3. revive ----------
  // Reload for a clean session: PLAY left us parked in the quick-match lobby,
  // and connecting again from there is a different path from a cold start.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
    { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait timed out'));
  await sleep(800);

  await page.click('#practiceBtn');
  await page.waitForFunction(() => document.body.classList.contains('racing'),
    { timeout: 25000, polling: 250 }).catch(() => {});
  await sleep(2500);

  const preRevive = await page.evaluate(() => ({
    online: window.__rkDebug.isOnlineMode(),
    racing: document.body.classList.contains('racing'),
  }));
  console.log(`      (practice race: ${JSON.stringify(preRevive)})`);

  const wrecked = await page.evaluate(() => {
    if (!window.__rkDebug || !window.__rkDebug.wreckPlayer) return 'no debug hook';
    window.__rkDebug.wreckPlayer();
    return document.getElementById('reviveOverlay').classList.contains('show');
  });
  record('wreck shows the revive overlay', wrecked === true, String(wrecked));

  const gemsBefore = await page.evaluate(() => (window.__rkDebug.playerState() || {}).gems);
  await page.click('#reviveBtn');

  // poll rather than sleep: the server round-trip time is not fixed
  let afterRevive = null;
  for (let i = 0; i < 24; i++) {
    await sleep(500);
    afterRevive = await page.evaluate(() => ({
      state: window.__rkDebug.playerState(),
      path: window.__rkRevivePath || 'none',
      overlay: document.getElementById('reviveOverlay').classList.contains('show'),
      // whatever the game last told the player, if it refused
      toast: (document.getElementById('coinsPop') || {}).textContent || '',
    }));
    if (!afterRevive.state || afterRevive.state.wrecked === false) break;
  }
  const revived = afterRevive.state && afterRevive.state.wrecked === false;
  record('REVIVE puts you back in the race', revived,
    `path=${afterRevive.path} wrecked=${afterRevive.state && afterRevive.state.wrecked} ` +
    `gems ${gemsBefore} -> ${afterRevive.state && afterRevive.state.gems} ` +
    `overlayStillUp=${afterRevive.overlay} toast="${(afterRevive.toast || '').slice(0, 40)}"`);
  if (!revived) failed = true;

  // ---------- 4. back to main menu ----------
  const menu = await page.evaluate(async () => {
    const racingBefore = document.body.classList.contains('racing');
    const btn = document.getElementById('quitMenuBtn');
    if (!btn) return { racingBefore, err: 'quitMenuBtn missing' };
    const r = document.getElementById('resumeBtn'); // ensure not paused-blocked
    btn.click();
    await new Promise((res) => setTimeout(res, 700));
    const ss = document.getElementById('startScreen');
    return {
      racingBefore,
      racingAfter: document.body.classList.contains('racing'),
      startVisible: !!ss && getComputedStyle(ss).display !== 'none',
      hudHidden: getComputedStyle(document.getElementById('hud')).display === 'none',
    };
  });
  const menuOk = menu.racingBefore === true && menu.racingAfter === false &&
    menu.startVisible === true && menu.hudHidden === true;
  record('MAIN MENU returns to start', menuOk, JSON.stringify(menu));
  if (!menuOk) failed = true;

  // ---------- 5. garage fits the phone ----------
  async function garageFit(w, h) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(700);
    return page.evaluate(() => {
      const g = document.getElementById('garageBtn') || document.getElementById('garageBtn2');
      if (g) g.click();
      const ov = document.getElementById('garageOverlay');
      const card = ov.querySelector('.card');
      const close = document.getElementById('garageClose');
      const tabs = document.getElementById('garageGrid') && document.getElementById('garageGrid').firstElementChild;
      const cr = card.getBoundingClientRect();
      const kr = close ? close.getBoundingClientRect() : null;
      return {
        shown: ov.classList.contains('show'),
        vw: innerWidth, vh: innerHeight,
        card: { top: Math.round(cr.top), left: Math.round(cr.left),
                right: Math.round(cr.right), bottom: Math.round(cr.bottom),
                w: Math.round(cr.width), h: Math.round(cr.height) },
        fits: cr.left >= -1 && cr.right <= innerWidth + 1 && cr.top >= -1 && cr.bottom <= innerHeight + 1,
        closeReachable: !!kr && kr.top >= 0 && kr.bottom <= innerHeight && kr.left >= 0,
        tabsSticky: !!tabs && getComputedStyle(tabs).position === 'sticky',
        listScrolls: (() => {
          const gr = document.getElementById('garageGrid');
          return !!gr && getComputedStyle(gr).overflowY === 'auto' && gr.scrollHeight > 0;
        })(),
        docOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
  }
  for (const [w, h] of [[844, 390], [800, 360]]) {
    const r = await garageFit(w, h);
    const ok = r.shown && r.fits && r.closeReachable && !r.docOverflowX && r.tabsSticky && r.listScrolls;
    record(`garage fits ${w}x${h}`, ok, JSON.stringify(r));
    if (!ok) failed = true;
  }

  const appErrors = errors.filter((e) => !/WebGL|THREE|Shader/i.test(e));
  record('no app console errors', appErrors.length === 0, appErrors.length ? appErrors.slice(0, 3).join(' | ') : 'none');
  if (appErrors.length) failed = true;

  console.log('\n' + (failed ? 'PLAYABILITY CHECK: FAILURES' : 'PLAYABILITY CHECK: ALL PASS'));
} catch (e) {
  console.log('ERROR: ' + (e && e.message));
  failed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
process.exit(failed ? 1 : 0);
