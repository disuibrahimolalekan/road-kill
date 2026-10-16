# ROAD KILL — Combat Racer

3D arcade combat racer for the browser. Twisted Metal × Mario Kart energy.
PWA (offline solo) + up to 6 humans per lobby on a self-hostable authoritative server.

- **Play it:** deploy `dist/` to Vercel/Netlify (see `vercel.json`), run the server on Render (see `render.yaml`).
- **Player/dev guide:** `GAME.md` · **Build log:** `ROADMAP.md` · **Launch ops:** `DEPLOY.md` · **Funding handoff:** `handoff.md`
- **Server:** `server/` (`node server.js 8130`) · **Proof sims:** `sim/`

Stack: Vite 8.3, Three.js 0.186, Node `ws`, IndexedDB, `db.json` → Postgres.
