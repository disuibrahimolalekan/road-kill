// server.js — Phase 5 authoritative server. ESM. Run: node server.js [port]
// Rooms of 6, 20Hz tick, quick match + private codes, emotes/quick chat.
// Phase 5 additions: guest accounts (persisted), server-side HP + hit
// registration, server-awarded currency only, rate limits + strikes,
// leaderboard, finish validation. Currency is never trusted from clients.
// Phase 11: banner events (24h stats) + tiny HTTP admin API for the later project.
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { NET_TICK_HZ, NET_MAX_PLAYERS, MSG, makeSnapshotCar, validateMove, validateHit, QUICK_CHAT } from '../src/netproto.js';
import { loadDB, saveDBNow, getOrCreateAccount, awardKill, awardFinish, leaderboard, buyItem, recordBanner, bannerSummary, bannerConfig, serverRevive, loadoutAmmoLedger, shopConfig } from './db.js';
import { WEAPON_DEFS } from '../src/combat.js';
import { pgInit, pgPersistAll, pgEnabled } from './pgmirror.js';

const PORT = parseInt(process.argv[2] || process.env.PORT || '8130', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || null; // if set, admin API needs ?key=
const httpServer = createServer((req, res) => {
  // Phase 11 admin API (read-only; the separate admin project builds on this).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = new URL(req.url, 'http://x');
    if (ADMIN_KEY && u.searchParams.get('key') !== ADMIN_KEY) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, reason: 'key' }));
    }
    if (u.pathname === '/api/banners/summary') {
      return res.end(JSON.stringify({ ok: true, windowH: 24, stats: bannerSummary(db) }));
    }
    if (u.pathname === '/api/banners/raw') {
      const windowH = Math.min(24, Math.max(1, parseInt(u.searchParams.get('windowH') || '24', 10) || 24));
      return res.end(JSON.stringify({ ok: true, stats: bannerSummary(db, windowH) }));
    }
    if (u.pathname === '/api/config/banners') {
      return res.end(JSON.stringify({ ok: true, config: bannerConfig() }));
    }
    if (u.pathname === '/api/health') {
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size, phase: 12 }));
    }
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, reason: 'no-route' }));
  } catch {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, reason: 'error' }));
  }
});
const wss = new WebSocketServer({ server: httpServer });
const db = loadDB();
// Phase 12: Postgres write-through when DATABASE_URL is set (file fallback).
await pgInit(db);
if (pgEnabled()) setInterval(() => pgPersistAll(db), 15000);

process.on('SIGINT', () => { saveDBNow(db); process.exit(0); });
process.on('SIGTERM', () => { saveDBNow(db); process.exit(0); });

let clientSeq = 1;
const rooms = new Map(); // code -> room
let tickCount = 0;

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(c) ? newCode() : c;
}

function createRoom() {
  const code = newCode();
  const room = { code, clients: new Map(), cars: new Map(), createdAt: Date.now(), lastInputAt: new Map(), practice: false };
  rooms.set(code, room);
  return room;
}

// Phase 12 practice room: 1 human + local bots client-side, but the session
// still connects (account, awards, shop, banners all server-backed).
function createPracticeRoom() {
  const room = createRoom();
  room.practice = true;
  return room;
}

function findQuickRoom() {
  for (const room of rooms.values()) {
    if (room.practice) continue;
    if (room.clients.size < NET_MAX_PLAYERS) return room;
  }
  return createRoom();
}

function rosterOf(room) {
  return [...room.clients.values()].map((c) => ({ id: c.id, name: c.name, skin: c.skin }));
}

function broadcast(room, obj, exceptId = null) {
  const s = JSON.stringify(obj);
  for (const [id, c] of room.clients) {
    if (id === exceptId) continue;
    if (c.ws.readyState === 1) c.ws.send(s);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function snapshotOf(room) {
  return {
    type: MSG.SNAPSHOT,
    t: Date.now(),
    tick: tickCount,
    cars: [...room.cars.values()].map(makeSnapshotCar),
  };
}

// Rate-limit helper: max N events per sliding 1000ms window.
function hitRate(map, id, max) {
  const now = Date.now();
  let arr = map.get(id);
  if (!arr) { arr = []; map.set(id, arr); }
  while (arr.length && now - arr[0] > 1000) arr.shift();
  arr.push(now);
  return arr.length <= max;
}

const inputRates = new Map();
const fireRates = new Map();
const buyRates = new Map(); // Phase 9 shop rate limit
const bannerRates = new Map(); // Phase 11 banner event rate limit

function strike(room, id, reason) {
  const c = room.clients.get(id);
  if (!c) return;
  c.strikes = (c.strikes || 0) + 1;
  send(c.ws, { type: MSG.ERROR, reason: 'strike-' + reason, strikes: c.strikes });
  if (c.strikes >= 3) {
    send(c.ws, { type: MSG.ERROR, reason: 'kicked' });
    try { c.ws.close(); } catch {}
  }
}

wss.on('connection', (ws) => {
  const id = 'p' + (clientSeq++);
  let room = null;
  let name = 'Racer' + id;
  let skin = 'default';
  let accountId = null;
  let lastEmoteAt = 0;

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return send(ws, { type: MSG.ERROR, reason: 'bad-json' }); }

    if (m.type === MSG.HELLO) {
      name = String(m.name || name).slice(0, 16);
      skin = String(m.skin || 'default').slice(0, 24);
      const acc = getOrCreateAccount(db, m.accountId, name, skin);
      accountId = acc.id;
      send(ws, { type: MSG.WELCOME, clientId: id, tickHz: NET_TICK_HZ });
      send(ws, { type: MSG.ACCOUNT, accountId: acc.id, money: acc.money, xp: acc.xp, gems: acc.gems, inventory: acc.inventory });
      return;
    }

    // Phase 9 — server-checked shop. Works pre-join (garage before race).
    if (m.type === MSG.BUY) {
      if (!accountId) return send(ws, { type: MSG.BUY_OK, ok: false, reason: 'no-account' });
      if (!hitRate(buyRates, id, 8)) return send(ws, { type: MSG.BUY_OK, ok: false, reason: 'rate-limit' });
      const kind = String(m.kind || '');
      const item = String(m.item || '').slice(0, 24);
      const level = m.level | 0;
      const vehicle = m.vehicle ? String(m.vehicle).slice(0, 24) : undefined;
      if (!['vehicle', 'weapon', 'upgrade'].includes(kind)) return send(ws, { type: MSG.BUY_OK, ok: false, reason: 'no-item' });
      const r = buyItem(db, accountId, kind, item, level, vehicle);
      send(ws, { type: MSG.BUY_OK, ...r });
      if (r.ok) {
        const acc = getOrCreateAccount(db, accountId);
        send(ws, { type: MSG.ACCOUNT, accountId: acc.id, money: acc.money, xp: acc.xp, gems: acc.gems, inventory: acc.inventory });
      }
      return;
    }

    // Phase 11 — banner events (24h stats). Works pre-join; rate-limited.
    if (m.type === MSG.BANNER) {
      if (!accountId) return;
      const action = String(m.action || '');
      const bid = String(m.id || '').slice(0, 24);
      if (!['view', 'bump', 'like'].includes(action)) return;
      const win = action === 'view' ? 30000 : action === 'bump' ? 3000 : 60000;
      const k = `${accountId}:${action}:${bid}`;
      const last = bannerRates.get(k) || 0;
      if (Date.now() - last < win) return;
      bannerRates.set(k, Date.now());
      recordBanner(db, accountId, action, bid);
      return;
    }

    if (m.type === MSG.JOIN) {
      if (m.mode === 'practice') {
        room = createPracticeRoom();
      } else if (m.mode === 'code' && m.code) {
        const code = String(m.code).toUpperCase().trim();
        room = rooms.get(code) || null;
        if (!room) { room = createRoom(); rooms.delete(room.code); room.code = code; rooms.set(code, room); }
      } else {
        room = findQuickRoom();
      }
      if (room.practice && room.clients.size >= 1) return send(ws, { type: MSG.ERROR, reason: 'room-full' });
      if (room.clients.size >= NET_MAX_PLAYERS) return send(ws, { type: MSG.ERROR, reason: 'room-full' });
      room.clients.set(id, { id, ws, name, skin, accountId, strikes: 0, revives: 0 });
      if (!room.cars.has(id)) room.cars.set(id, { id, name, skin, accountId, x: 0, z: 0, yaw: 0, speed: 0, hp: 100, wrecked: false, lap: 0, fuel: 60, fuelMax: 120, ammo: { mg: 300 } });
      room.lastInputAt.set(id, Date.now());
      send(ws, { type: MSG.JOINED, roomCode: room.code, slot: room.clients.size, roster: rosterOf(room), practice: !!room.practice });
      broadcast(room, { type: MSG.ROSTER, roster: rosterOf(room) });
      return;
    }

    if (!room) return send(ws, { type: MSG.ERROR, reason: 'not-joined' });

    if (m.type === MSG.INPUT) {
      if (!hitRate(inputRates, id, 40)) { strike(room, id, 'input-flood'); return; }
      const car = room.cars.get(id);
      if (!car) return;
      const now = Date.now();
      const lastAt = room.lastInputAt.get(id) || now;
      const dt = Math.min(1, Math.max(1 / NET_TICK_HZ, (now - lastAt) / 1000));
      const next = { x: +m.pos?.x || 0, z: +m.pos?.z || 0 };
      const v = validateMove({ x: car.x, z: car.z }, next, dt);
      if (!v.ok) {
        send(ws, { type: MSG.ERROR, reason: v.reason, correct: { x: car.x, z: car.z } });
        return;
      }
      car.x = next.x; car.z = next.z;
      car.yaw = +m.yaw || 0; car.speed = Math.min(+m.speed || 0, 80);
      // Phase 12 — server fuel clamp (0..fuelMax); client fuel display is advisory.
      if (typeof m.fuel === 'number' && car.fuelMax) {
        car.fuel = Math.max(0, Math.min(car.fuelMax, +m.fuel || 0));
      }
      // HP is server-owned: client hp is ignored. Revive handshake — the client
      // only clears wrecked after paying gems locally, so trust the transition.
      if (car.wrecked && !m.wrecked && car.hp <= 0) { car.hp = 100; car.wrecked = false; }
      car.lap = m.lap | 0;
      car.name = name; car.skin = skin;
      room.lastInputAt.set(id, now);
      return;
    }

    // Phase 12 — race loadout: declares vehicle + mounts; resets ammo/revives.
    if (m.type === MSG.LOADOUT) {
      const car = room.cars.get(id);
      if (!car) return;
      const cfg = shopConfig();
      const vehicle = (cfg.vehicles || []).find((v) => v.id === String(m.vehicle || '').slice(0, 24));
      const mounts = Array.isArray(m.mounts) ? m.mounts.slice(0, 2) : [];
      for (const mt of mounts) {
        const w = (cfg.weapons || []).find((x) => x.id === String(mt.type || '').slice(0, 12));
        if (!w || !w.mountable) return send(ws, { type: MSG.ERROR, reason: 'bad-loadout' });
      }
      const top = vehicle ? vehicle.top : 40;
      car.vehicle = vehicle ? vehicle.id : 'falcon_s';
      car.fuelMax = Math.min((vehicle ? vehicle.fuel : 70) + 60, 200);
      car.fuel = Math.min(+m.fuel || car.fuelMax, car.fuelMax);
      car.ammo = loadoutAmmoLedger(mounts.length ? mounts.map((mt) => {
        const w = cfg.weapons.find((x) => x.id === mt.type);
        return { type: mt.type, ammo: Math.min(+mt.ammo || 0, (w ? w.raceAmmo : 0) * 2) };
      }) : [{ type: 'mg', ammo: 150 }]);
      const conn = room.clients.get(id);
      if (conn) conn.revives = 0;
      car.top = top;
      return;
    }

    // Phase 12 — server-owned gem revive (1/5/30, then wrecked-out).
    if (m.type === MSG.REVIVE) {
      const conn = room.clients.get(id);
      const car = room.cars.get(id);
      if (!conn || !car || !conn.accountId) return send(ws, { type: MSG.REVIVE_OK, ok: false, reason: 'no-account' });
      if (!car.wrecked) return send(ws, { type: MSG.REVIVE_OK, ok: false, reason: 'alive' });
      const r = serverRevive(db, conn.accountId, conn.revives | 0);
      if (!r.ok) return send(ws, { type: MSG.REVIVE_OK, ...r });
      conn.revives = (conn.revives | 0) + 1;
      car.hp = 100; car.wrecked = false;
      const acc = getOrCreateAccount(db, conn.accountId);
      send(ws, { type: MSG.REVIVE_OK, ...r });
      send(ws, { type: MSG.ACCOUNT, accountId: acc.id, money: acc.money, xp: acc.xp, gems: acc.gems, inventory: acc.inventory });
      return;
    }

    if (m.type === MSG.FIRE) {
      if (!hitRate(fireRates, id, 12)) { strike(room, id, 'fire-flood'); return; }
      // Phase 12 — server ammo ledger: bounded mounts + pickup headroom.
      const car = room.cars.get(id);
      const wtype = String(m.weapon || 'mg').slice(0, 12);
      if (!WEAPON_DEFS[wtype]) return send(ws, { type: MSG.ERROR, reason: 'bad-weapon' });
      if (car) {
        if (!car.ammo) car.ammo = { mg: 300 };
        if ((car.ammo[wtype] | 0) <= 0) return send(ws, { type: MSG.ERROR, reason: 'no-ammo' });
        car.ammo[wtype]--;
      }
      broadcast(room, { type: MSG.EVENT_FIRE, from: id, weapon: wtype, yaw: +m.yaw || 0 }, id);
      return;
    }

    if (m.type === MSG.HIT) {
      // Server-side hit registration: range + state checks here, damage here.
      const attacker = room.cars.get(id);
      const target = room.cars.get(m.targetId);
      const v = validateHit(attacker, target);
      if (!v.ok) return send(ws, { type: MSG.ERROR, reason: 'hit-' + v.reason });
      const dmg = Math.max(0, Math.min(60, +m.dmg || 0));
      target.hp = Math.max(0, target.hp - dmg);
      let killed = false;
      if (target.hp <= 0 && !target.wrecked) {
        target.wrecked = true;
        killed = true;
        const killerConn = room.clients.get(id);
        const killerAcc = killerConn && killerConn.accountId;
        if (killerAcc) {
          const award = awardKill(db, killerAcc);
          const kw = room.clients.get(id);
          if (kw) send(kw.ws, { type: MSG.AWARD, money: award.money, xp: award.xp, reason: 'kill' });
        }
      }
      broadcast(room, { type: MSG.EVENT_HIT, targetId: m.targetId, hp: target.hp, killed, attackerId: id, weapon: String(m.weapon || 'mg').slice(0, 12), dmg });
      return;
    }

    if (m.type === MSG.FINISH) {
      const rank = m.rank | 0;
      const size = room.clients.size;
      if (!(rank >= 1 && rank <= Math.max(size, 1) && rank <= 6)) return send(ws, { type: MSG.ERROR, reason: 'bad-rank' });
      const conn = room.clients.get(id);
      if (!conn || !conn.accountId) return send(ws, { type: MSG.ERROR, reason: 'no-account' });
      const award = awardFinish(db, conn.accountId, rank);
      conn.revives = 0; // Phase 12: new race resets the revive ladder
      send(ws, { type: MSG.AWARD, money: award.money, xp: award.xp, reason: 'finish', rank });
      const acc = getOrCreateAccount(db, conn.accountId);
      send(ws, { type: MSG.ACCOUNT, accountId: acc.id, money: acc.money, xp: acc.xp, gems: acc.gems });
      return;
    }

    if (m.type === MSG.BOARD) {
      return send(ws, { type: MSG.BOARD_DATA, entries: leaderboard(db, 10) });
    }

    if (m.type === MSG.EMOTE) {
      const now = Date.now();
      if (now - lastEmoteAt < 1200) return send(ws, { type: MSG.ERROR, reason: 'rate-limit' });
      lastEmoteAt = now;
      const text = String(m.text || '').slice(0, 24);
      if (!text) return;
      broadcast(room, { type: MSG.EMOTE, from: id, name, text });
      return;
    }

    if (m.type === MSG.PING) return send(ws, { type: MSG.PONG, t: m.t });

    if (m.type === MSG.BYE) { try { ws.close(); } catch {} }
  });

  ws.on('close', () => {
    if (room && room.clients.has(id)) {
      room.clients.delete(id);
      room.cars.delete(id);
      broadcast(room, { type: MSG.ROSTER, roster: rosterOf(room) });
      if (room.clients.size === 0) rooms.delete(room.code);
    }
  });
});

// 20Hz authoritative snapshot broadcast.
setInterval(() => {
  tickCount++;
  for (const room of rooms.values()) {
    if (!room.clients.size) continue;
    broadcast(room, snapshotOf(room));
  }
}, Math.round(1000 / NET_TICK_HZ));

httpServer.listen(PORT, () => console.log(`ROADKILL server on :${PORT} tick=${NET_TICK_HZ}Hz phase=12 (ws + /api/*, pg optional)`));
export { rooms, QUICK_CHAT };
