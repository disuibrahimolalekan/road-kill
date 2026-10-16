// net.js — Phase 4 client netcode. No THREE imports.
// Prediction: local car keeps instant physics. Reconciliation: server snapshot
// corrects local pos when error is large, lerps when small.
// Interpolation: remote cars render from a 100ms-delayed snapshot buffer.
import { MSG, NET_TICK_HZ, NET_INPUT_RATE_HZ, QUICK_CHAT } from './netproto.js';

export { QUICK_CHAT };

const SNAP_DELAY_MS = 100;
const RECONCILE_SNAP_DIST = 12; // >12u error = snap, else lerp
const RECONCILE_LERP = 0.35;

export class NetClient {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.roomCode = null;
    this.roster = [];
    this.connected = false;
    this.online = false;
    this.tickHz = NET_TICK_HZ;
    this.seq = 0;
    this.snapshots = []; // {t, cars}
    this.remoteCars = new Map(); // id -> {interp:{x,z,yaw}, lastSeen}
    this.corrections = 0;
    this.lastRtt = 0;
    this.onRoster = null;
    this.onEmote = null;
    this.onHit = null;
    this.onFire = null;
    this.onError = null;
    this.onSnapshot = null;
    this.onAccount = null;
    this.onAward = null;
    this.onBoard = null;
    this._pingT = 0;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      let ws;
      // Phase 12: https pages must use wss (mixed-content blocks ws://)
      try {
        if (typeof location !== 'undefined' && location.protocol === 'https:' && url.indexOf('ws://') === 0) {
          url = 'wss://' + url.slice(5);
        }
        ws = new WebSocket(url);
      } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => { this.connected = true; resolve(); };
      ws.onerror = () => { if (!this.connected) reject(new Error('ws-connect-failed')); };
      ws.onclose = () => { this.connected = false; this.online = false; };
      ws.onmessage = (ev) => this._onMessage(ev.data);
      setTimeout(() => { if (!this.connected) { try { ws.close(); } catch {} reject(new Error('ws-timeout')); } }, 8000);
    });
  }

  _send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  hello(name, skin, accountId) { this._send({ type: MSG.HELLO, name, skin, accountId }); }
  joinQuick() { this._send({ type: MSG.JOIN, mode: 'quick' }); }
  joinCode(code) { this._send({ type: MSG.JOIN, mode: 'code', code }); }
  joinPractice() { this._send({ type: MSG.JOIN, mode: 'practice' }); }

  sendInput({ steer, accel, boost, fire, pos, yaw, speed, hp, wrecked, lap, fuel }) {
    this.seq++;
    this._send({ type: MSG.INPUT, seq: this.seq, steer, accel, boost, fire, pos: { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2) }, yaw: +yaw.toFixed(3), speed: +speed.toFixed(1), hp: Math.round(hp), wrecked: !!wrecked, lap: lap | 0, fuel: Math.max(0, fuel | 0) });
  }

  sendFire(weapon, yaw) { this._send({ type: MSG.FIRE, weapon, yaw }); }
  sendHit(targetId, dmg, weapon) { this._send({ type: MSG.HIT, targetId, dmg, weapon }); }
  sendEmote(text) { this._send({ type: MSG.EMOTE, text: String(text).slice(0, 24) }); }
  sendFinish(rank) { this._send({ type: MSG.FINISH, rank }); }
  requestBoard() { this._send({ type: MSG.BOARD }); }
  sendBuy(kind, item, level, vehicle) { this._send({ type: MSG.BUY, kind, item, level: level | 0, vehicle }); }
  sendBanner(action, id) { this._send({ type: MSG.BANNER, action, id }); }
  sendLoadout(loadout) { this._send({ type: MSG.LOADOUT, ...loadout }); }
  sendRevive() { this._send({ type: MSG.REVIVE }); }
  ping() { this._pingT = performance.now(); this._send({ type: MSG.PING, t: Date.now() }); }
  disconnect() { try { this._send({ type: MSG.BYE }); this.ws.close(); } catch {} this.connected = false; this.online = false; }

  _onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === MSG.WELCOME) { this.clientId = m.clientId; this.tickHz = m.tickHz || NET_TICK_HZ; }
    else if (m.type === MSG.JOINED) { this.roomCode = m.roomCode; this.roster = m.roster || []; this.online = true; if (this.onRoster) this.onRoster(this.roster); }
    else if (m.type === MSG.ROSTER) { this.roster = m.roster || []; if (this.onRoster) this.onRoster(this.roster); }
    else if (m.type === MSG.SNAPSHOT) {
      this.snapshots.push(m);
      if (this.snapshots.length > 12) this.snapshots.shift();
      if (this.onSnapshot) this.onSnapshot(m);
    }
    else if (m.type === MSG.EMOTE) { if (this.onEmote) this.onEmote(m); }
    else if (m.type === MSG.EVENT_HIT) { if (this.onHit) this.onHit(m); }
    else if (m.type === MSG.EVENT_FIRE) { if (this.onFire) this.onFire(m); }
    else if (m.type === MSG.ACCOUNT) { if (this.onAccount) this.onAccount(m); }
    else if (m.type === MSG.AWARD) { if (this.onAward) this.onAward(m); }
    else if (m.type === MSG.BOARD_DATA) { if (this.onBoard) this.onBoard(m); }
    else if (m.type === MSG.BUY_OK) { if (this.onBuy) this.onBuy(m); }
    else if (m.type === MSG.REVIVE_OK) { if (this.onReviveOk) this.onReviveOk(m); }
    else if (m.type === MSG.PONG) { this.lastRtt = performance.now() - this._pingT; }
    else if (m.type === MSG.ERROR) {
      if (m.correct && this.onError) this.onError(m);
      else if (this.onError) this.onError(m);
    }
  }

  // Reconciliation for the local car. Returns corrected {x,z} or null.
  reconcile(localPos) {
    if (!this.snapshots.length || !this.clientId) return null;
    const latest = this.snapshots[this.snapshots.length - 1];
    const me = latest.cars.find((c) => c.id === this.clientId);
    if (!me) return null;
    const dx = me.x - localPos.x, dz = me.z - localPos.z;
    const err = Math.hypot(dx, dz);
    if (err > RECONCILE_SNAP_DIST) { this.corrections++; return { x: me.x, z: me.z, snapped: true, err }; }
    if (err > 1.2) return { x: localPos.x + dx * RECONCILE_LERP, z: localPos.z + dz * RECONCILE_LERP, snapped: false, err };
    return null;
  }

  // Interpolated remote cars at (now - SNAP_DELAY_MS).
  getRemoteStates() {
    if (!this.snapshots.length) return [];
    const target = performance.now() - SNAP_DELAY_MS;
    // snapshots use Date.now() t; performance vs Date mismatch — use relative index instead:
    // newest-2 and newest-1 bracket the render time at 20Hz/100ms delay.
    const n = this.snapshots.length;
    const a = this.snapshots[Math.max(0, n - 3)], b = this.snapshots[n - 1];
    void target;
    if (!a || !b || a === b) return b.cars.filter((c) => c.id !== this.clientId);
    const out = [];
    for (const cb of b.cars) {
      if (cb.id === this.clientId) continue;
      const ca = a.cars.find((c) => c.id === cb.id);
      if (!ca) { out.push({ ...cb }); continue; }
      const f = 0.5; // midpoint between two 50ms-apart snapshots ≈ 100ms-delayed smooth
      out.push({ ...cb, x: ca.x + (cb.x - ca.x) * f, z: ca.z + (cb.z - ca.z) * f, yaw: ca.yaw + (cb.yaw - ca.yaw) * f });
    }
    return out;
  }
}

export function defaultServerURL() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:8130`;
}
