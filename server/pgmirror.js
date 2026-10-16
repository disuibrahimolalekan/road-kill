// pgmirror.js — Phase 12 Postgres write-through with file fallback.
// If DATABASE_URL is set, accounts load from Postgres at boot and every
// save also UPSERTs there. If PG is unreachable, the game keeps running on
// db.json (the file stays the source of truth locally). No code changes in
// server.js besides init/persist hooks.
let pool = null;

export function pgEnabled() {
  return !!process.env.DATABASE_URL;
}

export async function pgInit(db) {
  if (!pgEnabled()) return { ok: false, reason: 'no-url' };
  try {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`CREATE TABLE IF NOT EXISTS rk_accounts (
      id TEXT PRIMARY KEY, name TEXT, skin TEXT,
      money INTEGER DEFAULT 0, gems INTEGER DEFAULT 0, xp INTEGER DEFAULT 0,
      stats JSONB DEFAULT '{}', season_points INTEGER DEFAULT 0, season_id TEXT DEFAULT 'S1',
      inventory JSONB DEFAULT '{}', created_at BIGINT DEFAULT 0, last_seen BIGINT DEFAULT 0
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS rk_matches (
      id SERIAL PRIMARY KEY, account_id TEXT, rank INTEGER, money INTEGER,
      xp INTEGER, date BIGINT, season TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS rk_banners (
      banner_id TEXT, action TEXT, ts BIGINT
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS rk_banners_ts ON rk_banners (ts)`);
    // load remote accounts into the live db (file keeps anything PG lacks)
    const { rows } = await pool.query('SELECT * FROM rk_accounts');
    for (const a of rows) {
      db.accounts[a.id] = {
        id: a.id, name: a.name, skin: a.skin, money: a.money, gems: a.gems, xp: a.xp,
        stats: a.stats || {}, seasonPoints: a.season_points || 0, seasonId: a.season_id || 'S1',
        inventory: a.inventory || { vehicles: ['falcon_s'], weapons: ['mg'], upgrades: {} },
        createdAt: a.created_at, lastSeen: a.last_seen,
      };
    }
    console.log(`pgmirror: connected, ${rows.length} accounts loaded`);
    return { ok: true, accounts: rows.length };
  } catch (e) {
    console.log('pgmirror: disabled, PG unreachable — file mode (' + (e.message || e) + ')');
    pool = null;
    return { ok: false, reason: 'unreachable' };
  }
}

export async function pgPersistAccount(p) {
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO rk_accounts (id,name,skin,money,gems,xp,stats,season_points,season_id,inventory,created_at,last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET name=$2,skin=$3,money=$4,gems=$5,xp=$6,stats=$7,
         season_points=$8,season_id=$9,inventory=$10,last_seen=$12`,
      [p.id, p.name, p.skin, p.money | 0, p.gems | 0, p.xp | 0,
       JSON.stringify(p.stats || {}), p.seasonPoints | 0, p.seasonId || 'S1',
       JSON.stringify(p.inventory || {}), p.createdAt | 0, Date.now()]);
    return true;
  } catch { return false; }
}

export async function pgPersistAll(db) {
  if (!pool) return 0;
  let n = 0;
  for (const p of Object.values(db.accounts)) {
    if (await pgPersistAccount(p)) n++;
  }
  return n;
}
