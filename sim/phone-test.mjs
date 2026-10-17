// Headless phone-layout test for ROAD KILL (Prompt 3, Step 1)
// Usage: node sim/phone-test.mjs [outDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const OUT = resolve(process.argv[2] || '/sdcard/Road kill/screenshots');
mkdirSync(OUT, { recursive: true });

const CHROME = '/data/data/com.termux/files/usr/bin/chromium-browser';
const URL = process.env.RK_URL || 'http://127.0.0.1:5199/';

const sizes = [
  { name: 'phone-844x390-landscape', w: 844, h: 390 },   // iPhone 12/13 landscape
  { name: 'phone-390x844-portrait', w: 390, h: 844 },    // portrait → rotate prompt must show
  { name: 'phone-800x360-landscape', w: 800, h: 360 },   // small Android landscape
  { name: 'phone-360x800-portrait', w: 360, h: 800 },    // small Android portrait
  { name: 'tablet-1280x800', w: 1280, h: 800 },          // tablet landscape
];

const report = [];
for (const s of sizes) {
  // SwiftShader contexts leak per-page on this headless ARM build — fresh browser per size
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox', '--no-first-run', '--no-zygote',
      '--window-size=900,420',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: s.w, height: s.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => errors.push('GOTO: ' + e.message));
  await new Promise((r) => setTimeout(r, 4500)); // let it boot + render frames

  const state = await page.evaluate(() => {
    const q = (id) => !!document.getElementById(id)?.classList?.contains('show');
    const hud = document.getElementById('hud');
    const r = hud ? hud.getBoundingClientRect() : null;
    const over = [];
    // check every visible HUD child stays inside the viewport
    if (hud) for (const el of hud.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !cs.pointerEvents) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      if (b.left < -2 || b.top < -2 || b.right > innerWidth + 2 || b.bottom > innerHeight + 2) {
        over.push((el.id || el.className || el.tagName) + `@${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`);
      }
    }
    return {
      booted: !!window.__rkBooted,
      bootError: window.__rkBootError || null,
      rotateShown: q('rotatePrompt'),
      connShown: q('connOverlay') || null,
      connTitle: document.getElementById('connTitle')?.textContent || '',
      hudRect: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
      overflow: over.slice(0, 8),
      webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })(),
      frames: window.__rkFrames || 0,
      fps: window.__rkFps || 0,
      orientation: innerWidth > innerHeight ? 'landscape' : 'portrait',
      inner: innerWidth + 'x' + innerHeight,
    };
  });
  await page.screenshot({ path: resolve(OUT, s.name + '.png') });
  report.push({ size: s.name, ...state, errors: errors.slice(0, 6) });
  await page.close();
  await browser.close();
}
writeFileSync(resolve(OUT, 'phone-test-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, (k, v) => k === 'errors' && Array.isArray(v) ? v.slice(0, 3) : v, 1));
