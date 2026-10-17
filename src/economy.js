// economy.js — server-separable economy + progression, no THREE imports.
// Plain JS so it can run headless later. Sync localStorage mirror (Phase 2) is kept
// for 60Hz gameplay; Phase 3 `storage.js` adds IndexedDB primary + migration + match history.
export const REVIVE_COSTS = [1, 5, 30]; // gem cost per revive tier — after 3 revives, permanent wreck

export const COINS_PER_KILL_TOKEN = 12; // each token value
export const TOKENS_PER_KILL = 4; // dropped on wreck
export const TOKEN_LIFETIME = 18; // seconds before despawn
export const TOKEN_COLLECT_RADIUS = 3.6;

export const XP_REWARDS = {
  kill: 18,
  token: 0,
  finish: [120, 80, 52, 32, 18, 10], // P1..P6
  coinsBonusFactor: 0, // not XP
};

export const GARAGE_SKINS = [
  // Phase 14: limited cosmetic skins, gold only (never vehicles/upgrades).
  { id:'default', name:'STOCK RED', color:0xff2d2d, price:0, currency:'gold', limited:false },
  { id:'frost',   name:'FROST BLUE', color:0x2d7dff, price:200, currency:'gold', limited:true },
  { id:'toxic',   name:'TOXIC GREEN', color:0x2ecc71, price:200, currency:'gold', limited:true },
  { id:'midnight',name:'MIDNIGHT', color:0x0a0a14, price:200, currency:'gold', limited:true },
  { id:'neon',    name:'NEON VIOLET', color:0xcc2dff, price:200, currency:'gold', limited:true },
  { id:'inferno', name:'INFERNO', color:0xff5a00, price:500, currency:'gold', limited:true },
  { id:'glacier', name:'GLACIER', color:0x9ff0ff, price:500, currency:'gold', limited:true },
  { id:'gold',    name:'SOL CHROME', color:0xffcc00, price:500, currency:'gold', limited:true },
  { id:'stealth', name:'STEALTH', color:0x23232e, price:500, currency:'gold', limited:true },
];

// tiers by level (header levels)
const TIERS = [
  { name:'Bronze',   min:1,  max:5,  color:'#cd7f32' },
  { name:'Silver',   min:6,  max:10, color:'#c0c0c0' },
  { name:'Ruby',     min:11, max:16, color:'#e02040' },
  { name:'Platinum', min:17, max:22, color:'#70e0ff' },
  { name:'Diamond',  min:23, max:30, color:'#4df0ff' },
  { name:'Master',   min:31, max:999,color:'#ff3bff' },
];

export function getTier(level){
  for(const t of TIERS) if(level>=t.min && level<=t.max) return t;
  return TIERS[TIERS.length-1];
}
export function xpForLevel(level){
  // total XP needed to reach level (level 1 = 0 XP)
  if(level<=1) return 0;
  // curve: 110 * (level-1) + 18*(level-1)*(level-2)/2  ~ gentle quadratic
  let xp=0;
  for(let l=1;l<level;l++) xp += 110 + (l-1)*18;
  return xp;
}
export function getLevelFromXP(xp){
  let lvl=1;
  while(xp >= xpForLevel(lvl+1)) lvl++;
  return lvl;
}
export function getReviveCost(revivesUsed){
  if(revivesUsed >= REVIVE_COSTS.length) return null; // permanent
  return REVIVE_COSTS[revivesUsed];
}

import { lsKey } from './identity.js';

// STEP 2 — per-account mirror of the profile.
// This was the hard-coded string 'rk.profile.v2', i.e. the ONE device-scoped
// record migrateLegacyStorage() has already claimed and abandoned. Every
// saveProfile() below was therefore writing the active player's coins, kills
// and stats back onto that shared legacy key — precisely the bridge this
// change exists to close. It now names the active account's own key, which is
// the same key storage.js writes, so the two writers stay consistent.
// The raw legacy string survives only as storage.js:LEGACY_PROFILE_KEY, the
// one-shot migration source.
const storageKey = () => lsKey('profile.v2');

export function createDefaultProfile(){
  return {
    coins: 80,
    gems: 14,
    gold: 0, // Phase 14: rare premium, feat-earned only
    xp: 0,
    level: 1,
    tier: getTier(1).name,
    unlockedSkins: ['default'],
    equippedSkin: 'default',
    stats: { races:0, wins:0, kills:0, coinsCollected:0, bestPos:6 },
    seasonPoints: 0,
    seasonClaimed: [],
    version: 2,
  };
}

export function loadProfile(){
  try{
    const raw = localStorage.getItem(storageKey());
    if(!raw) return createDefaultProfile();
    const p = JSON.parse(raw);
    // migrate / fill defaults
    if(!p.unlockedSkins) p.unlockedSkins=['default'];
    if(!p.equippedSkin) p.equippedSkin='default';
    if(typeof p.coins!=='number') p.coins = (typeof p.money==='number') ? p.money : 80;
    delete p.money; // Phase 14: money renamed to coins
    if(typeof p.gold!=='number') p.gold=0;
    if(typeof p.gems!=='number') p.gems=14;
    if(typeof p.xp!=='number') p.xp=0;
    p.level = getLevelFromXP(p.xp);
    p.tier = getTier(p.level).name;
    if(!p.stats) p.stats={races:0,wins:0,kills:0,coinsCollected:0,bestPos:6};
    return p;
  }catch{
    return createDefaultProfile();
  }
}

export function saveProfile(profile){
  try{
    profile.level = getLevelFromXP(profile.xp);
    profile.tier = getTier(profile.level).name;
    localStorage.setItem(storageKey(), JSON.stringify(profile));
  }catch{}
}

export function addCoins(profile, amount){
  profile.coins += amount;
  profile.stats.coinsCollected = (profile.stats.coinsCollected||0) + amount;
  saveProfile(profile);
  return profile.coins;
}
export function addGems(profile, amount){
  profile.gems = Math.max(0, profile.gems + amount);
  saveProfile(profile);
  return profile.gems;
}
// Phase 14: gold is rare premium — feat-earned (server-minted online), skins-only.
export function addGold(profile, amount){
  profile.gold = Math.max(0, (profile.gold || 0) + amount);
  saveProfile(profile);
  return profile.gold;
}
export function addXP(profile, amount){
  const before = getLevelFromXP(profile.xp);
  profile.xp += amount;
  const after = getLevelFromXP(profile.xp);
  saveProfile(profile);
  return { levelUp: after>before, before, after, gained: amount };
}
export function canAffordRevive(profile, revivesUsed){
  const cost = getReviveCost(revivesUsed);
  if(cost==null) return { can:false, cost:null, reason:'permanent' };
  return { can: profile.gems >= cost, cost, reason: profile.gems>=cost?'ok':'gems' };
}
export function payRevive(profile, revivesUsed){
  const cost = getReviveCost(revivesUsed);
  if(cost==null) return { ok:false, reason:'permanent' };
  if(profile.gems < cost) return { ok:false, reason:'gems' };
  profile.gems -= cost;
  saveProfile(profile);
  return { ok:true, cost };
}
export function buySkin(profile, skinId){
  const skin = GARAGE_SKINS.find(s=>s.id===skinId);
  if(!skin) return { ok:false, reason:'notfound' };
  if(profile.unlockedSkins.includes(skinId)) return { ok:false, reason:'owned' };
  // Phase 14: skins cost gold only (limited cosmetics, never power).
  if((profile.gold || 0) < skin.price) return { ok:false, reason:'gold' };
  profile.gold -= skin.price;
  profile.unlockedSkins.push(skinId);
  saveProfile(profile);
  return { ok:true, skin };
}
export function equipSkin(profile, skinId){
  if(!profile.unlockedSkins.includes(skinId)) return { ok:false, reason:'locked' };
  profile.equippedSkin = skinId;
  saveProfile(profile);
  return { ok:true };
}

// world tokens — plain state
export function createCoinToken(id, pos, amount=COINS_PER_KILL_TOKEN){
  return {
    id,
    pos: { x: pos.x, y: 0.18, z: pos.z },
    amount,
    alive: true,
    life: TOKEN_LIFETIME,
    bob: Math.random()*Math.PI*2,
  };
}
