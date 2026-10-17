// tracks.js — Phase 6 track roster. Plain [x,z] arrays (no THREE) so the
// server or a headless sim can reuse them later. 10 control points each.
export const TRACKS = [
  {
    id: 'sunset',
    name: 'SUNSET LOOP',
    desc: 'Balanced club circuit',
    points: [
      [-85, 0], [-70, 62], [-20, 88], [45, 78], [92, 32],
      [98, -28], [62, -82], [0, -96], [-58, -72], [-92, -30],
    ],
  },
  {
    id: 'canyon',
    name: 'NEON CANYON',
    desc: 'Tight S-curves, late braking',
    points: [
      [-90, -10], [-78, 55], [-38, 40], [-30, 85], [25, 70],
      [20, 20], [70, 30], [95, -25], [40, -60], [-45, -75],
    ],
  },
  {
    id: 'volcano',
    name: 'VOLCANO RING',
    desc: 'Fast ring + chicane',
    points: [
      [-80, -40], [-60, 50], [0, 90], [70, 70], [100, 0],
      [70, -60], [30, -45], [10, -85], [-40, -70], [-95, -80],
    ],
  },
];

export function dailySeed(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Daily challenge: deterministic per date. Bonus for finishing any race.
export function dailyChallenge(date = new Date()) {
  const seed = dailySeed(date);
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const tracks = ['sunset', 'canyon', 'volcano'];
  return {
    seed,
    title: `Daily: race ${tracks[Math.abs(h) % 3].toUpperCase()} — finish = +$100`,
    trackId: tracks[Math.abs(h) % 3],
    bonusCoins: 100,
  };
}
