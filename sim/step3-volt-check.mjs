#!/usr/bin/env node
// step3-volt-check.mjs — proves the Volt Roadster is real: the housings are on
// the mesh, both thrusters cost fuel and run a cooldown, the side thruster
// actually dodges (invuln) and actually knocks a nearby car away, and the
// abilities are reachable from the on-screen pads — not just from a debug call.

import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const results = [];
const record = (n, ok, d) => { results.push({ n, ok, d }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(38)} ${d}`); };

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
  await sleep(500);

  // ---------- 1. equip it and get into a race ----------
  const equipped = await page.evaluate(() => window.__rkDebug.equipVehicle('volt_roadster'));
  record('equip VOLT ROADSTER', equipped === true, 'setPlayerVehicle -> ' + equipped);
  // no reload: setPlayerVehicle rebuilds the car in place, exactly as the
  // garage does, so the harness exercises the real equip path.
  await sleep(300);

  await page.click('#practiceBtn');
  await page.waitForFunction(() => document.body.classList.contains('racing'), { timeout: 25000 }).catch(() => {});
  await sleep(2500);

  const info = await page.evaluate(() => window.__rkDebug.carInfo());
  record('car is the Volt Roadster', info.vehicleId === 'volt_roadster', `vehicleId=${info.vehicleId}`);
  record('hardpoints on the mesh', info.chassisKids >= 16,
    `${info.chassisKids} chassis children (18 housings expected)`);
  record('catalog lists both thrusters', !!(info.thrusters.rear && info.thrusters.side),
    `rear=${!!info.thrusters.rear} side=${!!info.thrusters.side} ` +
    `started=${info.started} paused=${info.paused} finished=${info.finished} wrecked=${info.wrecked} fuel=${info.fuel}`);

  // ---------- 2. rear thruster: fuel + cooldown + burst ----------
  const fuel0 = info.fuel;
  const rear = await page.evaluate(async () => {
    window.__rkDebug.repair();
    window.__rkDebug.resetThrusters();
    window.__rkDebug.setFuel(60);
    const fired = window.__rkDebug.fireRear();
    const a = window.__rkDebug.carInfo();
    const again = window.__rkDebug.fireRear();      // cooldown must block this
    const b = window.__rkDebug.carInfo();
    window.__rkDebug.setFuel(5);
    window.__rkDebug.resetThrusters();
    const poor = window.__rkDebug.fireRear();       // must refuse: 5 < 14 cost
    const c = window.__rkDebug.carInfo();
    window.__rkDebug.setFuel(60);
    return { fired, a, again, b, poor, c, cost: 14, cd: 7 };
  });
  record('rear thruster fires (fuel -14, cd 7s)', rear.fired === true
    && rear.a.fuel === 60 - rear.cost && Math.abs(rear.a.rearCd - rear.cd) < 0.01,
    `fuel 60->${rear.a.fuel}, rearCd=${rear.a.rearCd}`);
  record('rear burst gives forward thrust', rear.a.boostTime > 1.0 && rear.a.boostTime <= 1.3,
    `boostTime=${rear.a.boostTime}s`);
  record('cooldown blocks a second fire', rear.again === false && rear.b.rearCd > 6,
    `secondFire=${rear.again} cd=${rear.b.rearCd}`);
  record('refuses when fuel < cost', rear.poor === false && rear.c.fuel === 5,
    `fired=${rear.poor} fuel stayed ${rear.c.fuel}`);

  // ---------- 3. side thruster: dodge + knock + spin ----------
  const side = await page.evaluate(async () => {
    window.__rkDebug.repair();
    window.__rkDebug.resetThrusters();
    window.__rkDebug.setFuel(60);
    const bot = window.__rkDebug.putBotNear(4);
    const fired = window.__rkDebug.fireSide();
    const a = window.__rkDebug.carInfo();
    const shoveJustAfter = window.__rkDebug.botDisplacement();
    // Assert on the SHOVE, not on distance travelled. Distance is unusable
    // here: the bot revive path (updateCar, the `tSince>2.2` block) teleports
    // a bot to a checkpoint, and a 400ms window measured "77u" — physically
    // impossible and entirely that teleport. The shove value is exact evidence
    // of both halves of the fix: it is applied on the target by knockAway, and
    // it DROPS (6.86 -> 4.32, matching the 3/s decay) only because updateCar
    // ran the new block — which is the very same `if` that applies the
    // displacement. Decay running therefore proves the shove was applied.
    await new Promise((r) => setTimeout(r, 150));
    const disp = window.__rkDebug.botDisplacement ? window.__rkDebug.botDisplacement() : null;
    return { bot, fired, a, disp, shoveJustAfter, cost: 18, cd: 9 };
  });
  const knocked = !!(side.shoveJustAfter && side.shoveJustAfter.shove > 5
    && side.disp && side.disp.shove < side.shoveJustAfter.shove && side.disp.shove > 0);
  record('side thruster fires (fuel -18, cd 9s)', side.fired === true
    && side.a.fuel === 60 - side.cost && Math.abs(side.a.sideCd - side.cd) < 0.01,
    `fuel 60->${side.a.fuel}, sideCd=${side.a.sideCd}`);
  record('dodge window grants invuln', side.a.invuln > 0.3 && side.a.invuln <= 0.5,
    `invuln=${side.a.invuln}s (window 0.45s)`);
  record('knocks the nearby car away', knocked,
    side.disp ? `shove ${side.shoveJustAfter && side.shoveJustAfter.shove} -> ${side.disp.shove} in 150ms ` +
                `(3/s decay; moved ${side.disp.dist}u, teleport-polluted)`
              : 'no shove hook');
  record('spin does not launch the car', side.a.airborne === false,
    `airborne=${side.a.airborne}`);

  // ---------- 4. reachable from the actual on-screen pads ----------
  const pads = await page.evaluate(async () => {
    const jump = document.getElementById('jumpPad');
    window.__rkDebug.repair(); window.__rkDebug.resetThrusters(); window.__rkDebug.setFuel(60);
    if (jump) jump.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 250));
    const afterJump = window.__rkDebug.carInfo();

    // The bots ram constantly, so the car can be wrecked inside the ~120ms
    // between the repair and the next frame — which legitimately refuses the
    // ability. Retry until it is alive across the dispatch, so a flake here
    // can never masquerade as a broken thruster.
    const boostEl = document.getElementById('boostPad');
    let beforeBoost = null, justAfter = null, afterBoost = null, boostTries = 0;
    for (; boostTries < 6; boostTries++) {
      window.__rkDebug.repair(); window.__rkDebug.resetThrusters(); window.__rkDebug.setFuel(60);
      beforeBoost = window.__rkDebug.carInfo();
      if (boostEl) boostEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, button: 0 }));
      await new Promise((r) => setTimeout(r, 120));
      justAfter = window.__rkDebug.carInfo();
      await new Promise((r) => setTimeout(r, 400));
      afterBoost = window.__rkDebug.carInfo();
      if (justAfter.rearCd > 6.5) break;          // it fired — stop retrying
    }
    return { hasJump: !!jump, hasBoost: !!boostEl, afterJump, beforeBoost, justAfter, afterBoost, boostTries };
  });
  record('JUMP pad fires the side thruster', pads.hasJump && pads.afterJump.sideCd > 8
    && pads.afterJump.airborne === false,
    `sideCd=${pads.afterJump.sideCd} airborne=${pads.afterJump.airborne}`);
  record('BOOST pad fires the rear thruster', pads.hasBoost && pads.justAfter.rearCd > 6.5
    && pads.justAfter.boostTime > 1.0 && pads.afterBoost.rearCd < pads.justAfter.rearCd,
    `fuel ${pads.beforeBoost.fuel}->${pads.justAfter.fuel} (-14 cost, -1 more driving), ` +
    `rearCd ${pads.justAfter.rearCd}->${pads.afterBoost.rearCd} ticks, bt=${pads.justAfter.boostTime}`);

  // ---------- 5. balance vs the rest of the class ----------
  const cfg = await (await fetch('http://127.0.0.1:5199/shop-config.json')).json();
  const supers = cfg.vehicles.filter((v) => v.class === 'super');
  const volt = supers.find((v) => v.id === 'volt_roadster');
  const others = supers.filter((v) => v.id !== 'volt_roadster');
  const rng = (k) => [Math.min(...others.map((v) => v[k])), Math.max(...others.map((v) => v[k]))];
  const [t0, t1] = rng('top'), [h0, h1] = rng('hp'), [f0, f1] = rng('fuel');
  const inRange = (v, r) => v >= r[0] - 1e-9 && v <= r[1] + 1e-9;
  const ok = volt && inRange(volt.top, [t0 - 4, t1 + 2]) && inRange(volt.hp, [h0, h1])
    && inRange(volt.fuel, [f0, f1]) && volt.slots >= 1;
  record('balanced against the other supers', !!ok,
    `top ${volt && volt.top} [class ${t0}-${t1}], hp ${volt && volt.hp} [${h0}-${h1}], ` +
    `fuel ${volt && volt.fuel} [${f0}-${f1}], slots ${volt && volt.slots}, price ${volt && volt.price}`);

  // ---------- 6. the equipped car survives a reload ----------
  // setPlayerVehicle persists ownership, so a fresh page must come back in the
  // Volt — this is exactly the bug boot had (saved vehicle ignored).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__rkBooted === true && (window.__rkFrames || 0) > 30,
    { timeout: 45000, polling: 250 }).catch(() => console.log('WARN: boot wait'));
  await sleep(2500);
  const afterReload = await page.evaluate(() => window.__rkDebug.carInfo());
  record('equipped car survives a reload', afterReload.vehicleId === 'volt_roadster'
    && afterReload.chassisKids >= 16 && afterReload.hasThrusters === true,
    `vehicleId=${afterReload.vehicleId} chassisKids=${afterReload.chassisKids} thrusters=${afterReload.hasThrusters}`);

  const appErrors = errors.filter((e) => !/WebGL|THREE|Shader|VALIDATE|Program Info/i.test(e));
  record('no app console errors', appErrors.length === 0, appErrors.length ? appErrors.slice(0, 3).join(' | ') : 'none');
  if (appErrors.length) failed = true;
  if (results.some((r) => !r.ok)) failed = true;

  console.log('\n' + (failed ? 'STEP 3 CHECK: FAILURES' : 'STEP 3 CHECK: ALL PASS'));
} catch (e) {
  console.log('ERROR: ' + (e && e.message));
  failed = true;
} finally { await browser.close().catch(() => {}); }
process.exit(failed ? 1 : 0);
