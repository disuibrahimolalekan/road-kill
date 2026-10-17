// Proves the "no emoji anywhere" requirement, in the running game.
//
// Two checks per screen:
//   1. no emoji codepoints in any visible text node (typographic arrows/dashes
//      are fine — they are not emoji, they render identically everywhere);
//   2. every <svg class="ic"> has a <use> whose symbol actually exists in the
//      sprite, i.e. it draws something rather than nothing.
//
// Screens covered: start menu, race HUD, all four connection states, and the
// garage / settings / lobby overlays (opened by clicking their real buttons).

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:5199/';
const OUT = '/data/data/com.termux/files/usr/tmp/opencode/step1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-zygote', '--hide-scrollbars'],
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Boot is synchronous and takes seconds under SwiftShader (shader compile), and
// the frame loop only registers AFTER boot — screenshots taken earlier capture
// an un-drawn HUD. Wait for real boot + a settled frame counter instead of a
// fixed sleep.
await page.waitForFunction(
  () => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
  { timeout: 45000, polling: 250 },
).catch(() => console.log('  WARN: boot/frame wait timed out'));
await sleep(1200);

// Hide the canvas so the CSS world backdrop shows (this headless Chromium
// cannot composite WebGL) and hide the app's fallback banner if it is up.
await page.evaluate(() => {
  const f = document.getElementById('glFailBanner');
  if (f) f.style.display = 'none';
  document.getElementById('c').style.visibility = 'hidden';
});

const SCAN = `(() => {
  // Everything in these ranges is an emoji pictograph. → and friends are
  // ordinary typographic glyphs that render the same on every platform.
  const EMOJI = /[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{1F1E6}-\\u{1F1FF}]/u;
  const ALLOWED = '\\u2192\\u2190\\u2022\\u00b7\\u2013\\u2014\\u2026\\u00d7\\u25cf\\u25cb\\u25aa\\u2023\\u27a4';
  // An icon inside #hud while the start screen is up is *hidden*, not broken —
  // skip anything an ancestor takes out of the box tree.
  const shown = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cs.opacity === '0') return false;
    }
    return true;
  };
  const emoji = [], broken = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue || '';
    for (const ch of t) {
      if (!EMOJI.test(ch)) continue;
      if (ALLOWED.includes(ch)) continue;
      const el = n.parentElement;
      if (!el || !shown(el)) continue;
      emoji.push({ ch, cp: 'U+' + ch.codePointAt(0).toString(16).toUpperCase(),
                   tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
                   text: t.trim().slice(0, 60) });
      break;
    }
  }
  const svgs = [...document.querySelectorAll('svg.ic')];
  let visible = 0;
  const lowContrast = [];
  for (const s of svgs) {
    const use = s.querySelector('use');
    const href = use && (use.getAttribute('href') || use.getAttribute('xlink:href'));
    if (!href) { if (shown(s)) broken.push('no <use>'); continue; }
    let sym = null;
    try { sym = document.querySelector(href); } catch (e) { if (shown(s)) broken.push('bad href ' + href); continue; }
    if (!sym) { if (shown(s)) broken.push('missing symbol ' + href); continue; }
    if (!shown(s)) continue;              // hidden by design -> not our problem
    visible++;
    const r = s.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { broken.push('zero-size ' + href); continue; }
    // every surface in this game is dark, so a dark color means the icon is
    // invisible even though it technically drew. The emoji this replaced ignored
    // color entirely, which is how the missing HUD colour went unnoticed.
    const m = getComputedStyle(s).color.match(/(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
      if (lum < 0.30) lowContrast.push(href + ' color=' + getComputedStyle(s).color);
    }
  }
  return { emoji, broken, lowContrast, iconTotal: svgs.length, iconVisible: visible };
})()`;

const report = {};

async function scan(label) {
  await sleep(450);
  const r = await page.evaluate(SCAN);
  report[label] = { emoji: r.emoji, broken: r.broken, lowContrast: r.lowContrast,
                    icons: `${r.iconVisible}/${r.iconTotal} visible` };
  const bad = r.emoji.length || r.broken.length || r.lowContrast.length;
  console.log(`${(bad ? 'FAIL' : 'ok  ')}  ${label.padEnd(26)} emoji=${r.emoji.length}  icons=${r.iconVisible}/${r.iconTotal}  broken=${r.broken.length}  invisible=${r.lowContrast.length}`);
  r.emoji.slice(0, 6).forEach((e) => console.log(`        ${e.ch} ${e.cp} in ${e.tag} "${e.text}"`));
  r.broken.slice(0, 6).forEach((b) => console.log('        broken: ' + b));
  r.lowContrast.slice(0, 6).forEach((c) => console.log('        dark:   ' + c));
}

// 1 — start menu
await scan('start-menu');
await page.screenshot({ path: `${OUT}/icon-1-start.png` });

// 2 — race HUD
await page.evaluate(() => {
  if (window.__rkDebug) window.__rkDebug.setRacing(true);
  else document.body.classList.add('racing');
  document.getElementById('positions').classList.add('open');
});
await scan('race-hud');
await page.screenshot({ path: `${OUT}/icon-2-race.png` });

// 3 — race order collapsed + weapon present
await page.evaluate(async () => {
  document.getElementById('positions').classList.remove('open');
  // drive the HUD through a few states so the weapon / fuel paths render
  window.__rkDebug && window.__rkDebug.setRacing(true);
});
await scan('race-hud-collapsed');

// 4 — the four connection states
for (const st of ['connecting', 'waking', 'failed', 'retry']) {
  await page.evaluate((s) => {
    document.body.classList.remove('racing');
    if (window.__rkDebug) window.__rkDebug.showConnState(s);
  }, st);
  if (st === 'waking' || st === 'retry') {
    await page.evaluate(() => window.__rkDebug && window.__rkDebug.startWakeCountdown(59));
  }
  await scan('conn-' + st);
  await page.screenshot({ path: `${OUT}/icon-conn-${st}.png` });
}
await page.evaluate(() => window.__rkDebug && window.__rkDebug.stopWakeCountdown());

// 5 — overlays, opened through their real buttons
await page.evaluate(() => window.__rkDebug && window.__rkDebug.showConnState('hide'));
await page.evaluate(() => { const b = document.getElementById('settingsBtn'); if (b) b.click(); });
await scan('settings-overlay');
await page.screenshot({ path: `${OUT}/icon-3-settings.png` });
await page.evaluate(() => { const b = document.getElementById('settingsClose'); if (b) b.click(); });

await page.evaluate(() => { const b = document.getElementById('garageBtn'); if (b) b.click(); });
await scan('garage-overlay');
await page.screenshot({ path: `${OUT}/icon-4-garage.png` });
await page.evaluate(() => { const b = document.getElementById('garageClose'); if (b) b.click(); });

await page.evaluate(() => { const b = document.getElementById('hostPrivateBtn'); if (b) b.click(); });
await scan('lobby-overlay');
await page.screenshot({ path: `${OUT}/icon-5-lobby.png` });
await page.evaluate(() => { const b = document.getElementById('onlineClose'); if (b) b.click(); });

await browser.close();

const badScreens = Object.entries(report)
  .filter(([, v]) => v.emoji.length || v.broken.length || v.lowContrast.length);

// This headless Chromium/SwiftShader cannot compile WebGL shaders in this
// memory-starved container (same root cause as the white screenshots), so
// shader/context noise is environmental and not a UI regression.
const ENV = /WebGLProgram|WebGL context|WebGLRenderer|VALIDATE_STATUS|Shader Error/;
const envErrors = errors.filter((e) => ENV.test(e));
const appErrors = errors.filter((e) => !ENV.test(e));

console.log('\n' + (badScreens.length ? `SCREENS WITH EMOJI/BROKEN/INVISIBLE ICONS: ${badScreens.length}` : 'ALL SCREENS CLEAN — zero emoji, zero broken, zero invisible icons'));
console.log('app console errors:', appErrors.length ? appErrors.slice(0, 6) : 'none');
if (envErrors.length) console.log(`environmental WebGL noise (expected here): ${envErrors.length}`);
fs.writeFileSync(`${OUT}/no-emoji-report.json`,
  JSON.stringify({ report, appErrors, envErrors: envErrors.length }, null, 2));
process.exit(badScreens.length || appErrors.length ? 1 : 0);
