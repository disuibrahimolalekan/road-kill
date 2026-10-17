# ROAD KILL — Game Road Map

> High-octane 3D arcade combat racer. Twisted Metal × Mario Kart energy.
> Built as a Progressive Web App (PWA) — plays in the browser, installs to your phone, works offline.
> Up to 6 players per live lobby. Shoot rivals. Take their money. Survive.

---

## PHASE 0 — Foundation (the playable offline slice) ✅ DONE — 2026-10-15
**Goal:** A single-player game you can actually play, with bots standing in for players.

- [x] Project scaffold (Vite + Three.js, ES modules, fixed 60Hz game loop) — `game/` (Vite 8.3, Three 0.186, `vite.config.js` host 0.0.0.0:5173)
- [x] Arcade vehicle physics (raycast hover-car model: accelerate, drift, boost) — accel/drag/lateral friction, speed cap MAX 42 + BOOST 1.55x, boost flame
- [x] Track generation from a spline → road mesh, walls, checkpoints, lap counting — CatmullRom 10-point loop → 220-sample ribbon, inner/outer walls, finish gantry, 14 checkpoints
- [x] 1 player car + 5 AI bots (waypoint driving, rubber-banding, basic dodging) — waypoint steer, curvature braking, car avoidance, stuck reverse, rubber-band catch-up/slow
- [x] HUD: speed, lap, health, position, minimap — topbar + healthbar + race order + 140px minimap with live blips
- [x] **Deliverable:** you can drive laps against 5 bots — 3-lap race, P/position ranking, win/finish overlay, pause/restart

**Run:** `cd game && npm install --no-bin-links && npx vite --host 0.0.0.0` → http://localhost:5173
**Build:** `dist/` prebuilt (551 KB, gzip 140 KB) — copy of internal `~/roadkill-build/dist`
**Controls:** WASD/Arrows drive, Space/Shift/BUTTON boost, P/Esc pause, on-screen mobile controls

## PHASE 1 — Combat & Weapons ✅ DONE — 2026-10-16
**Goal:** It's a *combat* racer, not just a racer.

- [x] Health + wreck system (car explodes when HP hits 0) — `combat.js: CAR_MAX_HP 100, createCombatState/shield/invuln/wrecked/respawnAt, applyDamage/tryRespawn (2.8s wreck → respawn), wall-hit damage 4–18 scaled by speed + car-car 12 dmg, onCarWrecked explosion + kill feed` — 2026-10-16 verified in-engine
- [x] Weapon pickups on the asphalt: rockets, machine gun, mines, shield — `main.js: PICKUP_COUNT 10 evenly spaced on spline + lateral jitter, createPickupMesh (rocket/mg/mine/shield meshes+glow), pickup respawn 8–10s, createPickupState/rollPickupType in combat.js` — 2026-10-16
- [x] **Expiring loadouts:** every weapon dies after its countdown timer — no hoarding — `WEAPON_DEFS ttl: rocket 12s/mg 10s/mine 14s/shield 5.2s, combat.js tickCombatStates decrements weapon.ttl+cooldown, auto-removes at 0, one slot replace via giveWeapon, shield gives invuln, HUD timer bar` — 2026-10-16
- [x] Bot combat AI: aim, fire on line-of-sight, strafe/dodge incoming fire — `main.js bot branch: seeks nearest pickup if unarmed, dodges incoming projectiles <18u (heading check), LOS cone 35deg/58u range, lead prediction + aimYaw, mine drop when chased, mg/rocket firing via shared fireWeapon; player dodge auto-nudge` — 2026-10-16
- [x] Explosion effects, hit feedback, screen shake, kill feed — `spawnExplosion (flash/core/ring/debris 14–20), spawnHitSpark, shake 0.55–0.6 + vignette/hitFlash, wrecked smoke+shield bubble, killFeedEl with wIcon+killer→victim, damage smoke by HP` — 2026-10-16
- [x] **Deliverable:** full race-combat loop vs. bots — 3-lap combat race vs 5 bots, pickups expire, everyone uses shared projectile sim, wreck→respawn loop, 60Hz fixed tick — 2026-10-16

**Combat state isolated for future server:** `src/combat.js` is pure JS (no THREE renderer imports) — `createCombatState, tickCombatStates, canFire, fireWeapon, createProjectile, applyDamage, tryRespawn, createPickupState` — `src/main.js` only maps that state to Three meshes/projectileMeshes/effects; identical sim can run headless on Node in Phase 4.
**Run:** `cd ~/roadkill-build && npm install --no-bin-links && npx vite --host 0.0.0.0` → http://localhost:5173  (or `cd "/sdcard/Road kill/game" && npx vite --host 0.0.0.0`)
**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (574 KB, gzip 147 KB) → copied to `game/dist` (sdcard symlink-safe)
**Controls:** J / X / Enter / FIRE button to shoot, hold FIRE for M-Gun auto-fire, drive as before

## PHASE 2 — Economy, Revives & Progression ✅ DONE — 2026-10-16
**Goal:** The incentive loop that makes aggression pay.

- [x] Eliminations drop **money tokens** — drive over them to collect — `economy.js: MONEY_PER_KILL_TOKEN 12 × TOKENS_PER_KILL 4 = $48/kill, TOKEN_LIFETIME 18s, TOKEN_COLLECT_RADIUS 3.6, spawnMoneyTokens/tickMoneyTokens + gold coin mesh + minimap gold blips + bot steal, collected via addMoney` — 2026-10-16
- [x] **Tiered revive:** wrecked → pay **1 gem** → back in. Wrecked again → **5 gems**. Again → **30 gems**. After that: permanent wreck — `combat.js: REVIVE_COSTS [1,5,30], getReviveCostForState/canRevive/doRevive (revivesUsed/permanentWreck/awaitingRevive/health 100/invuln 1.6); economy.js: payRevive/canAffordRevive; main.js: #reviveOverlay showReviveOverlay/hideReviveOverlay/doPlayerRevive, bots auto-revive 2.2s free (3 max then permanent)` — 2026-10-16
- [x] Gems + money stored client-side — `economy.js: localStorage rk.profile.v2 {money 80, gems 14, xp, level, tier, unlockedSkins, equippedSkin, stats}, loadProfile/saveProfile/addMoney/addGems, #econBar + moneyPop + levelBadge` — 2026-10-16
- [x] XP per match → **header levels** → rank tiers (Bronze → Silver → Gold → …) — `economy.js: XP_REWARDS kill 18 / finish [120,80,52,32,18,10], xpForLevel/getLevelFromXP/getTier (Bronze 1-5 → Master 31+), addXP with levelUp pop + finish moneyBonus 48/28/14/6, profile.stats {races,wins,kills,bestPos}` — 2026-10-16
- [x] Garage: buy car skins/upgrades with money (visual first, stats later) — `economy.js: GARAGE_SKINS 6 (STOCK RED free → GOLD 520), buySkin/equipSkin; main.js: #garageOverlay #garageGrid renderGarage/openGarage/closeGarage, player body color = equippedSkin` — 2026-10-16
- [x] **Deliverable:** reasons to keep playing one more race — full economy loop: wreck → $48 tokens → gems revive 1/5/30 → XP/levels/tiers → garage skins, HUD + overlays + persistence, 60Hz — 2026-10-16

**Economy isolated for future server:** `src/economy.js` pure JS (no THREE) — `REVIVE_COSTS, MONEY_PER_KILL_TOKEN, TOKENS_PER_KILL, createMoneyToken, getReviveCost, addMoney/addGems/addXP/payRevive/buySkin/equipSkin, GARAGE_SKINS` — `src/combat.js` adds `getReviveCostForState/canRevive/doRevive` (revivesUsed/permanentWreck); `src/main.js` maps to Three + DOM.
**Run:** `cd ~/roadkill-build && npm install --no-bin-links && npx vite --host 0.0.0.0` → http://localhost:5173  (or `cd "/sdcard/Road kill/game" && npx vite --host 0.0.0.0`)
**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (583 KB, gzip 150 KB `index-D0l9piJF.js`) → copied to `game/dist` (sdcard)
**Controls:** Drive/shoot as Phase 1 + collect gold tokens, REVIVE overlay (pay gems), GARAGE button to buy/equip skins

## PHASE 3 — Offline-First Persistence & PWA Shell ✅ DONE — 2026-10-16
**Goal:** Installable, playable with zero internet.

- [x] **IndexedDB** for profile, currency, match history, unlocks — `storage.js: roadkill-db v1 (profile/matches/syncQueue), loadProfileUnified/saveProfileIDB/recordMatch/getMatches, migrates Phase 2 localStorage once` — 2026-10-16
- [x] **LocalStorage** for settings/session (audio, controls, last car) — `storage.js: rk.settings.v1 {audio, quality, touchControls, lastCar, lastPlayedAt}, ⚙ SETTINGS overlay, lastCar auto-saved on garage equip` — 2026-10-16
- [x] Sync-queue stub — writes are queued for a future backend, shaped like API calls — `enqueueSyncOp/getSyncQueue/flushSyncQueueStub → POST /api/sync {op, payload, clientTs}, IDB primary + LS fallback, TRY SYNC NOW button + pending count` — 2026-10-16
- [x] **manifest.json** + **service worker** (cache-first assets) → installable on Android/iOS — `manifest.webmanifest (standalone, 192+512), sw.js cache-first roadkill-v1, INSTALL button via beforeinstallprompt, OFFLINE badge, base './'` — 2026-10-16
- [x] **Deliverable:** "Add to Home Screen", fully playable in airplane mode — `dist/` prebuilt (592 KB, gzip 151 KB `index-BZeL2TZ9.js`) + icons + sw, verified via python http.server: index/manifest/sw/icon all 200 — 2026-10-16

**Run:** `cd ~/roadkill-build && npx vite --host 0.0.0.0` → http://localhost:5173  (or `cd "/sdcard/Road kill/game" && npx vite --host 0.0.0.0`)
**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 → copied to `game/dist` (sdcard)
**Controls:** Drive/shoot as Phase 2 + ⚙ settings, INSTALL prompt, OFFLINE badge, match history in settings

## PHASE 4 — Real Multiplayer (netcode) ✅ DONE — 2026-10-16
**Goal:** 6 real humans, low latency.

- [x] Refactor sim: same game-state code runs local (bots) OR remote (server) — `netproto.js` shared shapes/validators; solo `cars[]` untouched, online swaps 5 AI bots for 5 interpolated ghost cars (`remoteGhosts`, idx 10+); `rankCars/HUD/minimap` are mode-aware — 2026-10-16
- [x] Authoritative Node.js server (rooms of 6, 20–30Hz tick) — `server/server.js` (`ws`, port 8130): rooms, 20Hz snapshot broadcast, rejects teleports (>30u) + speed hacks (cap 65.1u/s × 1.3), relays validated hits — verified with 6 headless clients in one room — 2026-10-16
- [x] Client prediction + server reconciliation (your car feels instant) — local physics never waits; 50ms input sender; `NetClient.reconcile` lerps <12u error, snaps above; server `correct` packets snap hard — 2026-10-16
- [x] Entity interpolation (other cars look smooth) — 100ms-delayed 2-snapshot midpoint lerp in `getRemoteStates`, ghost progress via `nearestTrackIdx` — 2026-10-16
- [x] Matchmaking: quick match → lobbies → private rooms with codes — ONLINE overlay: name + server URL + 4-letter code, QUICK MATCH fills first room <6, code joins/creates, roster + 7th-client-gets-new-room verified — 2026-10-16
- [x] Voice/text: emotes + quick chat first (voice later) — 6 quick-chat buttons (GG!, Nice shot!…) + relay, 1.2s rate limit, `#chatFeed` — verified relay — 2026-10-16
- [x] **Deliverable:** real 6-player races — solo bots hidden online, ghosts collide via projectiles (hit claims → server `event:hit`), car-car ghost shove deferred to Phase 5 — 2026-10-16

**Run server:** `cd server && npm install --no-bin-links && node server.js 8130`
**Run game:** `cd ~/roadkill-build && npx vite --host 0.0.0.0` → ONLINE → QUICK MATCH (server URL defaults to same host :8130)
**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (601 KB) → copied to `game/dist` + `game/server` (sdcard)
**Controls:** Drive/shoot as before; 🌐 rivals in race list + minimap; solo mode unchanged when offline

## PHASE 5 — Backend & Anti-Cheat ✅ DONE — 2026-10-16
**Goal:** Money and gems you can trust, leaderboards, cross-device sync.

- [x] **Accounts + server-side economy:** guest `accountId` (`rk.account.v1`, survives devices via sync code); server owns HP/damage/kills and is the only minter — `server/db.js` (`awardKill $48+18XP`, `awardFinish`, file store mirroring `SUPABASE_SCHEMA.sql`); client applies money ONLY via `AWARD` msgs online — verified: lying `hp:100` input ignored, kill/finish awards arrive from server — 2026-10-16
- [x] **Leaderboard:** `BOARD` → top-10 by XP (`db.json`, `board-data` msg, 🏆 button in lobby) — verified with 3 clients — 2026-10-16
- [x] **Anti-cheat:** server-side speed caps (65.1u/s × 1.3), teleport (>30u) reject + hard `correct`, server-side hit registration (range/state/damage-cap checks, wrecked-target reject), rank validation, input/fire flood rate limits with 3-strike kick — all verified headless — 2026-10-16
- [x] **Cross-device sync:** `backend.js` export/import base64 sync codes (⚙ EXPORT/IMPORT), `supabaseSync` REST stub (no-op until keys set); `SUPABASE_SCHEMA.sql` + `.env.example` for hosted swap — 2026-10-16
- [x] **Deliverable:** production-grade economy shape + global leaderboards — solo stays local-first; online wallets mirror the server ledger — 2026-10-16

**Run server:** `cd server && npm install --no-bin-links && node server.js 8130` (persists `db.json`)

## PHASE 6 — Polish & Live Ops ✅ DONE — 2026-10-16
**Goal:** Retention + style.

- [x] 3 tracks (`tracks.js` roster, ⚙ TRACK switcher, rebuildable `trackGroup`): SUNSET LOOP (balanced), NEON CANYON (tight S-curves), VOLCANO RING (fast ring + chicane) — 2026-10-16
- [x] Seasonal events, daily challenges — deterministic daily (`Daily: race X — finish = +$100`, one claim/day, verified), Season S1 points (every XP feeds it) + 3 gem reward tiers (200/600/1500) with CLAIM button — 2026-10-16
- [x] Ranked seasons with rewards — S1 points + tiers above; leaderboard shows season-contributing XP — 2026-10-16
- [x] Monetization (cosmetics only — never pay-to-win) — 3 new garage skins (INFERNO $380, GLACIER $450, STEALTH $600 → 9 total), visual-only — 2026-10-16
- [x] Analytics, crash reporting, performance budget on low-end phones — `analytics.js` (local event buffer, `window.onerror`/`unhandledrejection`, `POST /api/events` shape), race_start/finish events; perf: pixelRatio ≤1.25 on small/≤4-core screens, ACES tone mapping, ~615 KB bundle — 2026-10-16
- [x] Graphics pass — starfield (400 pts) + low sun + glow, road edge glow lines (gold/cyan), per-car underglow rings synced to skins, wreck tilt + damage smoke, explosions (flash/core/ring/14–20 debris), screen shake, hit vignette — 2026-10-16

**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (615 KB `index-CdoCABa6.js`) → copied to `game/dist` + `game/server` (sdcard)

---

## PROMPT 1 diagnostics (answered 2026-10-16, no code changed)

Recorded here so Phase 7+ continues from fact, not rebuild.

- Landscape vs portrait: no orientation logic exists. Only `resize` handler (`main.js:1419`) stretches renderer/camera. No rotate prompt. Touch controls (`#controls` ◀ ▶ ▲ ▼ + BOOST/FIRE) show on narrow screens, hidden via `@media(min-width:700px)` on desktop. HUD is fixed-position DOM — cramped/unanchored in portrait, minimap + controls overlap on phones.
- Frame rate / draw calls on this phone: NOT measured — no FPS meter, no `renderer.info` logging in code. Fixed 60 Hz sim tick (`FIXED=1/60`, `main.js`) decoupled from rAF render. Static estimate only: ~200+ draw calls (6 cars × ~11 meshes + ~115 track/scenery + ~30 pickups + projectiles/effects). Real numbers require running on-device with a HUD counter (planned in Phase 7).
- Cars now: procedural boxes only — `BoxGeometry` body + cabin + nose + 4 `CylinderGeometry` wheels + cone boost flame (`main.js:343-354`), `MeshLambertMaterial` flat colors, fake blob shadow (`CircleGeometry` black 0.35), `RingGeometry` underglow, wireframe shield bubble. No PBR, no reflections, no real shadows, no wheels steering animation.
- Road now: flat `BufferGeometry` ribbon 22u wide, 220-sample Catmull-Rom, `MeshLambertMaterial` #2a2a33, white center dashes (planes every ~12 samples), gold/cyan edge-glow `Line`s, red/blue vertical wall ribbons, checkered canvas start plane + yellow gantry box, 90 random box trees/blocks scenery. Single lane each way visually, no lane markings, curbs, rails, lights, buildings, hills/bridges/tunnels.
- Bundle: `game/dist/assets/index-CdoCABa6.js` = 614,538 bytes (~615 KB, gzip ~150 KB per Phase 2-6 logs) + `index.html` 18 KB + manifest/sw/icons. No textures/sounds shipped.

---

## PHASE 7 — Premium Look and Controls ✅ DONE — 2026-10-16
**Goal:** High quality by default, simpler mode only for weak devices. Landscape-first.

- [x] Landscape-first layout + rotate prompt in portrait (`index.html` `#rotatePrompt`, `updateOrientation()`; landscape HUD compaction, portrait minimap/controls reflow; non-blocking, phone/tablet/desktop)
- [x] Realistic road: 4 lanes (double-yellow center, dashed white dividers at ±5.5u), solid edge lines, shoulders, red/white curbs, guardrail posts + rails, sidewalks, intersection cross-road + stop line at start, bridge overpass (1/3), tunnel arches (2/3), street lights every 18 samples, 26 window-lit buildings, 60 trees, 10 hills (`buildStrip`, `makeAsphaltTexture`, `makeWindowTexture`)
- [x] Day/dusk/night cycle + wet-road shine (`applyTimeOfDay`, TOD button + ⚙ select, AUTO cycle; Standard-material roughness/metalness shift for wet shine)
- [x] Quality: HIGH default (Standard PBR-ish materials, PCFSoft shadows, pixelRatio ≤2, player spotlight, shadow frustum follows player); SIMPLE fallback (Lambert, no shadows, pixelRatio ≤1.25, auto-selected on small + ≤4-core unless user overrides in ⚙)
- [x] Controls: JUMP button + `C`/`K` (jump physics vy/gravity in `updateCar`), CAM button + `V` (CHASE/HOOD/FAR), TOD button + `T`, full gamepad (`pollGamepad`: stick steer, RT/LT gas/brake, A jump, RB fire, LB boost, Y camera); front wheels steer, brake bar glows, headlight quads + night spotlight
- [x] FPS + draw-call HUD (`#perfHUD`: FPS EMA, `renderer.info` calls/tris, quality flag)
- [x] **Deliverable:** same 3 tracks + same solo/online modes, premium render, landscape phone/tablet/desktop

**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (629 KB `index-mftlyvwk.js`, gzip 164 KB; was 615 KB) → copied to `game/dist` (sdcard)
**Look-gap (honest):** procedural canvas textures (no real asphalt/building textures); no image-based lighting/env reflections — car "reflections" are just specular highlights; one shadow light only; street lamps are emissive fakes (2 real lights max); no skidmarks, weather particles, or cockpit view; tunnel/bridge are visual shells (no height change); guardrail ribbon is flat.
**Controls:** GAS ▲ / BRAKE ▼ / ◀ ▶ steer, BOOST, FIRE, JUMP, CAM, TOD · keyboard WASD/arrows + Space boost + J/X fire + C jump + V camera + T time · gamepad supported

## PHASE 8 — Race Rules and Resources ✅ DONE — 2026-10-16
**Goal:** 6 cars, fuel + ammo management, roadblocks, gradual damage, provable balance.

- [x] 6 vehicles on road, humans or bots, solo still possible (unchanged roster; `c.out` freezes parked cars, progress frozen, rank drops)
- [x] Fixed starting fuel 60 + finite mounted MG reserve 150/round (`src/rules.js` pure: drains base 0.55 + throttle 0.45 + boost 2.3/s; `perfFactor` smooth speed/accel/handling with crawl floor; combat.js `mounted` + `mountedCd` + `activeGun`, pickup weapons take precedence)
- [x] Roadblocks ×14/track, deterministic layout (`genRoadblocks` seeded): CONE 20hp jumpable, BARRIER 45hp jumpable, ARMORED 120hp heavy (costs ammo), TIRE WALL indestructible steer-around; MG 8/round vs 120hp = 15 rounds for armored; ram damage + slow; respawn 20s; bots steer around, player can jump cones/barriers
- [x] Gradual damage: perf scales with fuel × hp, min crawl ~0.18×42 ≈ 8 u/s; wreck revive max 3× at 1/5/30 gems, then OUT → SPECTATE leader or RESTART (`#outOverlay`, `#spectateBadge`)
- [x] Fuel/ammo bonus pickups ⛽ +20 / 📦 +60 mounted (still expiring, 8–10s respawn); +16 fuel per lap pit bonus; revive grants 45 fuel + 120 mounted
- [x] Headless sim `sim/sim_phase8.mjs` (seeded, deterministic) — ALL PASS, results in `sim/phase8_results.txt`:
- [x] **Deliverable:** balanced ruleset + sim report (table below)

| Track (~1900–2000u, 3 laps) | careful | normal | wasteful (boost spam) | careless |
|---|---|---|---|---|
| sunset | finish 79s, fuel 95 | finish 106s, fuel 49 | dry @31s | out @47s |
| canyon | finish 80s, fuel 96 | finish ~110s, fuel ~57 | dry @29s | out @43s |
| volcano | finish 83s, fuel 88 | finish ~115s, fuel ~56 | dry @31s | out @40s |

Careful (no blocks, 1 can/lap) always finishes with margin; normal (6 block hits, cans) finishes battered (hp ~9–15, expect gem revives); boost-spammer runs dry lap 1; ram-everything wrecks/dries out. Ammo audit: need ≤54 rounds vs 150 + 📦 refills — always sufficient.

**Build:** `~/roadkill-build/dist` rebuilt 2026-10-16 (637 KB `index-BbzJDJ66.js`, gzip 167 KB) → copied to `game/dist` (sdcard)
**Limits (honest):** fuel/ammo/blocks are client-side in online mode (server owns nothing new until Phase 12); remote ghosts ignore blocks; bot fuel uses same rules; mine-vs-block not modeled (mines are anti-car).
**Controls add:** `C` JUMP now also clears cones/barriers; ⛽/📦 drive-over; spectate auto-cams leader.

## PHASE 9 — Vehicles and Arsenal ✅ DONE — 2026-10-16
**Goal:** Procedural vehicle generator + glTF loader, classes, upgrades, sci-fi weapons, server-checked shop.

- [x] 12 original vehicles, 5 classes (no logos/real names): SUPER Falcon S (free) / Vortex GT / Monarch · SCI-FI Nebula Ray / Pulsar X · WAR Bulwark / Marauder / Jackal Runner · TANK Tortoise H / Rhino Siege · CRAZY Rocket Trike / Doom Kart — each with own top/accel/handling/hp/fuel/fuelUse/look/slots (`shop-config.json`, `src/vehicles.js`)
- [x] Procedural generator in code (`buildChassis`: wedge, saucer, gun-truck, tracked turret, trike, kart) + glTF loader kept (dynamic `three/addons` import, lazy 45 KB chunk, `public/models/<id>.glb` + `spec.model`, procedural fallback)
- [x] Upgrades: engine/armor/tank/suspension ×3 levels each, per-vehicle, escalating gold→gems
- [x] Mount slots 1–2 per vehicle; sci-fi weapons with own effect + sound hook + ammo rule: ☄️ PLASMA (splash), 🔹 RAILGUN (55 dmg slug), ⚡ EMP (3s no-fire/no-boost), 🐝 SWARM (5 homing); synth SFX now (`src/sound.js`), drop real files in `public/sounds/` later
- [x] Shop (gold + gems, every item has free/paid flag in `shop-config.json`): RIDES / UPGRADES / WEAPONS / PAINT tabs; solo = local check; online = server decides (`BUY`/`BUY_OK`, `server/db.js buyItem`, inventory sync via `ACCOUNT`)
- [x] Sim `sim/sim_phase9.mjs` — ALL 12 vehicles finish ALL tracks careful-style; DPS: MG 87 / rocket 71 / plasma 65+splash / swarm 67 homing / railgun 50 / emp utility; buy-everything = $8,230 + 225 gems, 8 free entries
- [x] **Deliverable:** garage v2 + arsenal + shop config + server-checked purchases

**Build:** 694 KB `index-BkE7y_QZ.js` (+45 KB lazy GLTF chunk) → `game/dist` (sdcard)
**Limits (honest):** generator is box-primitive art (no sculpted bodies without glTF models); EMP has no visual on victim beyond ring+icon; shield/mine stay pickup-only; bot loadouts are mg (+40% rocket on 2-slots).
**Controls add:** `Q` / tap weapon card / gamepad X = switch mount slot.
**Supply list:** `public/models/*.glb` vehicle models + `public/sounds/*.mp3` (hook names in `sound.js SOUND_HOOKS`) — optional, game is fully procedural without them.

## PHASE 10 — Map Features ✅ DONE — 2026-10-16
**Goal:** Interactive tracks.

- [x] Crash gates (tall striped doors, 12hp — always ram-breakable at speed, 2 MG rounds) + jumpable cones/barriers; ramps (2/track, vy=11, ~0.9s air, clears low blocks)
- [x] 1 shortcut/cut per track (12–24% shorter: sunset 12%, canyon 22%, volcano 24%) with tire funnels, chevron signs, hidden ⛽+📦 cache, first-use +$10 SECRET CUT bonus (solo); wall-clamp exempt in corridor; checkpoints tolerate skips ≤4 with wrap = lap (`advanceCheckpoint` in rules.js)
- [x] 3 hazards per track: oil slicks (55% handling, slippery) + debris fields (6/s, ~2.4 dmg drive-through); bots steer around both
- [x] Sim `sim/sim_phase10.mjs` — 8 checkpoint unit tests + savings + tuning audits ALL PASS; Phase 8/9 sims re-run green
- [x] **Deliverable:** all 3 tracks have barriers + secrets + hazards (+ minimap icons)

**Build:** 701 KB `index-DC-yFzWb.js` → `game/dist` (sdcard)
**Limits (honest):** shortcuts are flat chords (no elevation); bots don't take shortcuts (waypoints stay main road); chevron art is canvas-procedural.

## PHASE 11 — Banners ✅ DONE — 2026-10-16
**Goal:** Brand banners + people-picture banners, config-driven, 24h server stats, admin-ready.

- [x] 6 solid brand billboards (2/track, collision push, cannot be bumped/moved) + 9 people portraits (3/track, bump → wobble + counted, ♥ LIKE button within 12u) — all from `banners-config.json` (images + track positions); procedural placeholder boards, `./banners/*.png` auto-loaded when supplied
- [x] Views auto-counted <30u (once/race/banner); offline events queue (`rk.banners.queue`) and flush on connect + every 10s
- [x] Server keeps 24h only (`recordBanner`/`bannerSummary`, like = 1/account/banner/day, per-event rate limits); admin API on game port: `GET /api/banners/summary`, `/api/banners/raw?windowH=`, `/api/config/banners`, `/api/health` (+ optional `ADMIN_KEY`, CORS open, verified live)
- [x] Sim `sim/sim_phase11.mjs` — events, dup-like reject, unknown reject, pruning, per-track counts ALL PASS; Phase 8/9/10 sims re-green
- [x] **Deliverable:** in-track banners + `banners-config.json` + 24h endpoints (no admin UI — separate project)

**Build:** 707 KB `index-BCxp-NNI.js` → `game/dist` (sdcard)
**Limits (honest):** placeholder art until real images supplied; likes need a tap (no gaze tracking); stats are per-server-file (resets on hosted DB swap until Phase 12).
**Supply list:** `game/public/banners/*.png` (6 brand + 9 people files named in config).

## PHASE 12 — Online Launch ✅ DONE — 2026-10-16
**Goal:** Online-only economy, real DB, hosted wss, payments plan.

- [x] Server owns money/gems (only minter), shop (`BUY` validated), gem revives (`REVIVE` 1/5/30 ladder per race, then wrecked-out), ammo ledger per weapon (raceAmmo ×2 headroom, unknown weapons rejected), fuel clamp, hit registration, finish ranks, banner 24h stats
- [x] Practice mode: solo bot grid + server session (account, awards, shop, banners) — ONLINE → PRACTICE; offline airplane solo kept as fallback
- [x] wss: auto-upgrade on https pages; one-port ws + `/api/*`; `ADMIN_KEY` gate; Postgres write-through (`server/pgmirror.js`, `DATABASE_URL`, file fallback); `SUPABASE_SCHEMA.sql` migrated (inventory, banners)
- [x] Payments plan in `DEPLOY.md` (provider → webhook → server-credited gems; cosmetics only) — not built, as ordered
- [x] Sim `sim/sim_phase12.mjs` — boots real server, 15/15 checks: practice isolation, ammo cap, revive ladder 1/5, hit wrecks, banners, admin API ALL PASS; db.json untouched (backup/restore)
- [x] **Deliverable:** launch-ready online build + `DEPLOY.md` ops notes

**Build:** 708 KB `index-BapQhkIB.js` → `game/dist` (sdcard)
**Run server:** `cd server && npm install --no-bin-links && node server.js 8130` (+ `DATABASE_URL`, `ADMIN_KEY` on hosts)
**Limits (honest):** ammo ledger allows ×2 headroom (full pickup authority = later); matches/banner raw events stay file-only (accounts mirror to PG); no TLS locally (host terminates); payments are plan-only.

**Rule:** game only. No admin UI in this repo (separate project later). Update this file as each phase lands; build one phase at a time, asking before moving on.

---

## Hosting plan (when we get there)

| Piece | Service | Cost |
|---|---|---|
| Game (PWA) | Vercel / Netlify | Free |
| Multiplayer server | Render / Fly.io / Railway | Free tier |
| Database | Supabase | Free |
| Car skins / media | Cloudinary | Free |

**$0/month** until real player volume.

## Tech stack
- **Client:** Vite, Three.js, custom arcade physics, IndexedDB + LocalStorage
- **Server (Phase 4+):** Node.js + WebSockets
- **DB (Phase 5):** Supabase (Postgres) + Upstash (Redis)

## Rule of thumb
Phases 0–3 = **one game, fully playable offline.** Phases 4–6 = make it *social*.
Nothing in 4–6 breaks 0–3: the bots version stays as practice/solo mode forever.

---

## PROMPT 2 diagnostics (read 2026-10-16, no code changed)

Read ROADMAP.md + GAME.md + handoff.md. State of the world going into Phases 13–15:

- Solo offline + local wallet exist (Phases 0–3, IndexedDB/LocalStorage). Phase 13 removes them — biggest cut: offline PWA/airplane mode and the `rk.profile.v2` local wallet go away; practice/missions stay but connected.
- Server address is a paste box (`netServer` input, `defaultServerURL()`). Phase 13 bakes it in (build-time constant + same-host fallback).
- Identity today = self-chosen username (`netName`, `HELLO {name}`). Phase 13 replaces with server-generated tags (e.g. `RK-7F3K`); roster/race-list/car-card must show tags, bots get 🤖 + per-bot colors.
- Matchmaking today = instant fill-or-new-room. Phase 13 adds: 15 s wait → backfill bots to 6; private rooms: host + invite link (`?room=CODE` auto-join lobby), start at 6 or host early-start, bots only if host opts in.
- Economy today = money ($-signs) + gems; shop mixes gold/gems. Phase 14 renames money → **coins**, adds **gold** (rare, feat-earned: wreck premium-vehicle owner, 3× same victim), gold buys limited cosmetic skins only (~200/500), vehicles/upgrades stay coin-priced; gold packs (20/₦500, 45/₦1,000, 100/₦2,000) in config, unwired, free while testing; handoff $/pay-to-win wording fixed. Banners already owner-only (config-driven) — Phase 14 keeps + enforces it.
- Visuals are procedural box-primitive (honest gaps logged in Phases 7/9). Phase 15 pushes code-only look max, then names real assets to buy.

---

## PHASE 13 — Online-Only Rework ✅ DONE — 2026-10-16
**Goal:** Online-only game. No offline solo, no local wallet; connected practice/missions stay.

- [x] Online-only: TAP connects (baked `wss://roadkill-server.onrender.com` + `?server=` override + last-good memory); no offline solo, no local wallet (server ACCOUNT is truth, token/finish awards only)
- [x] Practice kept connected (instant start, full bot grid, server wallet); mid-race drops pause → BACK TO LOBBY
- [x] Quick Match: 15 s gather → auto-start, bots backfill to 6; private rooms: host + `?room=CODE` invite link auto-join lobby, start at 6 or host early-start, bots only if host opts in
- [x] Server tags (`RK-XXXX`, stable per account) on roster/race-list/killfeed; bots = 🤖 in per-bot colors; usernames + server box removed
- [x] Sim `sim/sim_phase13.mjs` — 18/18: tags, wait, backfill 2+4, private, host no-bots, token cap ALL PASS; Phase 12 re-green
- [x] **Deliverable:** online-only build + lobby flow

**Build:** 711 KB `index-C9T2KKPN.js` → `game/dist` (sdcard)
**Limits (honest):** local bots still simulate per-client (diverge across screens); daily/season bonuses still local (move server-side in Phase 14); skins stay local-visual until the gold shop (Phase 14).

---

## PHASE 16 — Phone Experience Fix (PROMPT 3) ✅ STEP 1 DONE — 2026-10-17
**Goal:** the deployed game must actually play on a real phone — not static, not scattered, not stuck in portrait. Phase 14 paused for this.

### Root causes of the “static scattered screen” (found & fixed)
1. **Module crashed at boot** → render loop never ran → static canvas with HUD scattered on top. World-building calls (`buildTrack/placeCars/spawnPickups`) ran mid-file before their state arrays existed. Fix: `bootWorld()` runs after all declarations (`src/main.js`, `window.__rkBooted` flag).
2. **Duplicate `const rotatePrompt`** — a syntax error that killed the whole bundle on some loads. Fixed; served bundle passes `node --check`.
3. **“TAP TO CONNECT” swallowed the tap** — the title div (`pointer-events:auto`) covered the canvas, so the canvas click handler never fired → tapping did nothing. Fix: one document-level tap handler (skips buttons/panels) — first tap = fullscreen + landscape lock, then connect + quick match.
4. **WebGL failure killed the page** — `new THREE.WebGLRenderer()` threw and nothing rendered. Now caught: clear “3D NOT SUPPORTED” banner, DOM HUD keeps working, `__rkBootError` recorded.
5. **Connection states invisible** — a failed connect fired `onDisconnect` → `setOnlineMode(false)` wiped the CONNECTING/WAKING/FAILED overlay instantly. Now the overlay owns the UI during connect attempts.

### Built
- [x] First tap → `requestFullscreen` + `screen.orientation.lock('landscape')` where allowed
- [x] Manifest: `display: fullscreen` + `orientation: landscape` (installed app opens landscape fullscreen)
- [x] Portrait on phones/small tablets → full-screen ROTATE YOUR PHONE prompt, game auto-pauses, resumes on rotate back
- [x] Dynamic viewport height (`--vh`) + safe-area insets (`--sat/--sab/--sal/--sar`) + whole-HUD `--hudscale` (0.62–1.0) — nothing cut off on notched phones
- [x] Connection states: CONNECTING → SERVER WAKING UP (60 s countdown after 4 s) → CONNECTION FAILED + RETRY button (all verified headless)
- [x] Hidden debug panel — tap top-left corner 3×: screen size/DPR, orientation, viewport, fullscreen, WebGL, fps/tris/calls, quality, server+rtt, boot, HUD scale
- [x] Headless test harness: `sim/phone-test.mjs` (fresh Chromium per size — software-GL contexts leak on ARM headless), `sim/visual-check5.mjs`, `sim/debug-panel-check.mjs`

### Verified (headless Chromium + SwiftShader WebGL)
| Size | Booted | HUD overflow | Rotate prompt | FPS (software GL) |
|---|---|---|---|---|
| 844×390 landscape | ✓ | none | hidden | 51 |
| 390×844 portrait | ✓ | none | **shown** | 49 |
| 800×360 landscape | ✓ | none | hidden | 59 |
| 360×800 portrait | ✓ | none | **shown** | 53 |
| 1280×800 tablet | ✓ | none | hidden | 58 |

Screenshots + `phone-test-report.json` → `/sdcard/Road kill/screenshots/`.
Live prod server sanity: baked `wss://roadkill-server.onrender.com` answered in ~1 s, room joined ("Room V6GZ — 1/6 racers").

**Build:** 717 KB `index-CO1j2LhU.js` → `game/dist` (sdcard)
**Next:** Step 2 HUD redesign (round minimap + district, speedometer + gear, score/combo, banner, coins/menu, chase cam + racing line) — awaiting go-ahead.

## TAKEOVER STEP 1 — Start/race split + landscape HUD ✅ DONE — 2026-10-17
**Goal:** one screen for the menu, a different screen for racing; a thumb-first landscape HUD; the renamed art actually wired in; every listed defect fixed.

### Screens (the old build mixed both)
- `body.racing` gates the two screens. **Start screen** = logo + Play / Practice / Host Private / Garage / Settings / Install, economy row, **no race HUD at all**. **Race HUD** mounts only once a race starts.
- Global chrome (`connOverlay`, `rotatePrompt`, `center-msg`, `debugPanel`, `coinsPop`) moved **outside** `#hud` so the connection overlay is still reachable from the menu — inside `#hud` it would have been `display:none` on the start screen.

### Race HUD zones (was: buttons in a dock across the bottom-centre)
| Zone | Contents |
|---|---|
| top-left | round minimap (live canvas under the art ring) + health / fuel / weapon+ammo bars beneath |
| top-center | location + lap banner **only** |
| top-right | position of six, coins, camera, time-of-day, pause (+ FPS, + collapsible race-order tag) |
| bottom-left | steer left / steer right pads |
| bottom-right | gas + brake, with fire / boost / jump in an arc above and weapon-swap alongside |
| bottom-center | round speedometer: sweeping needle, KM/H digits, gear letter, between the thumbs |
| centre | kept clear |

### Art (60 renamed PNGs → 19 wired in for Step 1)
`tools/hud-art.py` reads the **originals** from the SD card and writes downscaled, palette-quantised copies to `public/art/`. **16.5 MB → 207 KB.**
- Backgrounds removed by **border-connected flood fill**, not a colour key — these are glow-on-black assets whose button faces are themselves near-black, so keying all black would punch holes in the buttons. A **second flood from the centre** opens the enclosed disc in `minimap-frame` / `speedometer` so the live canvas shows through. `logo` / `speedo-needle` use a luminance ramp so glow feathers out instead of ending on a hard edge.
- Threshold is adaptive (most aggressive first) and every file is **verified** (corners transparent, centre opaque/hole) — it fails loudly rather than ship a hole.

### Defects fixed
1. **Start menu and race HUD mixed** → two screens, gated by `body.racing`.
2. **Touch buttons in an unreachable row across the bottom-centre** → zone layout, thumb-anchored.
3. **Minimap in the bottom-right** → top-left, round, with status bars beneath.
4. **“Broken image” icon over the lap counter** → it was **never a DOM element**. Hiding `#topbar` left it; hiding the canvas removed it. It is Chromium's marker for a dead/uncomposited `<canvas>` — i.e. the *same* root cause as the blank world, not a second bug.
5. **Top bar crammed, hid the speed number** → the single `#topbar` is gone; speed lives on the dial, lap on the banner, position top-right.
6. **Right-hand bars overlapping the frame-rate box** → `#healthbar`/`#fuelbar`/`#perfHUD` all sat at `right:12px`; bars moved to the left column, FPS top-right row 2.
7. **Centre subtitle unreadable on a light backdrop** → `#center-msg` now sits on an opaque dark scrim panel.
8. **Blank world behind the interface** → two causes, both real, see below.
9. **Lobby cut off at the bottom** → overlay cards capped at `max-height:94vh` + scroll.
10. **Four connection states looked identical** → each state now owns a colour, backdrop, icon and its own chrome: **CONNECTING** (cyan, spinner) / **WAKING** (amber, big countdown + draining bar, no spinner) / **FAILED** (red, ⚠️, RETRY NOW) / **RETRY** (green, faster spinner, attempt counter).

### Real bugs found and fixed along the way
- **No `webglcontextlost` handler.** Without `preventDefault()` the browser never hands the context back, so one GPU hiccup blanked the world *permanently*. Now paused, bannered, and restored automatically.
- **The “3D NOT SUPPORTED” fallback never worked.** It stubbed the renderer but omitted `shadowMap`, so the very next line threw and killed the whole module — the page it promised to protect still died. Stub now covers every property `main.js` touches. *(Found because the tablet shot refused to boot.)*
- **`updateCamera()` never ran before a race**, so the menu sat on the default `(0,18,38)` camera looking down −Z with the headlight unaimed. The menu now runs a slow cinematic orbit around the player's car.
- **Double-firing touch controls.** `camBtn`/`todBtn`/`fireBtn` listened to both `touchstart` *and* `click`, so one tap on a phone fired twice. All pads now use pointer events + `setPointerCapture` (also gives real multi-touch: steer + gas + fire at once, and holds survive sliding off the pad).
- **GPU memory**: `antialias` now follows quality, pixel-ratio capped at 1.5, `stencil:false` — an unclamped 2× buffer + 4× MSAA on a 3×-DPR phone is the usual cause of mid-race context loss.

### Settings added
Left-handed steering (`swapSteer` — mirrors the pad zones) and auto-accelerate (`autoAccel` — full throttle unless braking). Both persisted via `createDefaultSettings()`.

### Verified — `sim/step1-shots.mjs`
| Size | overflow | centre clear | thumb reach | zone overlaps |
|---|---|---|---|---|
| 844×390 | none | OK | OK | **none** |
| 800×360 | none | OK | OK | **none** |
| 1280×800 | none | OK | OK | **none** |

Connection states: **4/4 distinct** (different backdrop, border, icon, title colour, and chrome) — measured, not eyeballed. Screenshots → `/sdcard/Road kill/screenshots/step1/`.

> **Honest limitation.** This Termux headless Chromium **cannot composite WebGL canvases at all** — a control page that just clears a raw WebGL canvas to red also screenshots pure white, with `isContextLost() === false`. So the 3D area in these screenshots shows the new **CSS world backdrop** (the canvas is hidden in the harness), not the rendered world. This is a screenshot-tool limitation, not the app: at 1280×800 SwiftShader cannot even allocate a context, which is why the app's own fallback banner was exercised there. **The rendered world still needs checking on a real phone.**

**Next:** Step 2 — awaiting go-ahead.

## TAKEOVER STEP 1b — No emoji anywhere, real icons only ✅ DONE — 2026-10-17

**Request:** *"I don't want to see emojis on any part of the game, use real icons."*

### Why SVG and not a second PNG set
An emoji is a **font**, not an image: `U+1F48E` is a different drawing on Android, iOS, Windows
and Linux, and on a bare Linux box it is a tofu box. So the fix is a hand-built icon set that
needs no font at all and stays crisp at any pixel ratio.

- **`tools/build-icons.py`** owns the **36 icon definitions** and rewrites the sprite block between
  `ICONS:START` / `ICONS:END` markers in `index.html` — edit the script, not the markup. It then
  **audits every reference**: literal `<use href="#i-…">`, `icon('…')` calls in JS, and
  `icon:'…'` values in `combat.js` (which are only reachable through `icon(def.icon)`).
  A typo fails the build instead of rendering a blank icon. **Result: all 36 icons referenced,
  47 call sites, zero unresolved.**
- Set: heart, gems, coins, money, fuel, ammo, question, check, close, target, sun/moon/dusk,
  spinner/auto/zzz/warn, eye, phone, lock, trophy, calendar, person, star, bot, flag, skull, bolt
  + the eight weapons (rocket, gun, mine, shield, plasma, railgun, emp, swarm).
- **`src/icons.js`** — `icon(name, cls)` returns the markup, `esc()` escapes player tags. `esc()`
  matters because showing an icon forced several `textContent` calls to become `innerHTML`, and
  those strings interpolate **player-supplied** tags/names/ids.
- **76 conversion sites:** `index.html` 19, `src/main.js` 44, `src/combat.js` 8, `src/vehicles.js` 1.

### Two real defects the emoji had been hiding
1. **The HUD never set a CSS `color`.** `html,body` set a dark background but no colour, so every
   element that never declared one inherited the UA default **black** — invisible on the dark
   panels (`#todBtn`'s moon, the whole weapon row). The emoji ignored `color`, so this had never
   shown. Fixed at the root with `color:#eef4ff` on `html,body`.
2. **A local `const icon = …` in the race-order block would have shadowed the imported helper.**
   Renamed to `ic`.

### Verification — `sim/no-emoji-check.mjs`
Scans **10 screens** (start menu, race HUD expanded + collapsed, all four connection states,
settings, garage, lobby) for three things: emoji in any *visible* text node; `<use>` whose
symbol is missing or zero-sized; and icons whose computed `color` is too dark to see against
these dark surfaces.

**Result: 0 emoji, 0 broken, 0 invisible icons, 0 app console errors.** Plus `vite build` passes
and `tools/build-icons.py` reports all 36 resolving. Repo-wide scan of `index.html` + `src/*.js`
— including comments — is now **0 emoji**.

> Harness note: two "bugs" turned out to be my own measurement, not the game — a `grep -v WebGL`
> was hiding the debug-panel line (its content contains `WEBGL`), and the white minimap / stuck
> `-- FPS` in screenshots was the script shooting **before boot finished** (SwiftShader shader
> compile takes ~4s and `requestAnimationFrame` only registers afterwards). The harness now waits
> on `__rkBooted && __rkFrames > 30`, and `#minimap canvas` gained a CSS `#0a0f18` base so a
> not-yet-drawn minimap can never flash the canvas behind it.

**Next:** Step 2 — awaiting go-ahead.

## PHASE 14 — Premium Economy ⏸ PAUSED (Prompt 3 orders Phase 16 first)
Work stopped mid-build (coins rename done in working tree, gold feats/shop not built). Resume after Prompt 3 Steps 1–3.
**Goal:** Coins for grinders, gold for feats. Cosmetics-only premium.

- [ ] Rename money → coins everywhere (code, UI, docs); gold = rare premium currency
- [ ] Gold earned only via hard feats (wreck a premium-vehicle owner; wreck the same player 3× in one race)
- [ ] Gold buys limited cosmetic skins only (~200 / ~500 gold); vehicles + stat upgrades = coins only
- [ ] Gold packs in config (20/₦500, 45/₦1,000, 100/₦2,000), unwired, everything free while testing
- [ ] Fix handoff.md pay-to-win claim + dollar signs; banners stay owner-only (server config, one change → all players, no uploads)
- [ ] **Deliverable:** coins/gold economy live + docs corrected

## PHASE 15 — Visual Upgrade ⬜ PLANNED (PROMPT 2)
**Goal:** Code-only premium look, then an honest buy list.

- [ ] Push cars, road, effects as far as code can go
- [ ] Honest report: what still looks weak + which real models/textures to buy
- [ ] Reminder: make the GitHub repo private before launch
- [ ] Risks list; ROADMAP.md updated; report with files changed + how to run
- [ ] **Deliverable:** best-possible procedural visuals + asset buy list

**Rule:** game only. No admin UI in this repo (separate project later). Update this file as each phase lands; build one phase at a time, asking before moving on.
