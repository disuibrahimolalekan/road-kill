// netproto.js — shared Phase 4 multiplayer protocol. No THREE, no ws imports.
// Same state shape runs local (bots) or remote (server). JSON over WebSocket.
export const NET_TICK_HZ = 20;
export const NET_SNAPSHOT_MS = 1000 / NET_TICK_HZ;
export const NET_MAX_PLAYERS = 6;

// Must match client physics caps (main.js MAX_SPEED 42, BOOST 1.55x).
export const NET_SPEED_CAP = 42 * 1.55; // 65.1 u/s
export const NET_SPEED_TOLERANCE = 1.3; // allow lag jitter + downhill
export const NET_TELEPORT_DIST = 30; // >30u jump in one tick = reject
export const NET_INPUT_RATE_HZ = 20;

export const MSG = {
  HELLO: 'hello',           // C->S {name, skin}
  WELCOME: 'welcome',       // S->C {clientId, roomCode, tickHz}
  JOIN: 'join',             // C->S {mode:'quick'|'code', code?}
  JOINED: 'joined',         // S->C {roomCode, slot, roster}
  ROSTER: 'roster',         // S->C {roster:[{id,name,skin}]}
  INPUT: 'input',            // C->S {seq, steer, accel, boost, fire, pos, yaw, speed, hp, wrecked, lap}
  SNAPSHOT: 'snapshot',     // S->C {t, tick, cars:[...]}
  FIRE: 'fire',              // C->S {weapon, yaw} -> S relays as event
  EVENT_FIRE: 'event:fire',
  HIT: 'hit',               // C->S hit claim {targetId, dmg, weapon}
  EVENT_HIT: 'event:hit',   // S->C validated hit {targetId, hp, killed, attackerId, weapon}
  EMOTE: 'emote',           // both {text} — quick chat only (voice later)
  PING: 'ping',
  PONG: 'pong',
  // Phase 5
  ACCOUNT: 'account',       // S->C {accountId, money, xp} (guest account, no password until Supabase)
  FINISH: 'finish',         // C->S {rank} -> S validates + awards
  AWARD: 'award',            // S->C {money, xp, reason:'kill'|'finish', by?}
  BOARD: 'board',            // C->S {} -> S->C BOARD_DATA
  BOARD_DATA: 'board-data', // S->C {entries:[{name, xp, wins, races}]}
  // Phase 9 — shop
  BUY: 'buy',               // C->S {kind:'vehicle'|'upgrade'|'weapon', item, level?}
  BUY_OK: 'buy-ok',         // S->C {ok, reason?, kind?, item?, level?, money?, gems?}
  // Phase 11 — banners
  BANNER: 'banner',         // C->S {action:'view'|'bump'|'like', id} (no reply; 24h stats)
  // Phase 12 — server-owned loadout/fuel/ammo/revives, practice mode
  LOADOUT: 'loadout',       // C->S {vehicle, mounts:[{type,ammo}], fuelMax}
  REVIVE: 'revive',         // C->S {} -> S->C REVIVE_OK {ok, reason?, cost?, gems?}
  REVIVE_OK: 'revive-ok',
  // Phase 13 — tags, matchmaking, private rooms, server-minted tokens
  START: 'start',           // S->C {humans, bots, inSec} race start signal
  START_REQ: 'start-req',   // C->S {bots} host early-start (private rooms)
  TOKEN: 'token',           // C->S {value} money-token collect claim -> S->C AWARD
  ERROR: 'error',
  BYE: 'bye',
};

// Phase 13 — stable server-generated identity tags (no usernames).
// Deterministic per account: same account, same tag, every session.
export function tagFor(accountId) {
  const s = String(accountId || 'guest');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 4; i++) { t += chars[h % chars.length]; h = Math.floor(h / chars.length); }
  return 'RK-' + t;
}

export const QUICK_CHAT = ['GG!', 'Nice shot!', 'Eat dust!', 'Sorry!', 'Rematch?', 'On your left!'];

// Phase 5 — server-authoritative economy + accounts/leaderboard.
export const AWARD_KILL_MONEY = 48;
export const AWARD_KILL_XP = 18;
export const AWARD_FINISH_MONEY = [48, 28, 14, 6, 6, 6]; // P1..P6
export const AWARD_FINISH_XP = [120, 80, 52, 32, 18, 10];
export const SEASON_ID = 'S1';

export function makeSnapshotCar(c) {
  return {
    id: c.id, name: c.name, skin: c.skin,
    x: +c.x.toFixed(2), z: +c.z.toFixed(2),
    yaw: +c.yaw.toFixed(3), speed: +c.speed.toFixed(1),
    hp: Math.round(c.hp), wrecked: !!c.wrecked, lap: c.lap | 0,
  };
}

// Server-side validation: speed cap + teleport check. Pure, testable.
export function validateMove(prev, next, dtSec) {
  if (!prev) return { ok: true };
  const dx = next.x - prev.x, dz = next.z - prev.z;
  const dist = Math.hypot(dx, dz);
  if (dist > NET_TELEPORT_DIST) return { ok: false, reason: 'teleport', dist };
  const maxDist = NET_SPEED_CAP * NET_SPEED_TOLERANCE * Math.max(dtSec, 1 / NET_TICK_HZ);
  if (dist > maxDist + 2) return { ok: false, reason: 'speed', dist, maxDist };
  return { ok: true, dist };
}

export function validateHit(attacker, target, maxRange = 65) {
  if (!attacker || !target) return { ok: false, reason: 'missing' };
  if (target.wrecked) return { ok: false, reason: 'target-wrecked' };
  const d = Math.hypot(attacker.x - target.x, attacker.z - target.z);
  if (d > maxRange) return { ok: false, reason: 'range', dist: d };
  return { ok: true, dist: d };
}
