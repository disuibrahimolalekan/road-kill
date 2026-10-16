# ROAD KILL — Combat Racer: The Complete Guide

> High-octane 3D arcade combat racer. Twisted Metal × Mario Kart energy.
> A Progressive Web App (PWA): plays in the browser, installs to the phone, works offline solo — and races up to **6 real humans** per lobby online.

All 7 phases (0–6) are built, verified, and shipped. Solo bots mode is fully playable in airplane mode; online mode adds real multiplayer with an authoritative server.

---

## 1. How to run

| What | Command |
|---|---|
| Solo / dev (game only) | `cd game && npm install --no-bin-links && npx vite --host 0.0.0.0` → http://localhost:5173 |
| Multiplayer server | `cd game/server && npm install --no-bin-links && node server.js 8130` |
| Online race | Start server, open game → **ONLINE** → QUICK MATCH (server URL defaults to same host `:8130`) |
| Install on phone | Open the hosted URL → **INSTALL** (or Add to Home Screen) → airplane mode still plays solo |
| Prebuilt | `game/dist/` (708 KB JS Phase 12 + 45 KB lazy glTF) + `manifest.webmanifest` + `sw.js` + icons |

Stack: Vite 8.3, Three.js 0.186, Node `ws` server, IndexedDB + LocalStorage client store, `db.json` server store (Supabase-ready schema in `server/SUPABASE_SCHEMA.sql`).

## 2. Controls

| Input | Action |
|---|---|
| W / ↑, S / ↓, A / D, ← → | Accelerate, brake, steer (touch: ◀ ▲ ▼ ▶) |
| Space / Shift / BOOST | Boost (1.55×, 2.4 s) |
| J / X / Enter / FIRE | Shoot (hold FIRE for M-Gun auto-fire) |
| C / K / JUMP | Jump (hop barriers) |
| Q / tap weapon card | Switch mounted weapon slot |
| V / CAM | Camera: CHASE → HOOD → FAR |
| T / TOD button | Time of day: night → dusk → day → auto |
| Gamepad | Left stick steer, RT/LT gas/brake, A jump, RB fire, LB boost, Y camera |
| P / Esc | Pause · GARAGE, ⚙ settings, ONLINE in HUD bar |

## 3. Modes

- **Solo (bots, offline-first).** You + 5 AI drivers (waypoint racing, rubber-banding, pickup seeking, LOS combat, dodging, mine drops). Full combat + economy loop. Works with zero internet.
- **Online (up to 6 humans).** Bots hide; up to 5 ghost rivals stream in at 20 Hz with interpolation. Your car stays instant (client prediction) and the server correctscheats. Kills, finishes, and wallets are server-awarded. Room codes (e.g. `Z2XF`) for private lobbies; quick match fills the first room with space.
- **Practice (bots + server).** ONLINE → PRACTICE: full bot grid, but account, wallet, awards, shop and banners stay server-backed. Server owns gems (revives 1/5/30 per race), ammo ledger, fuel clamp, purchases.

## 4. Tracks (3)

Switch anytime in ⚙ → TRACK (rebuilds road, walls, checkpoints, pickups, minimap).

| Track | Character |
|---|---|
| **SUNSET LOOP** | Balanced club circuit, the original 10-point loop |
| **NEON CANYON** | Tight S-curves, late-braking battles |
| **VOLCANO RING** | Fast outer ring with a chicane |

All are 220-sample Catmull-Rom ribbons, 22 u wide, walled, 14 checkpoints, 3 laps, finish gantry.

## 5. Cars & physics

Arcade hover-car model at a fixed 60 Hz tick: acceleration 58, brake 78, drag, lateral-friction drift, steer authority that fades with speed, boost flame + FOV kick from the chase cam. Speed cap **42 u/s** (65.1 boosted) — enforced client-side *and* server-side (×1.3 tolerance, teleports >30 u rejected with a hard correction).

## 6. Combat & weapons

100 HP per car. Wall hits (4–18 by speed) and car contact hurt. Wreck = explosion + kill feed + money tokens. Pickups (10 on track, respawn 8–10 s) grant **one expiring loadout** — no hoarding. Every car also carries a **mounted M-Gun (150 rounds, non-expiring)** and **60 fuel**; ⛽ cans (+20) and 📦 ammo (+60) pickups are bonus extras that still expire. +16 fuel per lap. Fuel/damage degrade speed, accel, handling gradually to a crawl floor; dry or 4th wreck = out (spectate or restart).

| Weapon | Ammo | Damage | Countdown |
|---|---|---|---|
| 🚀 Rocket | 5 | 34 | 12 s |
| 🔫 M-Gun | 70 | 8/round | 10 s |
| 💣 Mine | 3 | 54 area | 14 s |
| 🛡️ Shield | — | invuln 5.2 s | 5 s |

Feedback: explosions (flash + core + ring + 14–20 debris), hit sparks, screen shake, red vignette, damage smoke, shield bubbles, kill feed.

## 7. Economy, levels, skins

- **Money tokens:** every wreck drops 4 × $12 ($48). Drive over to collect — bots steal them too.
- **Tiered revive:** wreck 1 → **1 gem**, wreck 2 → **5 gems**, wreck 3 → **30 gems**, then permanent wreck. Bots get 3 free auto-revives.
- **Wallets:** money + gems persist in IndexedDB (migrated from LocalStorage once) and mirror the server ledger online. Start: $80 + 14 gems.
- **XP → header levels → tiers:**

| Level | Tier |
|---|---|
| 1–5 | Bronze |
| 6–10 | Silver |
| 11–16 | Gold |
| 17–22 | Platinum |
| 23–30 | Diamond |
| 31+ | Master |

Kills +18 XP; finishes +120 / 80 / 52 / 32 / 18 / 10 XP (P1–P6) plus $48 / 28 / 14 / 6.
- **Garage (9 skins, visual only — never pay-to-win):**

| Skin | Price |
|---|---|
| STOCK RED | free |
| FROST BLUE | $150 |
| TOXIC GREEN | $200 |
| MIDNIGHT | $260 |
| NEON VIOLET | $320 |
| INFERNO | $380 |
| GLACIER | $450 |
| GOLD CHROME | $520 |
| STEALTH | $600 |

Equipped skin repaints body + underglow and follows you across devices via sync code.

## 8. Live ops (Phase 6)

- **Daily challenge:** deterministic per date (`Daily: race X — finish = +$100`), one claim per day, auto-granted on any finish.
- **Season S1:** every XP feeds season points. Reward tiers: 200 pts → 3 gems, 600 → 8, 1500 → 20 (CLAIM SEASON REWARD in ⚙).
- **Monetization:** cosmetics only — the 9 garage skins.
- **Analytics/crash:** local event buffer (`race_start`, `race_finish`, crashes via `window.onerror`), shaped like `POST /api/events`.

## 9. Multiplayer netcode (Phase 4) + trust (Phase 5)

- 20 Hz authoritative snapshots; inputs at 20 Hz; 100 ms interpolation; lerp-under-12 u / snap-above reconciliation.
- Server validated: speed caps, teleports, hit range/state/damage caps, finish ranks, input/fire flood (3-strike kick).
- Server is the **only minter**: kills/finishes pay from `db.json` ledger; lying `hp:100` inputs are ignored (verified headless).
- Lobby: quick match, 4-letter private codes, roster, 6 quick-chat emotes (1.2 s rate limit), 🏆 top-10 leaderboard by XP.
- Cross-device: ⚙ EXPORT/IMPORT sync codes carry wallet + account ID; Supabase schema + `.env.example` ready for hosted Postgres/Redis swap.

## 10. Graphics

- **Renderer:** WebGL, ACES tone mapping, fog (120–420), capped pixel ratio (≤1.25 on small/≤4-core screens for the perf budget).
- **Sky:** 400-point starfield + low orange sun with glow over a dark `#060610` night.
- **Track:** asphalt ribbon with center dashes, gold/cyan edge-glow lines, red/blue walls, checkered start + yellow gantry, roadside blocks.
- **Cars:** box-body + cabin + nose + wheels, boost cone flame, per-skin underglow ring, shield wireframe bubble, damage smoke by HP, tilt-and-char when wrecked.
- **Effects:** wreck explosions, rocket blooms, mine blasts, pickup rings, gold coin tokens with minimap blips, floating `+$48` / `+XP` pops.
- **HUD:** speed, lap, P-position, health bar, weapon card with ammo + expiry bar, race order, 140 px live minimap (track, pickups, coins, projectiles, rivals), kill feed, revive/garage/settings/online overlays, offline badge.

## 11. Similar games, honestly compared

| | ROAD KILL | Twisted Metal | Mario Kart |
|---|---|---|---|
| Core | Combat racer, last-car-standing pays | Combat arena, last-man-standing wins | Racer with light items |
| Weapons | 4 pickups, expiring loadouts | Large character-locked arsenals | Item boxes, one-shot items |
| Economy | Kill tokens, gem revives, garage, seasons | None | Coins (minor) |
| Multiplayer | 6P rooms, quick match + codes, authoritative server | Couch/online versus | 12P online |
| Platform | Browser PWA, offline, ~615 KB, any phone | Console | Console |
| Edge | Free, installable, playable in airplane mode; you own the server code | Deeper combat roster, story | Deeper tracks/items, polish |

Closest in spirit is **Twisted Metal** (cars as weapons, wreck-or-die), closest in feel is **Mario Kart** (pickups, 3-lap arcade racing). ROAD KILL's differentiators are the money loop (aggression pays for revives and skins), the expiring-loadout rule (no camping on rockets), and zero-install distribution as an offline PWA with a self-hostable multiplayer server.

## 12. File map

- `game/src/main.js` — Three.js scene, physics, AI, HUD, solo/online wiring
- `game/src/combat.js`, `economy.js` — pure sim + progression (headless-safe)
- `game/src/storage.js` — IndexedDB profiles/matches/sync queue + settings
- `game/src/net.js`, `netproto.js` — client netcode + shared protocol/validators
- `game/src/backend.js` — accounts, sync codes, Supabase stub
- `game/src/tracks.js`, `liveops.js`, `analytics.js` — tracks/daily/season, events
- `game/server/server.js`, `db.js` — authoritative lobby server + ledger
- `game/server/SUPABASE_SCHEMA.sql` — hosted Postgres shape
- `game/dist/` — prebuilt PWA · `ROADMAP.md` — per-phase build log

---

## PROMPT 1

Before you do anything, check the SD card folder at /sdcard/Road kill and read ROADMAP.md and GAME.md so you continue from where you stopped, and do not rebuild what already works. First answer these questions without changing code: what the game does in landscape versus portrait, the real frame rate and draw calls on this phone, how cars and road are drawn now, and the bundle size. Then add new phases to ROADMAP.md, show me the plan, and build one phase at a time, asking me before moving to the next. We are only building the game, not an admin, which will be a separate project later. Graphics must be high quality by default with realistic materials, reflections, shadows, glow and lighting, a simpler mode only for weak devices, and you must tell me honestly where the look falls short. Phase 7 is Premium Look and Controls: landscape-first layout with a rotate prompt in portrait that works on phone, tablet and desktop, a realistic advanced road like a standard racing game with multiple lanes, painted markings, shoulders, curbs, guardrails, sidewalks, bridges, tunnels, hills, intersections, street lights, buildings and scenery, a day, dusk and night cycle with wet road shine, and proper on-screen controls with accelerator, brake, boost, fire, camera view switch and jump, plus keyboard and gamepad. Phase 8 is Race Rules and Resources: six vehicles on the road at once, humans or bots with solo play still possible, every car starts with a fixed amount of fuel and ammo that the player must manage, many roadblocks of different types where some can be destroyed with weapons, some must be steered around, and heavy ones cost more ammo, fuel use and damage that make the car lose speed, handling and acceleration gradually and sensibly rather than suddenly, a minimum crawl speed so a careful player can always reach the finish, game over for a careless player who runs dry or wrecks out, and balance everything with simulated test runs that prove a careful run can finish every track and report the numbers to me. Mounted weapons use finite ammo, and pickups are only bonus extras that still expire. When a car is wrecked it can come back only up to three times, using the existing gem revive costs for now, and after the third time the player is out and can choose to spectate the rest of the race or exit. Phase 9 is Vehicles and Arsenal: build a procedural vehicle generator in code while keeping a glTF model loader, and design original vehicles in several classes, supercars inspired by the look of different famous brands with no logos or real names, sci-fi vehicles, war vehicles, tanks and a few crazy choices, starting with two or three high quality vehicles per class and then expanding, each with its own stats, fuel use, handling and look, plus upgrades for speed, armor, fuel tank and handling, mountable weapon slots on every vehicle, and sci-fi weapons you design yourself such as plasma, railgun, EMP and swarm missiles, each with its own effect, sound hook and ammo rule, and a shop paid with gold and gems where every item has a free or paid flag stored in a config file, with purchases checked by the server. Phase 10 is Map Features: barriers you can crash through or jump over, secret passages, shortcuts and hazards on every track. Phase 11 is Banners: solid brand banners that cannot be bumped and smaller people-picture banners that can be bumped or liked, with images and positions read from a config file, and the server only recording bumps, likes and views for the last 24 hours with simple endpoints a separate admin can use later. Phase 12 is Online Launch: online-only play where the server owns all money, gems, fuel, ammo and items, bots only as a practice mode that still connects to the server, hosting with wss, a real database instead of db.json, and a payments plan for later. List any sounds or textures I must supply and list your risks. Update ROADMAP.md as you go and report back with files changed and how to run it.
