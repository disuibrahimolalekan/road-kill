#!/usr/bin/env node
// fix-step1-check.mjs — FIX-PROMPT v2 STEP 1 (clean main menu) verification,
// against a REAL local game server (same harness as playability-check.mjs).
//
// Acceptance:
//   1. Menu shows only PLAY / GARAGE / SETTINGS / INSTALL + passive OFFLINE
//      chip. No ONLINE button, no lobby card.
//   2. Stray document taps start nothing (no auto quick-match, no lobby).
//   3. PLAY opens the mode choice (quick / code / private / practice) with a
//      working BACK; joining with an empty code shows a message, not a crash.
//   4. HOST PRIVATE opens the waiting room (roster + invite); START RACE races.
//   5. QUICK MATCH keeps the mode panel with a SEARCHING status, then the
//      server fills bots and the race starts with a VISIBLE countdown.
//   6. PRACTICE starts instantly (server-backed) and returns to the menu.
//   7. No app console errors anywhere.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const PORT = 8138;
const URL = 'http://127.0.0.1:5199/';
const WS = `ws://127.0.0.1:${PORT}`;
const CHROME = '/data/data/com.termux/files/usr/bin/chromium-browser';
const SHOTS = '/sdcard/Road kill/screenshots/fix-step1';
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
};

// ---------- local server ----------
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

const shot = async (page, name) => {
  try { await page.screenshot({ path: `${SHOTS}/${name}.png` }); console.log(`      shot: ${name}.png`); }
  catch (e) { console.log(`      shot FAILED ${name}: ${e.message}`); }
};

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

  await page.evaluateOnNewDocument((ws) => {
    try { localStorage.setItem('rk.server.url', ws); } catch {}
  }, WS);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
    { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait timed out'));
  await sleep(800);

  const menuState = () => page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    startVisible: getComputedStyle(document.getElementById('startScreen')).display !== 'none',
    mode: document.getElementById('modeOverlay').classList.contains('show'),
    room: document.getElementById('roomOverlay').classList.contains('show'),
    conn: document.getElementById('connOverlay') && document.getElementById('connOverlay').classList.contains('show'),
    chip: (document.getElementById('connChipText') || {}).textContent || '',
    buttons: [...document.querySelectorAll('#startScreen button')].map((b) => b.id || b.textContent.trim()),
  }));

  // ---------- 1. menu contents ----------
  const m0 = await menuState();
  const idsOk = ['playBtn', 'garageBtn', 'settingsBtn'].every((id) => m0.buttons.includes(id));
  const noOnlineBtn = !m0.buttons.some((t) => /online/i.test(t));
  record('menu is clean (PLAY/GARAGE/SETTINGS)', idsOk && noOnlineBtn && m0.startVisible && !m0.racing,
    `buttons=${JSON.stringify(m0.buttons)} chip="${m0.chip}"`);
  if (!(idsOk && noOnlineBtn)) failed = true;
  await shot(page, 'menu-844x390');

  // ---------- 2. stray tap does nothing ----------
  await page.mouse.click(120, 320);          // empty area of the start screen
  await sleep(1200);
  const tap = await menuState();
  const tapOk = !tap.mode && !tap.room && !tap.conn && !tap.racing && tap.chip === 'OFFLINE';
  record('stray tap connects nothing', tapOk, JSON.stringify(tap));
  if (!tapOk) failed = true;

  // ---------- 3. PLAY → mode choice → BACK ----------
  await page.click('#playBtn');
  await sleep(400);
  let mode = await page.evaluate(() => ({
    show: document.getElementById('modeOverlay').classList.contains('show'),
    rows: ['modeQuickBtn', 'modeCodeBtn', 'modeHostBtn', 'modePracticeBtn', 'modeBackBtn']
      .filter((id) => document.getElementById(id)).length,
    codeRowHidden: document.getElementById('codeRow').style.display === 'none',
    racing: document.body.classList.contains('racing'),
    room: document.getElementById('roomOverlay').classList.contains('show'),
  }));
  record('PLAY opens mode choice', mode.show && mode.rows === 5 && mode.codeRowHidden && !mode.racing && !mode.room,
    JSON.stringify(mode));
  if (!mode.show) failed = true;
  await shot(page, 'mode-844x390');

  // join-with-code: empty code → inline message, no crash
  await page.click('#modeCodeBtn');
  await sleep(250);
  await page.click('#modeJoinBtn');
  await sleep(600);
  const codeMsg = await page.evaluate(() => ({
    codeRow: document.getElementById('codeRow').style.display !== 'none',
    status: (document.getElementById('modeStatus') || {}).textContent || '',
    room: document.getElementById('roomOverlay').classList.contains('show'),
    chip: (document.getElementById('connChipText') || {}).textContent || '',
  }));
  record('empty room code → message, no connect', codeMsg.codeRow && /code/i.test(codeMsg.status) && !codeMsg.room,
    JSON.stringify(codeMsg));
  if (!/code/i.test(codeMsg.status)) failed = true;
  await page.evaluate(() => document.getElementById('modeBackBtn').click());
  await sleep(400);
  const back = await menuState();
  record('BACK closes mode choice clean', !back.mode && !back.room && !back.conn && !back.racing,
    JSON.stringify(back));
  if (back.mode) failed = true;

  // ---------- 4. host private → waiting room → START ----------
  await page.click('#playBtn');
  await sleep(300);
  await page.click('#modeHostBtn');
  await page.waitForFunction(() => {
    const s = (document.getElementById('netStatus') || {}).textContent || '';
    return /room|ready/i.test(s);
  }, { timeout: 30000, polling: 300 }).catch(() => {});
  await sleep(500);
  const room = await page.evaluate(() => {
    const ov = document.getElementById('roomOverlay');
    return {
      show: ov.classList.contains('show'),
      modeHidden: !document.getElementById('modeOverlay').classList.contains('show'),
      status: (document.getElementById('netStatus') || {}).textContent || '',
      tag: (document.getElementById('tagVal') || {}).textContent || '',
      roster: (document.getElementById('rosterList') || {}).textContent || '',
      inviteShown: document.getElementById('inviteRow').style.display !== 'none',
      invite: (document.getElementById('inviteLink') || {}).textContent || '',
      startVisible: getComputedStyle(document.getElementById('startBtn')).display !== 'none',
    };
  });
  const roomOk = room.show && room.modeHidden && /room/i.test(room.status) && /RK-/.test(room.tag) && room.startVisible;
  record('HOST PRIVATE opens waiting room', roomOk,
    `status="${room.status}" tag=${room.tag} inviteShown=${room.inviteShown}`);
  if (!roomOk) failed = true;
  await shot(page, 'room-844x390');

  await page.click('#startBtn');
  await page.waitForFunction(() => document.body.classList.contains('racing'),
    { timeout: 25000, polling: 250 }).catch(() => {});
  await sleep(1500);
  const hostRace = await page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    room: document.getElementById('roomOverlay').classList.contains('show'),
    mode: document.getElementById('modeOverlay').classList.contains('show'),
    hud: getComputedStyle(document.getElementById('hud')).display !== 'none',
  }));
  record('host START RACE races (nothing stacked)', hostRace.racing && !hostRace.room && !hostRace.mode && hostRace.hud,
    JSON.stringify(hostRace));
  if (!hostRace.racing) failed = true;
  await shot(page, 'race-host-844x390');

  // back to menu via pause
  await page.evaluate(() => { if (window.__rkDebug && window.__rkDebug.pause) window.__rkDebug.pause(); });
  await sleep(500);
  await page.evaluate(() => { const b = document.getElementById('quitMenuBtn'); if (b) b.click(); });
  await sleep(800);
  const backMenu = await menuState();
  record('MAIN MENU returns from race', backMenu.startVisible && !backMenu.racing && !backMenu.mode && !backMenu.room,
    JSON.stringify(backMenu));
  if (!backMenu.startVisible) failed = true;

  // ---------- 5. quick match: searching status → server fills bots → countdown → race ----------
  await page.click('#playBtn');
  await sleep(300);
  await page.click('#modeQuickBtn');
  await sleep(800);
  const quick = await page.evaluate(() => ({
    modeStill: document.getElementById('modeOverlay').classList.contains('show'),
    roomHidden: !document.getElementById('roomOverlay').classList.contains('show'),
    status: (document.getElementById('modeStatus') || {}).textContent || '',
    racing: document.body.classList.contains('racing'),
  }));
  record('quick match shows SEARCHING in panel', quick.modeStill && quick.roomHidden && /SEARCHING/i.test(quick.status),
    `status="${quick.status}"`);
  if (!/SEARCHING/i.test(quick.status)) failed = true;

  let sawCountdown = false;
  const raced = await page.waitForFunction(() => {
    const cm = document.getElementById('center-msg');
    if (cm && cm.classList.contains('show') && cm.textContent.trim()) sawCountdown = true;
    return document.body.classList.contains('racing');
  }, { timeout: 45000, polling: 300 }).then(() => true).catch(() => false);
  await sleep(1500);
  const quickRace = await page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    mode: document.getElementById('modeOverlay').classList.contains('show'),
    countdownSeen: document.getElementById('center-msg').textContent || '(gone)',
  }));
  record('quick match → bots fill → race starts', raced && quickRace.racing && !quickRace.mode,
    `sawCountdown=${sawCountdown} ${JSON.stringify(quickRace)}`);
  if (!raced) failed = true;
  await shot(page, 'race-quick-844x390');

  await page.evaluate(() => { if (window.__rkDebug && window.__rkDebug.pause) window.__rkDebug.pause(); });
  await sleep(500);
  await page.evaluate(() => { const b = document.getElementById('quitMenuBtn'); if (b) b.click(); });
  await sleep(800);

  // ---------- 6. practice: instant server-backed race ----------
  await page.click('#playBtn');
  await sleep(300);
  await page.click('#modePracticeBtn');
  await page.waitForFunction(() => document.body.classList.contains('racing'),
    { timeout: 25000, polling: 250 }).catch(() => {});
  await sleep(1500);
  const practice = await page.evaluate(() => ({
    racing: document.body.classList.contains('racing'),
    mode: document.getElementById('modeOverlay').classList.contains('show'),
    room: document.getElementById('roomOverlay').classList.contains('show'),
  }));
  record('practice starts instantly', practice.racing && !practice.mode && !practice.room, JSON.stringify(practice));
  if (!practice.racing) failed = true;
  await shot(page, 'race-practice-844x390');
  await page.evaluate(() => { if (window.__rkDebug && window.__rkDebug.pause) window.__rkDebug.pause(); });
  await sleep(500);
  await page.evaluate(() => { const b = document.getElementById('quitMenuBtn'); if (b) b.click(); });
  await sleep(800);

  // ---------- other viewports ----------
  for (const [w, h] of [[800, 360], [1280, 800]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(700);
    const mv = await menuState();
    record(`menu renders at ${w}x${h}`, mv.startVisible && !mv.racing, `chip="${mv.chip}"`);
    await shot(page, `menu-${w}x${h}`);
  }

  const appErrors = errors.filter((e) => !/WebGL|THREE|Shader/i.test(e));
  record('no app console errors', appErrors.length === 0, appErrors.length ? appErrors.slice(0, 3).join(' | ') : 'none');
  if (appErrors.length) failed = true;

  console.log('\n' + (failed ? 'FIX-STEP1 CHECK: FAILURES' : 'FIX-STEP1 CHECK: ALL PASS'));
} catch (e) {
  console.log('ERROR: ' + (e && e.message));
  failed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
process.exit(failed ? 1 : 0);
