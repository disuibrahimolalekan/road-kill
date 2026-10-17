// liveops.js — Phase 6 seasons, daily challenges. No THREE.
// Season S1: every XP earned adds seasonPoints. Reward thresholds grant gems.
// Daily: one claim per calendar day for finishing any race (+$100).
import { dailyChallenge } from './tracks.js';
import { SEASON_ID } from './netproto.js';

export { SEASON_ID };
export const DAILY_BONUS_COINS = 100;
const DAILY_KEY = 'rk.daily.v1';

export const SEASON_REWARDS = [
  { points: 200, gems: 3, label: 'S1 Rookie — 3 gems' },
  { points: 600, gems: 8, label: 'S1 Contender — 8 gems' },
  { points: 1500, gems: 20, label: 'S1 Champion — 20 gems' },
];

export function getDailyState() {
  const today = dailyChallenge().seed;
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return { today, claimed: s.claimedFor === today, challenge: dailyChallenge() };
  } catch { return { today, claimed: false, challenge: dailyChallenge() }; }
}

export function claimDaily() {
  const { today, claimed, challenge } = getDailyState();
  if (claimed) return { ok: false, reason: 'claimed' };
  try { localStorage.setItem(DAILY_KEY, JSON.stringify({ claimedFor: today })); } catch {}
  return { ok: true, coins: challenge.bonusCoins };
}

// Season points live on the profile (synced like XP). Returns newly unlocked rewards.
export function seasonProgress(profile) {
  const pts = profile.seasonPoints || 0;
  const claimed = profile.seasonClaimed || [];
  const next = SEASON_REWARDS.find((r) => pts >= r.points && !claimed.includes(r.points));
  return { pts, claimed, next, rewards: SEASON_REWARDS };
}

export function claimSeasonReward(profile, points) {
  const r = SEASON_REWARDS.find((x) => x.points === points);
  if (!r) return { ok: false };
  profile.seasonClaimed = profile.seasonClaimed || [];
  if ((profile.seasonPoints || 0) < points || profile.seasonClaimed.includes(points)) return { ok: false };
  profile.seasonClaimed.push(points);
  profile.gems = (profile.gems || 0) + r.gems;
  return { ok: true, gems: r.gems, label: r.label };
}
