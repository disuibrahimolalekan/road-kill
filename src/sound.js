// sound.js — Phase 9 procedural SFX with per-weapon sound hooks.
// WebAudio synth, no files needed (works offline). To ship real sounds later,
// drop files into game/public/sounds/<name>.mp3 and add the name to SOUND_FILES
// below — file playback then takes precedence over synth.
export const SOUND_HOOKS = {
  mg: 'mg', rocket: 'rocket', mine: 'mine', shield: 'shield',
  plasma: 'plasma', railgun: 'railgun', emp: 'emp', swarm: 'swarm',
  explosion: 'explosion', pickup: 'pickup', revive: 'revive', ui: 'ui',
  jump: 'jump', out: 'out', blockbreak: 'blockbreak', empty: 'empty',
};
export const SOUND_FILES = {}; // e.g. { plasma: 'sounds/plasma.mp3' }

let ctx = null;
function ac() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
export function audioEnabled() {
  try { return JSON.parse(localStorage.getItem('rk.settings.v1') || '{}').audio !== false; }
  catch { return true; }
}
function tone({ f = 440, f2 = 0, t = 0.12, type = 'square', vol = 0.12, delay = 0 }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + t);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + t + 0.02);
}
function noise({ t = 0.25, vol = 0.2, fc = 1200, delay = 0 }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * t));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = fc;
  const g = c.createGain(); g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + t);
  src.connect(flt).connect(g).connect(c.destination);
  src.start(t0);
}

export function sfx(name) {
  if (!audioEnabled()) return;
  // unlock on first gesture: browsers need it; calls before that no-op safely.
  try {
    if (SOUND_FILES[name]) {
      const el = new Audio(SOUND_FILES[name]);
      el.volume = 0.5;
      el.play().catch(() => synth(name));
      return;
    }
  } catch {}
  synth(name);
}
function synth(name) {
  switch (name) {
    case 'mg': tone({ f: 900, f2: 300, t: 0.07 }); break;
    case 'rocket': noise({ t: 0.3, vol: 0.25, fc: 900 }); tone({ f: 220, f2: 90, t: 0.25, type: 'sawtooth' }); break;
    case 'plasma': tone({ f: 1400, f2: 350, t: 0.16, type: 'sawtooth', vol: 0.14 }); break;
    case 'railgun': noise({ t: 0.12, vol: 0.2, fc: 5200 }); tone({ f: 2400, f2: 2400, t: 0.2, type: 'sine', vol: 0.1, delay: 0.03 }); break;
    case 'emp': tone({ f: 160, f2: 55, t: 0.5, type: 'sine', vol: 0.2 }); tone({ f: 1200, f2: 200, t: 0.2, type: 'triangle', vol: 0.08 }); break;
    case 'swarm': for (let i = 0; i < 3; i++) tone({ f: 700 + i * 250, f2: 1200 + i * 250, t: 0.08, delay: i * 0.06 }); break;
    case 'mine': tone({ f: 500, f2: 500, t: 0.09, type: 'sine' }); break;
    case 'shield': tone({ f: 400, f2: 900, t: 0.2, type: 'sine', vol: 0.12 }); break;
    case 'explosion': noise({ t: 0.5, vol: 0.3, fc: 700 }); tone({ f: 120, f2: 35, t: 0.4, type: 'sine', vol: 0.2 }); break;
    case 'pickup': tone({ f: 660, t: 0.07, type: 'sine' }); tone({ f: 990, t: 0.09, type: 'sine', delay: 0.07 }); break;
    case 'revive': tone({ f: 520, f2: 1040, t: 0.25, type: 'triangle' }); break;
    case 'jump': tone({ f: 300, f2: 700, t: 0.12, type: 'sine' }); break;
    case 'out': tone({ f: 400, f2: 120, t: 0.5, type: 'sawtooth', vol: 0.12 }); break;
    case 'blockbreak': noise({ t: 0.18, vol: 0.2, fc: 2000 }); break;
    case 'empty': tone({ f: 180, t: 0.06, type: 'square', vol: 0.07 }); break;
    default: tone({ f: 600, t: 0.06 });
  }
}
