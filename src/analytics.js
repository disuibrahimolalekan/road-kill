// analytics.js — Phase 6 analytics + crash reporting stub. No THREE.
// Local-first event buffer (localStorage, capped). Flush shape matches a
// future POST /api/events endpoint. No PII: counts + timings only.
const KEY = 'rk.events.v1';
const MAX = 200;

export function logEvent(type, data = {}) {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), type: String(type).slice(0, 32), ...data });
    while (arr.length > MAX) arr.shift();
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {}
}

export function getEvents() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

export async function flushEvents() {
  const evs = getEvents();
  if (!evs.length) return { sent: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, reason: 'offline' };
  // No backend yet — drop after counting, shaped like POST /api/events.
  try { localStorage.setItem(KEY, '[]'); } catch {}
  return { sent: evs.length };
}

export function installCrashReporter() {
  addEventListener('error', (e) => {
    logEvent('crash', { msg: String(e.message || 'err').slice(0, 120) });
  });
  addEventListener('unhandledrejection', (e) => {
    logEvent('crash', { msg: String((e.reason && e.reason.message) || 'reject').slice(0, 120) });
  });
}
