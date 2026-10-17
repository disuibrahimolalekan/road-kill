#!/usr/bin/env node
// step2-city-check.mjs — proves the Step 2 city street art is genuinely wired
// into the rendered scene rather than merely present in public/art/.
//
// Headless Chromium here cannot composite WebGL (a control page that only
// clears a context to red also screenshots white), so this verifies the scene
// GRAPH instead: which textures the materials ended up holding, how many prop
// groups were built, and what the renderer reports for calls/triangles.

import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const OUT = '/data/data/com.termux/files/usr/tmp/opencode/step1';
const results = [];
const record = (n, ok, d) => { results.push({ n, ok, d }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(34)} ${d}`); };

const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser', headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-zygote', '--hide-scrollbars'],
});
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
    { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait'));
  // the art is fetched after boot and the track is rebuilt when it lands
  await sleep(7000);

  const info = await page.evaluate(() => {
    const d = window.__rkDebug;
    const srcs = new Map();       // texture image file -> times referenced
    let meshes = 0, groups = 0, withMap = 0, alphaCut = 0;
    const wanted = ['texture-road.png', 'texture-sidewalk.png', 'building-facade-1.png',
                    'building-facade-2.png', 'building-facade-3.png', 'texture-cone.png',
                    'texture-tree.png', 'streetlight.png', 'tram.png', 'parkedcar.png'];
    d.scene.traverse((o) => {
      if (o.isMesh) meshes++;
      if (o.isGroup) groups++;
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (m.map && m.map.image && m.map.image.src) {
          withMap++;
          const f = m.map.image.src.split('/').pop().split('?')[0];
          srcs.set(f, (srcs.get(f) || 0) + 1);
        }
        if (m.alphaTest > 0 && m.transparent) alphaCut++;
      }
    });
    const files = [...srcs.keys()];
    return {
      meshCount: meshes, groupCount: groups, matsWithMap: withMap, alphaCutMats: alphaCut,
      present: wanted.filter((w) => files.includes(w)),
      missing: wanted.filter((w) => !files.includes(w)),
      allArtFiles: files.filter((f) => /\.(png)$/.test(f)),
      usesCounts: Object.fromEntries([...srcs.entries()].filter(([k]) => /\.(png)$/.test(k))),
      calls: d.renderer.info.render.calls,
      tris: d.renderer.info.render.triangles,
      progs: d.renderer.info.programs ? d.renderer.info.programs.length : -1,
      artReady: !!window.__rkArtReady,
    };
  });

  const expect = ['texture-road.png', 'texture-sidewalk.png', 'building-facade-1.png',
                  'building-facade-2.png', 'building-facade-3.png'];
  const missingCore = expect.filter((e) => !info.present.includes(e));
  record('road + sidewalk + facades applied', missingCore.length === 0,
    `present=${info.present.length}/10` + (missingCore.length ? ` MISSING=${missingCore}` : ''));

  const props = ['streetlight.png', 'tram.png', 'parkedcar.png', 'texture-cone.png', 'texture-tree.png'];
  const missingProps = props.filter((e) => !info.present.includes(e));
  record('roadside props applied', missingProps.length === 0,
    missingProps.length ? `MISSING=${missingProps}` : props.join(' '));

  record('alpha-cut prop materials present', info.alphaCutMats > 0, `${info.alphaCutMats} materials with alphaTest`);
  record('scene populated', info.meshCount > 200 && info.tris > 10000,
    `${info.meshCount} meshes, ${info.groupCount} groups, ${info.tris} tris, ${info.calls} calls`);
  record('draw calls within phone budget', info.calls > 0 && info.calls < 1400,
    `${info.calls} calls / ${info.progs} programs`);

  const appErrors = errors.filter((e) => !/WebGL|THREE|Shader|VALIDATE|Program Info/i.test(e));
  record('no app console errors', appErrors.length === 0, appErrors.length ? appErrors.slice(0, 3).join(' | ') : 'none');
  if (appErrors.length) failed = true;
  if (missingCore.length || missingProps.length || info.alphaCutMats <= 0) failed = true;
  if (!(info.meshCount > 200 && info.tris > 10000)) failed = true;
  if (!(info.calls > 0 && info.calls < 1400)) failed = true;

  console.log('\ntexture usage: ' + JSON.stringify(info.usesCounts));
  console.log('all art files in scene: ' + JSON.stringify(info.allArtFiles));
  console.log('\n' + (failed ? 'STEP 2 CHECK: FAILURES' : 'STEP 2 CHECK: ALL PASS'));
  await page.screenshot({ path: OUT + '/step2-city.png' });
} catch (e) {
  console.log('ERROR: ' + (e && e.message)); failed = true;
} finally { await browser.close().catch(() => {}); }
process.exit(failed ? 1 : 0);
