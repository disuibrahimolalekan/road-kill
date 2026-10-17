import puppeteer from 'puppeteer-core';
import fs from 'fs';

const OUT = process.env.OUT || '/data/data/com.termux/files/usr/tmp/opencode/step1';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: 'new',
  args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-zygote'],
});

const SIZES = [
  { name: 'phone-844x390',   w: 844,  h: 390,  mobile: true  },
  { name: 'phone-800x360',   w: 800,  h: 360,  mobile: true  },
  { name: 'tablet-1280x800', w: 1280, h: 800,  mobile: false },
];

const errors = [];

for (const s of SIZES) {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${s.name}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${s.name}] PAGEERROR ${e.message}`));
  await page.setViewport({ width: s.w, height: s.h, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  // boot can take longer on the larger viewport; poll rather than assume
  let booted = false;
  for (let i = 0; i < 25 && !booted; i++) {
    await new Promise(r => setTimeout(r, 400));
    booted = await page.evaluate(() => !!(window.__rkDebug && window.__rkBooted));
  }
  if (!booted) {
    const why = await page.evaluate(() => window.__rkBootError || 'no error recorded, __rkDebug=' + (typeof window.__rkDebug));
    console.log(`${s.name}: NOT BOOTED — ${why}`);
  }

  // This headless Chromium cannot composite WebGL canvases at all (a raw-GL
  // clear-to-red control also screenshots pure white), so hide the canvas to
  // reveal the CSS world backdrop the game now falls back to. On the tablet
  // size SwiftShader cannot even allocate a context, so the app's own
  // "3D not supported" fallback is up instead — hide that banner for a clean
  // layout shot, but record that 3D was unavailable.
  const glState = await page.evaluate(() => {
    const fail = document.getElementById('glFailBanner');
    const had3D = !fail;
    if (fail) fail.style.display = 'none';
    document.getElementById('c').style.visibility = 'hidden';
    return had3D ? 'webgl-ok' : 'webgl-unavailable (app fallback active)';
  });
  await new Promise(r => setTimeout(r, 200));

  await page.screenshot({ path: `${OUT}/${s.name}-1-start.png` });

  await page.evaluate(() => {
    if (window.__rkDebug) window.__rkDebug.setRacing(true);
    else document.body.classList.add('racing');
    document.getElementById('positions').classList.add('open');
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `${OUT}/${s.name}-2-race.png` });

  const audit = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const zones = {
      minimap:'#minimap', statBars:'#statBars', banner:'#lapBanner', topRight:'#trCluster',
      speedo:'#speedo', leftPad:'#leftPad', rightPad:'#rightPad', gasPad:'#gasPad',
      brakePad:'#brakePad', firePad:'#firePad', boostPad:'#boostPad', jumpPad:'#jumpPad',
      weaponPad:'#weaponPad', positions:'#positions', perfHUD:'#perfHUD',
    };
    const out = { W, H, boxes: {}, overflow: [], middleHits: [], offThumb: [] };
    // "keep the middle clear" = a 240x120 box around the screen centre
    const cx0 = W/2-120, cx1 = W/2+120, cy0 = H/2-60, cy1 = H/2+60;
    for (const [k, sel] of Object.entries(zones)) {
      const el = document.querySelector(sel);
      if (!el) { out.overflow.push(`${k}: MISSING`); continue; }
      const r = el.getBoundingClientRect();
      out.boxes[k] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.overflow.push(`${k} ${JSON.stringify(out.boxes[k])}`);
      if (r.right > cx0 && r.left < cx1 && r.bottom > cy0 && r.top < cy1) out.middleHits.push(`${k} ${JSON.stringify(out.boxes[k])}`);
      // every thumb control must sit in the bottom 60% of the screen
      const isThumb = /Pad$/.test(k);
      if (isThumb && r.bottom < H * 0.4) out.offThumb.push(`${k} bottom=${Math.round(r.bottom)}`);
    }
    // pairwise overlap between zones that should never touch
    const pairs = [['positions','boostPad'],['positions','firePad'],['positions','jumpPad'],
                   ['speedo','leftPad'],['speedo','rightPad'],['speedo','gasPad'],['speedo','weaponPad'],
                   ['mmZone','banner'],['banner','topRight'],['minimap','statBars']];
    const overlaps = [];
    for (const [a, b] of pairs) {
      const A = out.boxes[a], B = out.boxes[b];
      if (!A || !B) continue;
      const ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]);
      const oy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
      if (ox > 2 && oy > 2) overlaps.push(`${a}/${b} by ${Math.round(ox)}x${Math.round(oy)}px`);
    }
    out.overlaps = overlaps;
    return out;
  });
  fs.writeFileSync(`${OUT}/${s.name}-audit.json`, JSON.stringify(audit, null, 1));
  console.log(`${s.name.padEnd(18)} 3D=${glState}`);
  console.log(`${''.padEnd(18)} overflow=${audit.overflow.length ? audit.overflow.join(', ') : 'none'}`);
  console.log(`${''.padEnd(18)} middle-clear=${audit.middleHits.length ? audit.middleHits.join(', ') : 'OK'}  thumb-reach=${audit.offThumb.length ? audit.offThumb.join(', ') : 'OK'}`);
  console.log(`${''.padEnd(18)} overlaps=${audit.overlaps && audit.overlaps.length ? audit.overlaps.join(', ') : 'none'}`);
  await page.close();
}

// ---- the four connection states, on the phone size ----
const connSamples = [];
{
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(`[conn] PAGEERROR ${e.message}`));
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2400));
  await page.evaluate(() => {
    const fail = document.getElementById('glFailBanner');   // hide app fallback banner for a clean shot
    if (fail) fail.style.display = 'none';
    document.getElementById('c').style.visibility = 'hidden';
  });

  for (const st of ['connecting', 'waking', 'failed', 'retry']) {
    await page.evaluate((state) => {
      const d = window.__rkDebug;
      d.stopWakeCountdown();
      d.showConnState(state, state === 'failed' ? 'Could not reach rk-server.onrender.com (ETIMEDOUT after 15s).' : undefined);
      if (state === 'waking') d.startWakeCountdown(60);
    }, st);
    await new Promise(r => setTimeout(r, st === 'waking' ? 1800 : 400));
    await page.screenshot({ path: `${OUT}/conn-${st}.png` });
    const css = await page.evaluate(() => {
      const o = document.getElementById('connOverlay'), c = o.querySelector('.card');
      const s = getComputedStyle(o), cs = getComputedStyle(c);
      return { state: o.dataset.state, bg: s.backgroundColor, border: cs.borderTopColor,
               title: document.getElementById('connTitle').textContent,
               badge: document.getElementById('connBadge').textContent.trim(),
               titleColor: getComputedStyle(document.getElementById('connTitle')).color,
               retry: getComputedStyle(document.getElementById('connRetryBtn')).display,
               spin: getComputedStyle(document.getElementById('connSpin')).display,
               countdown: getComputedStyle(document.getElementById('connWrap')).display,
               fill: document.getElementById('connFill').style.width };
    });
    connSamples.push(css);
    console.log(`conn ${css.state.padEnd(11)} bg=${css.bg.padEnd(22)} border=${css.border.padEnd(22)} badge=${css.badge} title="${css.title}" retry=${css.retry} spin=${css.spin} cd=${css.countdown} ${css.fill}`);
  }
  await page.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/conn-states.json`, JSON.stringify(connSamples, null, 1));

const uniq = new Set(connSamples.map(c => `${c.bg}|${c.border}|${c.titleColor}|${c.badge}|${c.title}`));
console.log(`\nconnection states distinct: ${uniq.size}/4`);
if (errors.length) { console.log('\nCONSOLE ERRORS:'); [...new Set(errors)].forEach(e => console.log('  ' + e)); }
else console.log('no console errors');
console.log('shots ->', OUT);
