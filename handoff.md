# ROAD KILL — Combat Racer: Funding & Approval Handoff

> **One line:** A high-octane 3D arcade combat racer for the browser — Twisted Metal × Mario Kart — that installs like an app, plays offline, and races up to 6 real humans per lobby on a self-hostable authoritative server.
>
> **Status:** All 13 build phases (0–12) complete, verified, and shipped. Playable today on phone, tablet, and desktop. Every balance and launch claim below is proven by automated headless simulations stored in `game/sim/`.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What the game is](#2-what-the-game-is)
3. [Platform & distribution edge](#3-platform--distribution-edge)
4. [Game modes](#4-game-modes)
5. [Tracks](#5-tracks)
6. [Vehicles & progression (levels)](#6-vehicles--progression-levels)
7. [Combat & arsenal](#7-combat--arsenal)
8. [Race rules & resources](#8-race-rules--resources)
9. [Map features](#9-map-features)
10. [Economy & monetization](#10-economy--monetization)
11. [Live ops & retention](#11-live-ops--retention)
12. [Banners & advertising surface](#12-banners--advertising-surface)
13. [Multiplayer, trust & launch readiness](#13-multiplayer-trust--launch-readiness)
14. [Tech stack](#14-tech-stack)
15. [Architecture](#15-architecture)
16. [Verification evidence (sims)](#16-verification-evidence-sims)
17. [Competitive position](#17-competitive-position)
18. [Costs](#18-costs)
19. [The ask](#19-the-ask)
20. [Risks & honest limits](#20-risks--honest-limits)
21. [Appendices](#21-appendices)

---

## 1. Executive summary

| Item | Detail |
|---|---|
| Product | ROAD KILL — 3D arcade combat racer (browser PWA + authoritative multiplayer server) |
| Players | 6 per race: humans, bots, or mixed; solo offline, online, and server-backed practice |
| Content | 3 tracks, 12 vehicles (5 classes), 8 weapons, 5 roadblock types, shortcuts, hazards, ramps, 15 ad banners |
| Business model | Free game; cosmetics-only monetization (skins, gem shop); payments planned, not yet wired |
| Running cost | **$0/month** on free tiers until real player volume |
| Codebase | Client `game/` (Vite + Three.js), server `game/server/` (Node + `ws`), prebuilt `game/dist/` (708 KB JS + 45 KB lazy 3D-loader chunk) |
| Proof | 5 headless sim suites, all passing: balance, vehicles, map features, banners, full launch integration against a live server |
| Team need | Approval/funding for hosting scale-up, content (models, sounds, art), the separate admin project, and payments integration |

---

## 2. What the game is

ROAD KILL is a combat racer: you win by driving **and** by fighting. Every wrecked rival drops cash you steal. Aggression pays for revives, vehicles, upgrades, and cosmetics.

The core loop, in one race:

1. **Race** 3 laps against 5 rivals while managing fuel and ammo.
2. **Fight** with pickup weapons (expiring — no camping) and your mounted guns (finite reserve).
3. **Wreck rivals**, collect their money tokens, dodge or smash 14 roadblocks, cut secret shortcuts, survive oil and debris.
4. **Finish** for XP + bonus cash, or wreck out (3 gem revives, then spectate).
5. **Spend** in the garage: 12 vehicles, 4 upgrade lines, 6 mountable weapons, 9 paint skins.

Session length is ~1–3 minutes per race — built for mobile play.

---

## 3. Platform & distribution edge

- **Zero-install:** opens from a link, installs to the home screen (PWA: manifest + service worker + icons).
- **Offline-first:** full solo game in airplane mode (bots, combat, economy, progression all local via IndexedDB + LocalStorage).
- **Any phone:** HIGH graphics by default with automatic SIMPLE fallback on weak devices; landscape-first layout with a rotate prompt in portrait; touch, keyboard, and gamepad controls.
- **Tiny download:** 708 KB JavaScript (~185 KB gzipped, last measured 184 KB) + 45 KB 3D-model loader fetched only if custom models are configured. No engine download, no app store required (stores remain an option via PWA wrappers).

---

## 4. Game modes

| Mode | Grid | Connection | Wallet |
|---|---|---|---|
| **Solo** | You + 5 AI bots | None (airplane mode OK) | Local |
| **Online** | Up to 6 humans, bots hidden | WebSocket, 20 Hz | Server-owned |
| **Practice** | You + 5 bots | WebSocket | Server-owned |

Practice is the bridge: new players learn against bots while their account, awards, shop, and banner stats are already server-backed. Private lobbies use 4-letter room codes (e.g. `Z2XF`); quick match fills the first room with space.

---

## 5. Tracks

3 circuits, switchable anytime in settings (road, walls, checkpoints, pickups, and minimap rebuild live):

| Track | Character | Approx. race distance (3 laps) |
|---|---|---|
| **SUNSET LOOP** | Balanced club circuit (the original 10-point loop) | ~1,905 u |
| **NEON CANYON** | Tight S-curves, late-braking battles | ~1,956 u |
| **VOLCANO RING** | Fast outer ring with a chicane | ~2,004 u |

All tracks: 220-sample Catmull-Rom ribbon, 22 units wide, **4 marked lanes** (double-yellow center, dashed dividers, solid edge lines), shoulders, red/white curbs, guardrails, sidewalks, street lights, start gantry + checkered line, intersection, bridge overpass, tunnel arches, lit buildings, trees, hills — 14 checkpoints, 3 laps. Day/dusk/night/auto lighting with wet-road shine.

---

## 6. Vehicles & progression (levels)

### 6.1 The garage: 12 original vehicles, 5 classes

No licensed brands, no logos — all original designs, procedurally built in code (a glTF loader is kept so purchased/commissioned `.glb` models drop in with procedural fallback).

| Class | Vehicles | Identity |
|---|---|---|
| SUPER (3) | FALCON S (free starter), VORTEX GT, MONARCH | Wedge supercars; speed ↔ armor tradeoff |
| SCI-FI (2) | NEBULA RAY, PULSAR X | Hover saucers; best handling, sip fuel |
| WAR (3) | BULWARK, MARAUDER, JACKAL RUNNER | Gun-trucks; armor and twin mounts |
| TANK (2) | TORTOISE H, RHINO SIEGE | Tracked turret hulls; walls with guns |
| CRAZY (2) | ROCKET TRIKE, DOOM KART | Absurd, fast, fragile, hilarious |

Stat ranges: top speed 33–46 u/s, HP 75–220, fuel tanks 55–95, fuel-use ×0.8–×1.15, 1–2 weapon mount slots. Bots drive 5 different rides, so every grid looks varied.

### 6.2 Upgrades (per vehicle)

4 lines × 3 purchasable levels: **ENGINE** (top speed/accel), **ARMOR** (+HP), **FUEL TANK** (+fuel, −use), **SUSPENSION** (+handling). Costs escalate gold → gems. Example: Vortex GT + Engine II reaches 51 u/s top speed.

### 6.3 Player levels & tiers (the meta-progression)

XP from kills (+18) and finishes (+120/80/52/32/18/10 for P1–P6) feeds header levels and tiers:

| Level | Tier |
|---|---|
| 1–5 | Bronze |
| 6–10 | Silver |
| 11–16 | Gold |
| 17–22 | Platinum |
| 23–30 | Diamond |
| 31+ | Master |

Plus 9 visual-only paint skins ($0–$600, never pay-to-win), daily challenge (+$100/day), and Season S1 points with gem reward tiers. Buying everything costs **$8,230 gold + 225 gems** — the economy is tuned so this is a long-term chase, not a weekend.

---

## 7. Combat & arsenal

- **Health & wrecking:** 100+ HP per car (up to 220+ on tanks). Wall hits (4–18 by speed), car contact, weapons, debris fields. Wreck = explosion + kill feed + money tokens + screen shake + damage smoke.
- **Expiring pickup loadouts** (10 on track, respawn 8–10 s): Rocket, M-Gun, Mine, Shield — each dies on a countdown, so nobody camps the best gun. Rare sci-fi pickups spawn too.
- **Mounted guns** (finite reserve, refill via 📦 cans): every vehicle carries 1–2 mounts; tap the weapon card or `Q` to switch slots.
- **Original sci-fi arsenal**, each with its own effect, sound hook, and ammo rule:

| Weapon | Role | Damage | Ammo/race | Note |
|---|---|---|---|---|
| 🔫 M-GUN | Starter hose | 8/rd (~87 DPS) | 150 | Free, hold-to-fire |
| 🚀 ROCKET | Punch | 34 (~71 DPS) | 8 | Dumb-fire |
| ☄️ PLASMA | Pressure | 22 + splash (~65 DPS) | 14 | Area denial |
| 🐝 SWARM | Finisher | 5×12 homing (~67 DPS) | 4 | Fire-and-forget |
| 🔹 RAILGUN | Sniper | 55 (~50 DPS) | 5 | Deletes, rarely |
| ⚡ EMP | Disruptor | 6 + 3 s kills fire+boost | 4 | Stops revives/combos |
| 💣 MINE | Trap | 54 area | 3 (pickup only) | Drop when chased |
| 🛡️ SHIELD | Guard | 5.2 s invuln | 1 (pickup only) | — |

No single weapon dominates (top DPS spread 50–87, exotics ammo-gated) — verified in the audit sim.

---

## 8. Race rules & resources

- **Fuel:** tanks 55–95 by vehicle; driving, throttle, and especially boost drain it; +16 per lap, +20 per ⛽ can (caches hidden on shortcuts). Low fuel and damage degrade speed/accel/handling **gradually** to a crawl floor (~8 u/s) — never a sudden stop. Run dry = game over.
- **Ammo:** everything finite; 📦 cans refill all mounts.
- **Roadblocks, 14 per track:** CONE (20 HP, jumpable), BARRIER (45 HP, jumpable), CRASH GATE (12 HP — always ram-breakable), ARMORED (120 HP — costs ~15 MG rounds), TIRE WALL (indestructible — steer around). Destroyed blocks respawn in 20 s. Bots steer around them; players can jump the low ones.
- **Wreck economy:** 3 gem revives per race (1 → 5 → 30 gems, server-charged online), then out — spectate the leader or restart.
- **Balance proof:** a careful driver finishes every track with fuel to spare (79–96 left); a normal driver finishes battered; a boost-spammer runs dry on lap 1; a ram-everything driver wrecks out. (Full table in §16.)

---

## 9. Map features

Every track has: crash-through gates, jumpable barriers, **2 launch ramps** (~0.9 s air, clears low blocks), **1 secret shortcut** (12–24% shorter, tire funnels, chevron signs, hidden fuel+ammo cache, +$10 first-use bonus), and **3 hazards** (oil slicks halve handling; debris fields deal 6/s). Checkpoints tolerate shortcut skips (up to 4 ahead) and lap counting survives them — unit-tested. Minimap shows blocks, hazards, ramps, shortcuts, pickups, coins, projectiles, and rivals.

---

## 10. Economy & monetization

- **Currencies:** gold (races, kills, tokens, dailies) + gems (seasons, scarce). Start: $80 + 14 gems. Server is the **only minter** online — clients can display money but never create it (verified: spoofed inputs ignored).
- **Sinks:** vehicles ($450–$800 / 15–35 gems), upgrades, weapons, skins, gem revives.
- **Policy: cosmetics and convenience only — never pay-to-win.** Skins are visual; the strongest items are earnable.
- **Payments:** planned, not built. Design: Paystack/Flutterwave/Stripe → signed webhook → server-credited gems through the same ledger as awards, with receipt storage. Full plan in `game/DEPLOY.md`.

---

## 11. Live ops & retention

- Daily challenge (deterministic per date, +$100, one claim/day).
- Season S1 points with claimable gem tiers.
- Local analytics/crash buffer shaped like `POST /api/events`.
- Online leaderboard (top 10 by XP), quick chat, room codes.

---

## 12. Banners & advertising surface

A working in-game ad channel, ready for sponsors now, managed later:

- **6 solid brand billboards** (2/track, e.g. NITRO COLA, TURBO TIRES) — physical, unbumpable, outside the rails.
- **9 people portraits** (3/track) — drivable bump (wobble + counted) and a ♥ LIKE button when close.
- All images + positions from `banners-config.json`; procedural placeholder art ships, real PNGs drop into `game/public/banners/`.
- Server records **views/bumps/likes for the last 24 h only** (likes: 1/account/banner/day, all events rate-limited).
- Admin-ready read API on the game port: `/api/banners/summary`, `/api/banners/raw?windowH=`, `/api/config/banners`, `/api/health` (optional `ADMIN_KEY`). **No admin UI in this repo** — that is the separate project.

---

## 13. Multiplayer, trust & launch readiness

- 20 Hz authoritative snapshots, client prediction + reconciliation, 100 ms interpolation, room codes, quick match, practice rooms, 6-player cap.
- Server-validated: speed caps, teleports, hit range/state/damage, finish ranks, input/fire flood (3-strike kick), purchases, revive ladder, ammo ledger, fuel clamp.
- Launch kit: `game/DEPLOY.md` (hosting table, env vars, admin API, payments plan, pre-launch checklist), Postgres write-through (`DATABASE_URL`, file fallback), `SUPABASE_SCHEMA.sql` migration, wss auto-upgrade on https.

---

## 14. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Client build | Vite 8.3 | 708 KB JS (~185 KB gzip) + 45 KB lazy glTF chunk |
| 3D | Three.js 0.186 | WebGL, ACES, PCFSoft shadows, procedural everything |
| Language | JavaScript (ES modules) | Pure-logic modules (`combat`, `rules`, `vehicles`, `economy`) run headless in Node |
| Server | Node.js + `ws` (+ `pg` optional) | 20 Hz, one port for ws + HTTP admin API |
| Client storage | IndexedDB + LocalStorage | Profiles, currency, history, settings, sync queue |
| Server storage | `db.json` → Postgres | File today; `DATABASE_URL` enables PG write-through; Supabase schema ready |
| PWA | manifest + service worker + icons | Installable, offline solo |
| Audio | WebAudio synth (`src/sound.js`) | Per-weapon hooks; real `.mp3` files override, none required |
| Config | JSON files | `shop-config.json` (prices/flags), `banners-config.json` (ads) — game + server read the same files |

---

## 15. Architecture

- `game/src/main.js` — scene, physics (60 Hz fixed tick), AI, HUD, solo/online wiring.
- `game/src/combat.js`, `rules.js`, `vehicles.js`, `economy.js` — pure sim/rules/shop (unit-tested in Node).
- `game/src/tracks.js`, `liveops.js`, `analytics.js`, `storage.js`, `backend.js`, `sound.js`, `net.js`, `netproto.js` — tracks, seasons, events, persistence, accounts, audio, protocol.
- `game/server/server.js`, `db.js`, `pgmirror.js` — authoritative lobby + ledger + PG mirror.
- `game/server/SUPABASE_SCHEMA.sql` — hosted Postgres shape.
- `game/dist/` — prebuilt PWA. `ROADMAP.md` — per-phase build log (0–12). `DEPLOY.md` — launch ops. `game/sim/` — 5 proof sims + result logs.

---

## 16. Verification evidence (sims)

All suites deterministic and passing; logs in `game/sim/`:

| Suite | What it proves | Result |
|---|---|---|
| `sim_phase8` (balance) | Careful finishes all tracks (fuel 88–96 left); normal finishes battered; boost-spam dry @~30 s; ram-out @~40–47 s; ammo always sufficient | ALL PASS |
| `sim_phase9` (vehicles) | All 12 vehicles finish all tracks; weapon DPS table; shop totals $8,230 + 225 gems, 8 free entries | ALL PASS |
| `sim_phase10` (map) | 8 checkpoint unit tests; shortcuts save 12/22/24%; hazard/gate/ramp tuning sane | ALL PASS |
| `sim_phase11` (banners) | Events, dup-like/unknown rejection, 24 h pruning, per-track counts | ALL PASS |
| `sim_phase12` (launch) | Real server boot: practice isolation, ammo cap, revive 1/5 gems, hit wrecks, banners, admin API — 15/15 | ALL PASS |

---

## 17. Competitive position

| | ROAD KILL | Twisted Metal | Mario Kart |
|---|---|---|---|
| Core | Combat racer where aggression pays | Combat arena | Racer with light items |
| Roster/arsenal | 12 rides, 8 weapons, mounts + upgrades | Larger locked arsenals, story | Item boxes |
| Economy | Kill cash, revives, shop, seasons | None | Coins (minor) |
| Multiplayer | 6P rooms + codes + practice, self-hosted authoritative | Couch/online versus | 12P online |
| Platform | Browser PWA, offline, ~185 KB gzip, any phone | Console | Console |
| Edge | Free, installable, airplane-mode playable; you own the server code | Depth, story | Polish, tracks |

Differentiators: the money loop (wrecks fund revives and rides), expiring loadouts (no camping), resource racing (fuel/ammo), zero-install distribution, and a server you can host for $0.

---

## 18. Costs

| Piece | Service | Cost |
|---|---|---|
| Game (PWA) | Vercel / Netlify / Cloudflare Pages | Free |
| Multiplayer server | Render / Fly.io / Railway | Free tier |
| Database | Supabase / Neon Postgres | Free tier |
| Media | Cloudinary | Free |

**$0/month** until real player volume. Costs scale with players (host + database tiers), not with features.

---

## 19. The ask

1. **Approve the launch:** game + server are built, proven, and documented (`DEPLOY.md` checklist).
2. **Fund content & scale, in order:**
   a. Real art/sound: vehicle `.glb` models, banner PNGs, `.mp3` SFX/music (hooks already in place — biggest visual/audio ROI).
   b. The **separate admin project** (banners, shop tuning, player support) on the existing admin API.
   c. Payments integration per the plan (webhook → server-credited gems).
   d. Hosting scale-up: more tracks/vehicles, seasons, tournaments.
3. **Success metrics to hold us to:** day-1/7/30 retention, races per player, % players finishing 3 races, revive/shop conversion, crash-free sessions (analytics hooks already emit these events).

---

## 20. Risks & honest limits

- Art is procedural box-primitive until real models/textures are supplied (loader + hooks ready).
- Ammo ledger allows ×2 headroom (bounded, never infinite); full pickup authority is future work.
- Matches/raw banner events stay file-only; accounts mirror to Postgres.
- Free-tier hosts sleep (cold-start lobbies); no local TLS (hosts terminate).
- Bots don't take shortcuts (player's edge, by design); balance sims are models — device FPS must be watched on the in-game perf HUD.
- Payments unwired (deliberate — plan documented, build after approval).

---

## 21. Appendices

### A. Controls

Touch (◀ ▲ ▼ ▶, BOOST, FIRE, JUMP, CAM, TOD, ♥), keyboard (WASD/arrows, Space, J/X, C, Q, V, T, P/Esc), full gamepad (stick, RT/LT, A, RB, LB, Y, X).

### B. How to run

- Solo/dev: `cd game && npm install --no-bin-links && npx vite --host 0.0.0.0` → http://localhost:5173
- Server: `cd game/server && npm install --no-bin-links && node server.js 8130` (+ `DATABASE_URL`, `ADMIN_KEY` on hosts)
- Online: ONLINE → QUICK MATCH / room code / PRACTICE (server URL defaults to same host `:8130`, wss auto on https)
- Sims: `node sim/sim_phase8.mjs` … `node sim/sim_phase12.mjs`
- Install on phone: hosted URL → INSTALL → airplane mode still plays solo.

### C. Source of truth files

`ROADMAP.md` (phases 0–12 build log) · `GAME.md` (player/dev guide) · `DEPLOY.md` (launch ops) · `game/sim/*_results.txt` (proof) · `shop-config.json` · `banners-config.json`.

---

*Prepared 2026-10-16 from the shipped codebase. Every number above traces to code, config, or a passing sim — nothing is aspirational.*
