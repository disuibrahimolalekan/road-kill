// combat.js — server-ready combat sim, no THREE rendering here (only Vector math via plain objects + THREE.Vector3 if available)
// All state is plain JS so it can run headless later.
export const CAR_MAX_HP = 100;

export const WEAPON_DEFS = {
  rocket: {
    id:'rocket', label:'ROCKET', icon:'rocket',
    ammo: 5, damage: 34, speed: 68, cooldown: 0.48, lifetime: 3.2, radius: 0.7,
    ttl: 12, // weapon expires after 12s
    color: 0xff3b30,
  },
  mg: {
    id:'mg', label:'M-GUN', icon:'gun',
    ammo: 70, damage: 8, speed: 108, cooldown: 0.092, lifetime: 1.35, radius: 0.35,
    ttl: 10, spread: 0.045,
    color: 0xffcc00,
  },
  mine: {
    id:'mine', label:'MINE', icon:'mine',
    ammo: 3, damage: 54, cooldown: 0.72, lifetime: 22, radius: 0.9,
    ttl: 14, triggerRadius: 4.2, explosionRadius: 11,
    color: 0x8a2be2,
  },
  shield: {
    id:'shield', label:'SHIELD', icon:'shield',
    ammo: 1, damage: 0, cooldown: 0, lifetime: 0, radius: 0,
    ttl: 5, shieldDuration: 5.2,
    color: 0x2de2ff,
  },
  // Phase 9 sci-fi arsenal (original designs). Each: own effect, sound hook (see sound.js SOUND_HOOKS), ammo rule.
  plasma: {
    id:'plasma', label:'PLASMA', icon:'plasma',
    ammo: 8, damage: 22, speed: 85, cooldown: 0.34, lifetime: 2.0, radius: 0.5,
    ttl: 12, splash: 3.5,
    color: 0x39ff88,
  },
  railgun: {
    id:'railgun', label:'RAILGUN', icon:'railgun',
    ammo: 3, damage: 55, speed: 220, cooldown: 1.1, lifetime: 1.2, radius: 0.5,
    ttl: 12,
    color: 0x66ccff,
  },
  emp: {
    id:'emp', label:'EMP', icon:'emp',
    ammo: 2, damage: 6, speed: 70, cooldown: 0.8, lifetime: 2.5, radius: 0.6,
    ttl: 12, empTime: 3,
    color: 0xffe14d,
  },
  swarm: {
    id:'swarm', label:'SWARM', icon:'swarm',
    ammo: 2, damage: 12, speed: 62, cooldown: 0.9, lifetime: 2.8, radius: 0.4,
    ttl: 12, homing: 0.09, volley: 5,
    color: 0xff8a3d,
  },
};

export const REVIVE_COSTS = [1, 5, 30];
export function getReviveCostForState(cstate){
  if(cstate.permanentWreck) return null;
  if(cstate.revivesUsed >= REVIVE_COSTS.length) return null;
  return REVIVE_COSTS[cstate.revivesUsed];
}
export function canRevive(cstate){
  return cstate.wrecked && !cstate.permanentWreck && getReviveCostForState(cstate)!=null;
}
export function doRevive(cstate, gameTime){
  if(!canRevive(cstate)) return false;
  cstate.revivesUsed++;
  cstate.wrecked=false;
  cstate.permanentWreck=false;
  cstate.awaitingRevive=false;
  cstate.health=cstate.maxHealth || CAR_MAX_HP;
  cstate.invuln=1.6;
  cstate.shield=0;
  cstate.weapon=null;
  // Phase 9: refill all mounts to their per-race ammo
  if(Array.isArray(cstate.mounts)) for(const m of cstate.mounts) m.ammo = m.raceAmmo ?? m.ammo;
  cstate.mountedCd = 0;
  cstate.disabled = 0;
  syncMount(cstate);
  cstate.lastAttacker=null;
  cstate.wreckTime=0;
  cstate.respawnAt=0;
  return true;
}

// Phase 8: every car carries a mounted (non-expiring) M-Gun with finite ammo.
// Pickup weapons are bonus extras that still expire and take precedence.
export const MOUNTED_DEF = { type: 'mg', startAmmo: 150, maxAmmo: 300, reviveAmmo: 120 };
export function createCombatState(id, isPlayer=false){
  const s = {
    id,
    isPlayer,
    health: CAR_MAX_HP,
    maxHealth: CAR_MAX_HP,
    wrecked: false,
    wreckTime: 0,
    respawnAt: 0, // gameTime when respawn — Phase 2: not auto, used only if revived
    invuln: 0, // seconds left
    shield: 0, // shield timer
    weapon: null, // {type, ttl, ammo, cooldown}
    mounts: [{ type: 'mg', ammo: 150, raceAmmo: 150 }], // Phase 9 mount slots
    mountIdx: 0,
    mounted: null, // ref to mounts[mountIdx] — synced by syncMount
    mountedCd: 0,
    disabled: 0, // Phase 9 EMP: seconds with no fire/boost
    kills: 0,
    deaths: 0,
    revivesUsed: 0,
    permanentWreck: false,
    awaitingRevive: false,
    lastAttacker: null,
    damageFlash: 0,
  };
  syncMount(s);
  return s;
}

// Mount slots: every vehicle has 1-2. Cycle with Q / SLOT button.
export function syncMount(cstate){
  if(!Array.isArray(cstate.mounts) || !cstate.mounts.length)
    cstate.mounts = [{ type: 'mg', ammo: 150, raceAmmo: 150 }];
  cstate.mountIdx = Math.max(0, Math.min(cstate.mounts.length - 1, cstate.mountIdx | 0));
  cstate.mounted = cstate.mounts[cstate.mountIdx];
  return cstate.mounted;
}
// mounts: [{type, ammo, raceAmmo}] built from profile (shop raceAmmo).
export function resetMounts(cstate, mounts){
  cstate.mounts = (mounts && mounts.length ? mounts : [{ type: 'mg' }])
    .map((m) => ({ type: m.type, ammo: m.ammo ?? 150, raceAmmo: m.raceAmmo ?? m.ammo ?? 150 }));
  cstate.mountIdx = 0;
  cstate.mountedCd = 0;
  return syncMount(cstate);
}
export function cycleMount(cstate){
  if(!cstate.mounts || cstate.mounts.length < 2) return cstate.mounted;
  cstate.mountIdx = (cstate.mountIdx + 1) % cstate.mounts.length;
  return syncMount(cstate);
}

export function giveWeapon(cstate, type){
  const def = WEAPON_DEFS[type];
  if(!def) return;
  // one slot: replace
  cstate.weapon = {
    type,
    ttl: def.ttl,
    ammo: def.ammo,
    cooldown: 0,
    shieldTime: type==='shield' ? def.shieldDuration : 0,
  };
  if(type==='shield'){
    cstate.shield = def.shieldDuration;
    cstate.invuln = def.shieldDuration; // shield gives invuln
  }
}

export function addMountedAmmo(cstate, n){
  if(!cstate.mounted) cstate.mounted = { type: 'mg', ammo: 0, raceAmmo: 0 };
  cstate.mounted.ammo = Math.min(MOUNTED_DEF.maxAmmo, cstate.mounted.ammo + n);
  return cstate.mounted.ammo;
}
// Ammo-can refills every mount a little (mg lots, exotics sparingly).
export function refillMountsPickup(cstate){
  if(!Array.isArray(cstate.mounts)) return;
  for(const m of cstate.mounts){
    const bonus = m.type === 'mg' ? 60 : 2;
    m.ammo = Math.min((m.raceAmmo || 0) * 2, m.ammo + bonus);
  }
  syncMount(cstate);
}

// Which gun fires now: expiring pickup weapon first, else the mounted reserve.
export function activeGun(cstate){
  if(cstate.weapon && cstate.weapon.type !== 'shield' && cstate.weapon.ammo > 0) return 'weapon';
  if(cstate.mounted && cstate.mounted.ammo > 0) return 'mounted';
  return null;
}

export function tickCombatStates(states, dt, gameTime, onExpire){
  for(const s of states){
    if(s.invuln>0) s.invuln = Math.max(0, s.invuln - dt);
    if(s.shield>0) s.shield = Math.max(0, s.shield - dt);
    if(s.disabled>0) s.disabled = Math.max(0, s.disabled - dt); // Phase 9 EMP
    if(s.mountedCd>0) s.mountedCd = Math.max(0, s.mountedCd - dt);
    if(s.damageFlash>0) s.damageFlash = Math.max(0, s.damageFlash - dt);
    if(s.wrecked){
      // waiting to respawn handled outside
    }
    if(s.weapon){
      s.weapon.ttl -= dt;
      if(s.weapon.cooldown>0) s.weapon.cooldown -= dt;
      if(s.weapon.ttl <= 0){
        const expired = s.weapon.type;
        s.weapon = null;
        if(onExpire) onExpire(s, expired);
      }
    }
  }
}

export function canFire(cstate){
  if(cstate.wrecked) return false;
  if(cstate.disabled>0) return false; // Phase 9 EMP
  if(cstate.weapon && cstate.weapon.type !== 'shield'){
    if(cstate.weapon.cooldown>0) return false;
    if(cstate.weapon.ammo>0) return true;
    // pickup present but empty -> fall through to mounted
  } else if(cstate.weapon && cstate.weapon.type === 'shield'){
    return false;
  }
  if(!cstate.mounted || cstate.mounted.ammo<=0) return false;
  if(cstate.mountedCd>0) return false;
  return true;
}

// projectile store — pure array, updated externally
export function createProjectile(ownerId, type, pos, yaw, speedBoost=0){
  const def = WEAPON_DEFS[type];
  if(!def) return null;
  // for mine, projectile is static drop
  if(type==='mine'){
    return {
      id: Math.random().toString(36).slice(2,7),
      ownerId, type,
      pos: {x:pos.x, y:0.2, z:pos.z},
      vel: {x:0,y:0,z:0},
      yaw,
      life: def.lifetime,
      damage: def.damage,
      radius: def.radius,
      alive: true,
      armed: 0.45, // time before active
      triggerRadius: def.triggerRadius,
    };
  }
  const speed = def.speed + speedBoost;
  const spread = def.spread ? (Math.random()-0.5)*def.spread : 0;
  const ayaw = yaw + spread;
  const base = {
    id: Math.random().toString(36).slice(2,7),
    ownerId, type,
    pos: {x:pos.x, y:0.55, z:pos.z},
    vel: {x: Math.sin(ayaw)*speed, y:0, z: Math.cos(ayaw)*speed},
    yaw: ayaw,
    life: def.lifetime,
    damage: def.damage,
    radius: def.radius,
    alive: true,
  };
  if(def.homing) base.homing = def.homing;
  if(def.splash) base.splash = def.splash;
  if(def.empTime) base.empTime = def.empTime;
  return base;
}

export function fireWeapon(cstate, pos, yaw, speed){
  if(cstate.wrecked) return null;
  const gun = activeGun(cstate);
  if(!gun) return null;
  if(gun === 'weapon'){
    const type = cstate.weapon.type;
    if(type==='shield') return null; // shield not fired
    if(cstate.weapon.cooldown>0) return null;
    const def = WEAPON_DEFS[type];
    cstate.weapon.ammo--;
    cstate.weapon.cooldown = def.cooldown;
    const n = def.volley || 1;
    if(n === 1) return createProjectile(cstate.id, type, pos, yaw, Math.min(12, speed*0.35));
    const shots = [];
    for(let i=0;i<n;i++)
      shots.push(createProjectile(cstate.id, type, pos, yaw + (i - (n-1)/2) * 0.14, Math.min(12, speed*0.35)));
    return shots;
  }
  // mounted weapon reserve (finite, non-expiring) — any mountable type
  if(!cstate.mounted) syncMount(cstate);
  if(cstate.mountedCd>0 || cstate.mounted.ammo<=0) return null;
  const mdef = WEAPON_DEFS[cstate.mounted.type] || WEAPON_DEFS.mg;
  cstate.mounted.ammo--;
  cstate.mountedCd = mdef.cooldown;
  const shots = [];
  const n = mdef.volley || 1;
  for(let i=0;i<n;i++){
    const spreadYaw = n > 1 ? yaw + (i - (n-1)/2) * 0.14 : yaw;
    shots.push(createProjectile(cstate.id, mdef.id, pos, spreadYaw, Math.min(12, speed*0.35)));
  }
  return n > 1 ? shots : shots[0];
}

// Phase 9 pickup branch also supports volley (swarm pickup).
export function firePickupVolley(cstate, pos, yaw, speed){
  const out = fireWeapon(cstate, pos, yaw, speed);
  if(!out) return null;
  return Array.isArray(out) ? out : [out];
}

export function applyDamage(targetState, amount, attackerId, gameTime){
  if(targetState.wrecked) return {killed:false, damage:0};
  if(targetState.invuln>0 || targetState.shield>0) return {killed:false, damage:0, blocked:true};
  if(targetState.permanentWreck) return {killed:false, damage:0};
  targetState.health -= amount;
  targetState.damageFlash = 0.28;
  if(attackerId!=null) targetState.lastAttacker = attackerId;
  if(targetState.health <= 0){
    targetState.health = 0;
    targetState.wrecked = true;
    targetState.awaitingRevive = true;
    targetState.wreckTime = gameTime;
    targetState.respawnAt = 0; // Phase 2: wait for gem payment, not auto
    targetState.deaths++;
    // if this was the last allowed wreck, mark permanent after revive window closes without payment
    // permanent is enforced when tryRevive fails due to cost null
    return {killed:true, damage:amount};
  }
  return {killed:false, damage:amount};
}

// Phase 1 compat: autoRespawn still works if something calls it (Phase 2 uses doRevive instead)
export function tryRespawn(cstate, gameTime){
  if(!cstate.wrecked) return false;
  // Phase 2 tiered: never auto-respawn — must pay gems via doRevive
  // Keep for headless tests / legacy: only auto if revivesUsed==0 and no gem system
  if(cstate.respawnAt && gameTime >= cstate.respawnAt){
    // legacy path — not used in Phase 2 race (respawnAt is 0)
    cstate.wrecked = false;
    cstate.awaitingRevive=false;
    cstate.health = CAR_MAX_HP;
    cstate.invuln = 1.6;
    cstate.shield = 0;
    cstate.weapon = null;
    cstate.lastAttacker = null;
    return true;
  }
  return false;
}

// pickups — placed on track
export function generatePickupPositions(sampled, count=10){
  const out=[];
  for(let i=0;i<count;i++){
    const t = (i+0.5)/count; // even around
    const idx = Math.floor(t * sampled.length) % sampled.length;
    const base = sampled[idx];
    // lateral offset random -6..6
    const jitter = (Math.random()-0.5)*7;
    out.push({idx, jitter, baseIdx: idx});
  }
  return out;
}

export function createPickupState(id, trackIdx, pos){
  const types = ['rocket','mg','mine','shield'];
  // weighted
  const roll = Math.random();
  let type;
  if(roll<0.32) type='rocket';
  else if(roll<0.62) type='mg';
  else if(roll<0.82) type='mine';
  else type='shield';
  return {
    id, type, trackIdx,
    pos: {x:pos.x, y:0.2, z:pos.z},
    alive: true,
    respawnIn: 0,
    spin: Math.random()*Math.PI*2,
  };
}

export function rollPickupType(){
  const r=Math.random();
  if(r<0.33) return 'rocket';
  if(r<0.63) return 'mg';
  if(r<0.82) return 'mine';
  return 'shield';
}
