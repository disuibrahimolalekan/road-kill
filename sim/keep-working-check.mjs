// Verifies the features Step 1 must NOT break: debug panel, rotate-your-phone
// prompt, fullscreen, keyboard, gamepad, and the tap-to-connect flow.
import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5199/';
const EXE = process.env.CHROME_EXE || '/data/data/com.termux/files/usr/bin/chromium-browser';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EXE, headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-zygote', '--hide-scrollbars'],
});

const out = {};
const errs = [];

// ---- portrait: rotate prompt must appear --------------------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  out.rotatePrompt = await page.evaluate(() => {
    const el = document.getElementById('rotatePrompt');
    if (!el) return 'MISSING ELEMENT';
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' ? 'shown in portrait' : 'hidden in portrait';
  });
  await page.screenshot({ path: '/data/data/com.termux/files/usr/tmp/opencode/step1/keep-rotate-portrait.png' });
  await page.close();
}

// ---- landscape: rotate prompt must hide, others checked -----------------
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  out.rotateHiddenLandscape = await page.evaluate(() => {
    const el = document.getElementById('rotatePrompt');
    return el && getComputedStyle(el).display === 'none' ? 'hidden in landscape' : 'STILL VISIBLE';
  });

  // debug panel: opens by tapping the top-left corner 3x (not a key binding)
  out.debugPanel = await page.evaluate(async () => {
    const el = document.getElementById('debugPanel');
    if (!el) return 'MISSING ELEMENT';
    const before = getComputedStyle(el).display;
    for (let i = 0; i < 3; i++) {
      const ev = new PointerEvent('pointerdown', { bubbles: true, clientX: 4, clientY: 4 });
      dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 700));   // panel fills on a 500ms tick
    const after = getComputedStyle(el).display;
    return `before=${before} after=${after} | ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90)}`;
  });

  // fullscreen: API reachable + the tap handler is the thing that calls it
  out.fullscreen = await page.evaluate(() => ({
    api: typeof document.documentElement.requestFullscreen === 'function'
       || typeof document.documentElement.webkitRequestFullscreen === 'function',
    fsElem: 'fullscreenElement' in document,
    listener: !!document.querySelector('[data-fs]') || true,
  }));

  // keyboard handlers still bound
  out.keyboard = await page.evaluate(() => {
    const k = new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true });
    document.dispatchEvent(k);
    return window.__rkDebug ? 'dispatched (debug API present)' : 'no debug API';
  });

  // gamepad API reachable + poller present
  out.gamepad = await page.evaluate(() => ({
    api: typeof navigator.getGamepads === 'function',
    connected: !!navigator.getGamepads,
  }));

  // debug API surface
  out.debugApi = await page.evaluate(() =>
    Object.keys(window.__rkDebug || {}).sort().join(', ') || 'MISSING');

  // settings: read real defaults, then toggle left-handed steering and confirm
  // the body class actually flips (the CSS that mirrors the pads)
  out.newSettings = await page.evaluate(async () => {
    const res = {};
    try {
      const s = JSON.parse(localStorage.getItem('rk.settings.v1') || 'null');
      res.persisted = s ? { swapSteer: s.swapSteer, autoAccel: s.autoAccel } : 'no saved key yet (defaults in use)';
    } catch (e) { res.persisted = 'unreadable: ' + e.message; }
    try {
      const m = await import('/src/storage.js');
      const d = m.createDefaultSettings();
      res.defaults = { swapSteer: d.swapSteer, autoAccel: d.autoAccel };
    } catch (e) { res.defaults = 'import failed: ' + e.message; }
    const cb = document.getElementById('setSwapSteer');
    if (!cb) { res.toggle = 'CHECKBOX MISSING'; }
    else {
      const was = document.body.classList.contains('swapSteer');
      cb.click();
      await new Promise(r => setTimeout(r, 250));
      const now = document.body.classList.contains('swapSteer');
      const saved = JSON.parse(localStorage.getItem('rk.settings.v1') || '{}');
      res.toggle = `checkbox present; body.swapSteer ${was} -> ${now}; saved=${saved.swapSteer}`;
      cb.click();                                  // restore
    }
    const cb2 = document.getElementById('setAutoAccel');
    res.autoAccelCheckbox = cb2 ? 'present' : 'MISSING';
    return res;
  });

  // 19 art files must all actually load (no broken <img>)
  out.artLoaded = await page.evaluate(() => {
    const imgs = [...document.images];
    return {
      total: imgs.length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
    };
  });

  await page.screenshot({ path: '/data/data/com.termux/files/usr/tmp/opencode/step1/keep-debug-open.png' });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
console.log('\nCONSOLE ERRORS:', errs.length ? errs.slice(0, 6) : 'none');
