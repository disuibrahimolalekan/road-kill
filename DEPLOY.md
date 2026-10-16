# ROAD KILL — Online Launch (Phase 12)

## What "launch" means here

- **Server owns everything that matters:** money/gems (minter only), shop
  purchases (`BUY` validated in `server/db.js`), gem revives (`REVIVE`
  1/5/30 ladder per race), ammo ledger per weapon (raceAmmo ×2 headroom),
  fuel clamp (0..fuelMax), hit registration, finish ranks, banner 24h stats.
- **Bots = practice mode with a server session:** ONLINE → PRACTICE gives a
  solo grid against bots while account, wallet, awards, shop and banners stay
  server-backed. Airplane-mode solo (no connection) still works as fallback.
- **Client is a dumb terminal for money:** it only applies `AWARD`/`ACCOUNT`/
  `BUY_OK`/`REVIVE_OK` messages. Lying inputs (`hp:100`, free gems) are ignored.

## Host the game (PWA, free)

| Piece | Where | Notes |
|---|---|---|
| Game PWA | Vercel / Netlify / Cloudflare Pages | Deploy `game/dist/`. HTTPS required (PWA + wss). |
| Multiplayer + API | Render / Fly.io / Railway (free tier) | `node server/server.js $PORT`. Serves ws + `/api/*` on one port. |
| Database | Supabase Postgres / Neon (free) | Set `DATABASE_URL`. Without it, the server runs on `db.json` (fine for testing). |
| Images | Cloudinary (free) | Banner PNGs + future textures. |

`$0/month` until real player volume.

## Server env

| Var | Required | What |
|---|---|---|
| `PORT` | host sets it | Listen port (default 8130). |
| `DATABASE_URL` | no | Postgres connection string. If set, accounts load from PG at boot and persist every 15s (`server/pgmirror.js`). If unset/unreachable, file mode (`db.json`). |
| `ADMIN_KEY` | public hosts: yes | Admin API (`/api/banners/*`, `/api/config/banners`) requires `?key=`. |

Client: open the game → ONLINE → server URL defaults to `wss://<host>:8130`
on https pages (`ws://` auto-upgrades; mixed content would otherwise break).
Point it at your host instead, e.g. `wss://roadkill-server.onrender.com`.

## Admin API (for the separate admin project)

- `GET /api/health` → `{ok, rooms, phase}`
- `GET /api/banners/summary` → 24h views/bumps/likes per banner
- `GET /api/banners/raw?windowH=6` → same, custom window (≤24h)
- `GET /api/config/banners` → live banner config
- Shop/economy stay in `shop-config.json` + `db.json`/Postgres (`SUPABASE_SCHEMA.sql` has the full shape incl. Phase 9/11 migration).

## Payments plan (later — NOT built)

Cosmetics only, never pay-to-win (skins, gem packs for revives/shop):

1. Provider: **Paystack or Flutterwave** (cards + mobile money) and/or Stripe
   for cards. Pick one; all support server-side webhooks.
2. Flow: player buys a gem pack in the (later) storefront → provider webhook
   hits a new `POST /api/payments/webhook` (to build) → server verifies the
   webhook signature → credits gems via the same ledger as awards
   (`db.js`, never client-granted) → client sees it on the next `ACCOUNT`.
3. Why it stays honest: gems only ever increase through server code paths
   (awards, shop `BUY_OK` deductions, webhook credits). The client can display
   but never mint.
4. Receipts: store provider references in a new `payments` table (see schema
   comment) for refunds/disputes before spending anything on ads.

## Pre-launch checklist

- [ ] `node sim/sim_phase12.mjs` green against the hosted build
- [ ] `ADMIN_KEY` set on the host; `/api/health` reachable
- [ ] `DATABASE_URL` set; restart server; accounts survive restart
- [ ] PWA install tested on Android (Add to Home Screen) + offline solo
- [ ] Practice room + quick match + room code tested with 2 phones
- [ ] Banner images uploaded (`public/banners/*.png` per `banners-config.json`)
- [ ] Sounds pass on device speakers (procedural SFX in `src/sound.js`;
      drop real `.mp3` files in `public/sounds/` to override)
