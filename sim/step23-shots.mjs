#!/usr/bin/env node
// step23-shots.mjs — the screenshot deliverable for Takeover Steps 2 and 3.
//
//   node sim/step23-shots.mjs --url http://127.0.0.1:5199/ --out "/sdcard/Road kill/screenshots/step2" [--volt]
//
// Captures the start menu and an in-race frame at 844x390, 800x360 and a
// 1280x800 tablet at each stop, against a LOCAL game server (no prod dependency).
//
// Why the retry loop: this Termux headless Chromium loses the SwiftShader
// WebGL context on a random schedule, and a lost context screenshots the canvas
// layer as flat white (~67% of the frame) even though the app keeps running.
// The context is fine on a given frame or it is not, so every capture is
// measured and re-shot until the frame actually contains the world.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('--url', 'http://127.0.0.1:5199/');
const OUT = arg('--out', '/sdcard/Road kill/screenshots/step2');
const VOLT = argv.includes('--volt');
const SERVER_PORT = Number(arg('--server-port', 8141));
const WS = `ws://127.0.0.1:${SERVER_PORT}`;

const CHROME = '/data/data/com.termux/files/usr/bin/chromium-browser';
const SIZES = [
  { w: 844, h: 390, tag: '844x390' },
  { w: 800, h: 360, tag: '800x360' },
  { w: 1280, h: 800, tag: 'tablet-1280x800' },
];

mkdirSync(OUT, { recursive: true });

// ---------- local server ----------
const server = spawn(process.execPath, ['server/server.js', String(SERVER_PORT)], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 60 && !serverLog.includes('server on'); i++) await sleep(250);
if (!serverLog.includes('server on')) {
  console.log('server failed to start:\n' + serverLog);
  server.kill(); process.exit(1);
}
console.log(`local server on :${SERVER_PORT}\n`);

const frameStats = (buf) => {
  const png = PNG.sync.read(Buffer.from(buf));
  let white = 0, colorful = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 31) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const lum = 0.3 * r + 0.6 * g + 0.1 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (r > 245 && g > 245 && b > 245) white++;
    if (sat > 18 && lum > 24) colorful++;
    n++;
  }
  return { white: +(100 * white / n).toFixed(1), colorful: +(100 * colorful / n).toFixed(1) };
};

const report = [];

// Capture a shot, re-shooting while the WebGL layer has gone flat white.
// `reloadable` is set for the start-menu shots: if the context is stuck lost,
// reloading gets a fresh one, which is worth doing for a boot-level state. The
// race shots are NOT reloadable — reloading would leave the race and there is
// nothing left to photograph.
async function capture(page, file, label, { reloadable = false } = {}) {
  let best = null;
  for (let pass = 0; pass < 2; pass++) {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const buf = Buffer.from(await page.screenshot());
      const s = frameStats(buf);
      best = { buf, s, attempt };
      if (s.white < 25 && s.colorful > 3) break;
      await sleep(700);
    }
    if (best.s.white < 25 || !reloadable || pass === 1) break;
    try {                                   // stuck lost context -> fresh page
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await boot(page);
      await sleep(2500);
    } catch { break; }
  }
  writeFileSync(`${OUT}/${file}`, best.buf);
  const line = `${label.padEnd(30)} white=${String(best.s.white).padStart(5)}%  colourful=${String(best.s.colorful).padStart(5)}%  ${best.attempt > 1 ? `(attempt ${best.attempt})` : ''}${best.s.white >= 25 ? '  <-- flat white, context lost' : ''}`;
  console.log(line);
  report.push({ file, ...best.s, attempts: best.attempt, flatWhite: best.s.white >= 25 });
  return best.s;
}

const boot = (page) => page.waitForFunction(
  () => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
  { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait'));

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--no-zygote', '--hide-scrollbars'],
  });

  for (const size of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((ws) => {
      try { localStorage.setItem('rk.server.url', ws); } catch {}
    }, WS);

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await boot(page);
    await sleep(2500);                       // let the city art finish loading

    if (VOLT) {
      // Equip through the same path the garage uses, when the hook exists.
      await page.evaluate(() => {
        const d = window.__rkDebug;
        if (d && d.equipVehicle) d.equipVehicle('volt_roadster');
      });
      await sleep(800);
    }

    await capture(page, `${size.tag}-1-startmenu.png`, `${size.tag} start menu`, { reloadable: true });

    await page.click('#practiceBtn');
    await page.waitForFunction(() => document.body.classList.contains('racing'),
      { timeout: 25000, polling: 250 }).catch(() => console.log('WARN: race did not start'));
    await sleep(7000);                       // art reload + track rebuild + settle

    // Defensive: a missing method here aborted the whole size (the tablet's
    // race shot was lost that way), and this is diagnostics — it must never be
    // able to stop the capture it is describing.
    const state = await page.evaluate(() => {
      const d = window.__rkDebug || {}, r = d.renderer;
      let lost = null, calls = -1, car = null;
      try { const c = r.getContext ? r.getContext() : (r.context || null); lost = c && c.isContextLost ? c.isContextLost() : null; } catch { lost = 'err'; }
      try { calls = r && r.info && r.info.render ? r.info.render.calls : -1; } catch {}
      try { car = d.carInfo ? d.carInfo().vehicleId || null : null; } catch {}
      return {
        booted: !!window.__rkBooted, frames: window.__rkFrames || 0, lost, calls, car,
        racing: document.body.classList.contains('racing'),
      };
    });
    console.log(`      state: ${JSON.stringify(state)}`);

    await capture(page, `${size.tag}-2-race.png`, `${size.tag} race`);
    await page.close();
  }
} catch (e) {
  console.log('ERROR: ' + (e && e.message));
  report.push({ error: String(e && e.message) });
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}

writeFileSync(`${OUT}/shots-report.json`, JSON.stringify({
  url: BASE, volt: VOLT, when: new Date().toISOString(), shots: report,
}, null, 2));
console.log(`\nwrote ${report.filter((r) => !r.error).length} shots -> ${OUT}`);
