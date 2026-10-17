import * as THREE from 'three';
import {
  CAR_MAX_HP, WEAPON_DEFS,
  createCombatState, giveWeapon, tickCombatStates,
  canFire, fireWeapon, createProjectile, applyDamage, tryRespawn,
  createPickupState, rollPickupType,
  getReviveCostForState, canRevive, doRevive,
  addMountedAmmo, activeGun, resetMounts, cycleMount, syncMount, refillMountsPickup
} from './combat.js';
import {
  COINS_PER_KILL_TOKEN, TOKENS_PER_KILL, TOKEN_LIFETIME, TOKEN_COLLECT_RADIUS, XP_REWARDS, GARAGE_SKINS,
  getTier, xpForLevel, getLevelFromXP, getReviveCost,
  loadProfile, saveProfile, addCoins, addGems, addXP, canAffordRevive, payRevive, buySkin, equipSkin, createCoinToken, createDefaultProfile
} from './economy.js';
import {
  loadProfileUnified, saveProfileUnified, loadSettings, saveSettings,
  recordMatch, getMatches, enqueueSyncOp, getSyncQueueCount, flushSyncQueueStub,
  registerServiceWorker
} from './storage.js';
import { NetClient, QUICK_CHAT, defaultServerURL, resolveServerURL, rememberServerURL } from './net.js';
import { getAccountId, setAccountId, exportSyncCode, importSyncCode, supabaseSync } from './backend.js';
import { TRACKS } from './tracks.js';
import SHOP_CONFIG from '../shop-config.json';
import BANNERS_CONFIG from '../banners-config.json';
import {
  setShopConfig, vehicle as vehicleSpec, vehicleStats, upgLevels,
  upgradeCost, maxUpgradeLevel, priceText,
  buyVehicle, buyUpgrade, buyWeapon, equipVehicle, setMount,
  mountableWeapons, migrateShop, CLASSES, CLASS_NAMES, shopWeapon
} from './vehicles.js';
import { sfx, SOUND_HOOKS } from './sound.js';
setShopConfig(SHOP_CONFIG);
import {
  FUEL_MAX, FUEL_START, fuelDrain, perfFactor,
  FUEL_PICKUP, FUEL_PER_LAP, FUEL_REVIVE, AMMO_PICKUP,
  BLOCK_TYPES, BLOCK_COUNT, BLOCK_RESPAWN_S, BLOCK_RAM_DMG,
  genRoadblocks,
  SHORTCUT_DEFS, HAZARD_DEFS, HAZARD_TUNING, RAMP_DEFS, RAMP_VY, SHORTCUT_BONUS,
  advanceCheckpoint
} from './rules.js';
import { SEASON_ID, SEASON_REWARDS, getDailyState, claimDaily, seasonProgress, claimSeasonReward } from './liveops.js';
import { logEvent, flushEvents, installCrashReporter } from './analytics.js';

// ---------- CONFIG ----------
const TOTAL_LAPS = 3;
const ROAD_WIDTH = 22;
const WALL_HEIGHT = 2.2;
const TRACK_SAMPLES = 220;
const CHECKPOINTS = 14;
const MAX_SPEED = 42;
const BOOST_MULT = 1.55;
const AI_COUNT = 5;
const PICKUP_COUNT = 10;

// ---------- DOM ----------
const canvas = document.getElementById('c');
const miniCanvas = document.getElementById('mini');
const miniCtx = miniCanvas.getContext('2d');
const lapEl = document.getElementById('lap');
const speedEl = document.getElementById('speed');
const posEl = document.getElementById('pos');
const positionsEl = document.getElementById('positions');
const centerMsg = document.getElementById('center-msg');
const healthFill = document.getElementById('healthfill');
const boostBtn = document.getElementById('boostBtn');
const fireBtn = document.getElementById('fireBtn');
// Phase 7 controls DOM
const jumpBtn = document.getElementById('jumpBtn');
const camBtn = document.getElementById('camBtn');
const todBtn = document.getElementById('todBtn');
const perfHUD = document.getElementById('perfHUD');
const setQuality = document.getElementById('setQuality');
const setTOD = document.getElementById('setTOD');
let camMode = 0; // 0 chase, 1 hood, 2 far
const CAM_NAMES = ['CHASE', 'HOOD', 'FAR'];
// ---------- PHASE 16 — phone experience: orientation, fullscreen, viewport, HUD scale ----------
const rotatePrompt = document.getElementById('rotatePrompt');
let portraitBlocked = false;
let wasPausedBeforeRotate = false;
function updateOrientation(){
  if (!rotatePrompt) return;
  const portrait = innerHeight > innerWidth;
  const small = Math.min(innerWidth, innerHeight) < 900; // phones + small tablets
  const shouldBlock = portrait && small;
  portraitBlocked = shouldBlock;
  rotatePrompt.classList.toggle('show', shouldBlock);
  if (shouldBlock && started && !paused && !finished) { wasPausedBeforeRotate = true; paused = true; }
  // resume only when back to landscape AND user hadn't paused manually
  if (!shouldBlock && wasPausedBeforeRotate && started && !finished) { wasPausedBeforeRotate = false; paused = false; pauseOverlay.classList.remove('show'); }
  if (typeof updateHudScale === 'function') updateHudScale();
}
async function tryFullscreenLandscape(){
  // Called from a real user gesture (tap). Best-effort: fullscreen + landscape lock.
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }).catch(()=>{});
    else if (!document.fullscreenElement && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch {}
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{});
  } catch {}
}
// dynamic viewport height + HUD scale — keeps HUD inside safe areas on notched phones
function updateHudScale(){
  const w = innerWidth, h = innerHeight;
  document.documentElement.style.setProperty('--vh', h + 'px');
  const scale = Math.max(0.62, Math.min(1, Math.min(w / 780, h / 360)));
  document.documentElement.style.setProperty('--hudscale', String(scale));
  const hud = document.getElementById('hud');
  if (hud) { hud.style.transform = `scale(${scale})`; hud.style.width = (w / scale) + 'px'; hud.style.height = (h / scale) + 'px'; }
  if (typeof renderer !== 'undefined' && renderer) renderer.setSize(w, h);
  if (typeof camera !== 'undefined' && camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
const rotateFullscreenBtn = document.getElementById('rotateFullscreen');
if (rotateFullscreenBtn) rotateFullscreenBtn.addEventListener('click', () => tryFullscreenLandscape());
const pauseOverlay = document.getElementById('pauseOverlay');
const pauseTitle = document.getElementById('pauseTitle');
const pauseSub = document.getElementById('pauseSub');
// Phase 8 fuel/out DOM
const fuelFill = document.getElementById('fuelfill');
const outOverlay = document.getElementById('outOverlay');
const outTitle = document.getElementById('outTitle');
const outSub = document.getElementById('outSub');
const spectateBadge = document.getElementById('spectateBadge');
let spectating = false;
let lowFuelWarned = false;
let pendingBuy = null; // Phase 9: awaiting server BUY_OK
let netPractice = false; // Phase 12: practice room (bots + server session)
const isOnline = () => (typeof netMode !== 'undefined' && netMode === 'online' && typeof net !== 'undefined' && net && net.online);
const isPractice = () => isOnline() && netPractice;
const weaponHUD = document.getElementById('weaponHUD');
const weaponIcon = document.getElementById('weaponIcon');
const weaponName = document.getElementById('weaponName');
const weaponAmmo = document.getElementById('weaponAmmo');
const weaponTimerFill = document.getElementById('weaponTimerFill');
const killFeedEl = document.getElementById('killFeed');
const hitFlash = document.getElementById('hitFlash');
const damageVignette = document.getElementById('damageVignette');
// Phase 2 economy DOM
const coinsValEl = document.getElementById('coinsVal');
const gemsValEl = document.getElementById('gemsVal');
const xpValEl = document.getElementById('xpVal');
const levelBadgeEl = document.getElementById('levelBadge');
const coinsPopEl = document.getElementById('coinsPop');
const reviveOverlay = document.getElementById('reviveOverlay');
const reviveCostEl = document.getElementById('reviveCost');
const reviveBtn = document.getElementById('reviveBtn');
const reviveHintEl = document.getElementById('reviveHint');
const reviveTitleEl = document.getElementById('reviveTitle');
const stayWreckedBtn = document.getElementById('stayWreckedBtn');
const garageOverlay = document.getElementById('garageOverlay');
const garageGrid = document.getElementById('garageGrid');
const garageBtn = document.getElementById('garageBtn');
const garageBtn2 = document.getElementById('garageBtn2');
const garageClose = document.getElementById('garageClose');
// Phase 3 PWA + settings DOM
const offlineBadge = document.getElementById('offlineBadge');
const installBtn = document.getElementById('installBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsClose = document.getElementById('settingsClose');
const setAudio = document.getElementById('setAudio');
const setTouch = document.getElementById('setTouch');
const syncInfo = document.getElementById('syncInfo');
const historyList = document.getElementById('historyList');
const flushSyncBtn = document.getElementById('flushSyncBtn');
const resetProgressBtn = document.getElementById('resetProgressBtn');

// ---------- THREE ----------
// PHASE 16: never let a WebGL failure kill the page (that was one cause of the
// 'static screen' on phone). Show a clear banner instead; DOM HUD keeps working.
let webglOK = true;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  webglOK = false;
  console.error('[ROADKILL] WebGL unavailable:', e);
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99;background:#2a0e12;border:1px solid #ff5566;color:#fff;padding:18px 22px;border-radius:12px;font:700 13px system-ui;text-align:center;max-width:86vw';
  div.innerHTML = '<b>3D NOT SUPPORTED</b><br>This browser has no WebGL. Try Chrome, or update your system WebView.';
  document.body.appendChild(div);
  window.__rkBootError = 'WebGL unavailable: ' + (e && e.message || e);
  // stub renderer so the rest of the module still parses/boots
  renderer = { setSize(){}, setPixelRatio(){}, render(){}, domElement: canvas, capabilities:{} };
}
// Phase 7: HIGH quality by default, SIMPLE only for weak devices (or user choice).
let qualityMode = 'high';
try {
  const qs = JSON.parse(localStorage.getItem('rk.settings.v1') || '{}').quality;
  if (qs === 'simple' || qs === 'high') qualityMode = qs;
  else if ((innerWidth < 700) && ((navigator.hardwareConcurrency || 8) <= 4)) qualityMode = 'simple';
} catch {}
const IS_HIGH = () => qualityMode === 'high';
renderer.setPixelRatio(IS_HIGH() ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
try { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; } catch {}
try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch {}
renderer.shadowMap.enabled = IS_HIGH();
try { renderer.shadowMap.type = THREE.PCFSoftShadowMap; } catch {}
scene: void 0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060610);
scene.fog = new THREE.Fog(0x060610, 120, 420);
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.1, 1200);
camera.position.set(0, 18, 38);
const hemi = new THREE.HemisphereLight(0xffffff, 0x0a0a18, 1.1); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.3); dir.position.set(60,80,40); scene.add(dir);
// Phase 7: single shadow-casting sun (HIGH only) + player headlight rig.
if (IS_HIGH()) {
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 10; dir.shadow.camera.far = 260;
  const sc = 70;
  dir.shadow.camera.left = -sc; dir.shadow.camera.right = sc;
  dir.shadow.camera.top = sc; dir.shadow.camera.bottom = -sc;
  dir.shadow.bias = -0.0008;
}
const fill = new THREE.DirectionalLight(0x66aaff, 0.35); fill.position.set(-40,30,-40); scene.add(fill);
const playerHead = new THREE.SpotLight(0xcfe8ff, 0, 90, 0.5, 0.45, 1.2);
scene.add(playerHead); scene.add(playerHead.target);
// Phase 7 sky: stars + sun disc + moon, driven by time-of-day.
let skyTime = 'night';
try { const ts = JSON.parse(localStorage.getItem('rk.settings.v1') || '{}').tod; if (ts) skyTime = ts; } catch {}
let todPhase = skyTime === 'day' ? 0.15 : skyTime === 'dusk' ? 0.62 : 0.85; // 0=day .. 1=night
const starGeo = new THREE.BufferGeometry();
{
  const starPos = [];
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.08, r = 480;
    starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xaaccff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 });
scene.add(new THREE.Points(starGeo, starMat));
const sunMesh = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.9, fog: false }));
sunMesh.position.set(-260, 60, -380); sunMesh.lookAt(0, 0, 0); scene.add(sunMesh);
const sunGlowMesh = new THREE.Mesh(new THREE.CircleGeometry(44, 24), new THREE.MeshBasicMaterial({ color: 0xff5a2d, transparent: true, opacity: 0.28, fog: false }));
sunGlowMesh.position.copy(sunMesh.position); sunGlowMesh.lookAt(0, 0, 0); scene.add(sunGlowMesh);
const moonMesh = new THREE.Mesh(new THREE.CircleGeometry(16, 24), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.95, fog: false }));
moonMesh.position.set(240, 200, -380); moonMesh.lookAt(0, 0, 0); scene.add(moonMesh);
// Day/dusk/night cycle: lerps sun, fog, lights. t: 0=day, 0.5=dusk, 1=night.
function applyTimeOfDay(t){
  todPhase = t;
  const day = Math.max(0, 1 - t * 2.2);          // 1 at day, 0 past dusk
  const dusk = Math.max(0, 1 - Math.abs(t - 0.55) * 3.4); // peak at dusk
  const night = Math.min(1, Math.max(0, (t - 0.5) * 2));  // 0 day → 1 night
  const sky = new THREE.Color(0x87b5e8).lerp(new THREE.Color(0x2a1a3d), Math.min(1, t * 1.6));
  sky.lerp(new THREE.Color(0x060610), night);
  if (dusk > 0) sky.lerp(new THREE.Color(0xb34a2a), dusk * 0.55);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  scene.fog.near = 120 + day * 160; scene.fog.far = 420 + day * 380;
  hemi.intensity = 0.35 + day * 0.85 + dusk * 0.15;
  hemi.color.setHex(day > 0.5 ? 0xbfd9ff : 0xffffff);
  hemi.groundColor.setHex(night > 0.5 ? 0x0a0a18 : 0x3a4a3a);
  dir.intensity = 0.25 + day * 1.6 + dusk * 0.5;
  dir.color.setHex(dusk > 0.4 ? 0xffb36a : day > 0.4 ? 0xfff4e0 : 0x9ab4ff);
  dir.position.set(60 - t * 140, 90 - t * 55, 40);
  fill.intensity = 0.12 + night * 0.3;
  starMat.opacity = night * 0.85;
  sunMesh.material.opacity = Math.max(0, 0.9 - night);
  sunGlowMesh.material.opacity = Math.max(0, 0.3 - night * 0.3) + dusk * 0.25;
  moonMesh.material.opacity = 0.15 + night * 0.8;
  sunMesh.position.set(-260 + t * 120, 150 - t * 95, -380);
  sunMesh.lookAt(0, 0, 0); sunGlowMesh.position.copy(sunMesh.position); sunGlowMesh.lookAt(0, 0, 0);
  ground.material.color.setHex(night > 0.5 ? 0x0e2a14 : day > 0.5 ? 0x2a5a34 : 0x1a3524);
  const wet = 0.55 + night * 0.45; // wet-road shine strongest at night
  if (roadMat) { roadMat.roughness = 0.7 - wet * 0.45; roadMat.metalness = 0.05 + wet * 0.25; }
}
let roadMat = null; // set in buildTrack; applyTimeOfDay guards null
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(900,900),
  IS_HIGH()
    ? new THREE.MeshStandardMaterial({ color: 0x0e2a14, roughness: 0.95, metalness: 0 })
    : new THREE.MeshLambertMaterial({ color: 0x0e2a14 })
);
ground.rotation.x=-Math.PI/2; ground.position.y=-0.6;
ground.receiveShadow = IS_HIGH();
scene.add(ground);

// ---------- TRACK ----------
let currentTrackIdx = 0;
try {
  const t = JSON.parse(localStorage.getItem('rk.settings.v1') || '{}').track;
  if (Number.isInteger(t) && TRACKS[t]) currentTrackIdx = t;
} catch {}
let curve = null;
let sampled = [], sampledTangents = [];
let checkpointPos = [];
const trackGroup = new THREE.Group();
scene.add(trackGroup);
// ---------- PHASE 7 premium road helpers ----------
function stdMat(color, rough = 0.6, metal = 0.1, extra = {}) {
  return IS_HIGH()
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra })
    : new THREE.MeshLambertMaterial({ color, ...extra });
}
function makeAsphaltTexture(){
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256;
  const cx = cvs.getContext('2d');
  cx.fillStyle = '#33333c'; cx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const g = 40 + Math.random() * 30;
    cx.fillStyle = `rgb(${g},${g},${g + 6})`;
    cx.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 30);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch {}
  return tex;
}
const asphaltTex = makeAsphaltTexture();
function makeWindowTexture(){
  const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 96;
  const cx = cvs.getContext('2d');
  cx.fillStyle = '#14141c'; cx.fillRect(0, 0, 64, 96);
  for (let y = 6; y < 90; y += 12) for (let x = 6; x < 58; x += 12) {
    cx.fillStyle = Math.random() > 0.45 ? '#ffd77a' : '#222a35';
    cx.fillRect(x, y, 7, 8);
  }
  const tex = new THREE.CanvasTexture(cvs);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch {}
  return tex;
}
const windowTex = makeWindowTexture();
// flat ribbon strip between two lateral offsets (for shoulders, markings, sidewalks)
function buildStrip(offA, offB, y, flip = false){
  const pos = [], idx = [], uv = [];
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const p = sampled[i], tg = sampledTangents[i];
    const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
    const nnx = nx / len, nnz = nz / len;
    pos.push(p.x + nnx * offA, y, p.z + nnz * offA, p.x + nnx * offB, y, p.z + nnz * offB);
    uv.push(0, i / TRACK_SAMPLES * 40, 1, i / TRACK_SAMPLES * 40);
  }
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a = i * 2, b = i * 2 + 1, na = ((i + 1) % TRACK_SAMPLES) * 2, nb = ((i + 1) % TRACK_SAMPLES) * 2 + 1;
    if (flip) idx.push(a, b, nb, a, nb, na); else idx.push(a, nb, b, a, na, nb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function clearGroup(gr) {
  for (let i = gr.children.length - 1; i >= 0; i--) {
    const m = gr.children[i];
    gr.remove(m);
    if (m.geometry) m.geometry.dispose();
  }
}
function buildTrack(idx) {
  currentTrackIdx = ((idx % TRACKS.length) + TRACKS.length) % TRACKS.length;
  clearGroup(trackGroup);
  sampled = []; sampledTangents = []; checkpointPos = [];
  const pts = TRACKS[currentTrackIdx].points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.22);
  for (let i = 0; i < TRACK_SAMPLES; i++) { const t = i / TRACK_SAMPLES; sampled.push(curve.getPoint(t)); sampledTangents.push(curve.getTangent(t).normalize()); }
  computeShortcutSegs(); // Phase 10: corridors before scenery (trees avoid them)
  const roadMatNew = IS_HIGH()
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.35, metalness: 0.18 })
    : new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
  roadMat = roadMatNew;
  const roadMesh = new THREE.Mesh(buildRoad(), roadMatNew);
  roadMesh.position.y = -0.02; roadMesh.receiveShadow = IS_HIGH(); trackGroup.add(roadMesh);
  const laneW = ROAD_WIDTH / 4; // 4 lanes, 2 per direction
  // shoulders (darker asphalt bands just outside the road edge)
  for (const side of [1, -1]) {
    const sh = new THREE.Mesh(
      buildStrip(side * (ROAD_WIDTH / 2), side * (ROAD_WIDTH / 2 + 1.6), -0.01),
      stdMat(0x232329, 0.9, 0)
    );
    sh.receiveShadow = IS_HIGH(); trackGroup.add(sh);
    // sidewalk beyond shoulder
    const sw = new THREE.Mesh(
      buildStrip(side * (ROAD_WIDTH / 2 + 1.6), side * (ROAD_WIDTH / 2 + 3.4), 0.0),
      stdMat(0x4a4a52, 0.95, 0)
    );
    sw.receiveShadow = IS_HIGH(); trackGroup.add(sw);
  }
  // edge glow strips (kept from Phase 6) + solid edge lines
  for (const side of [1, -1]) {
    const linePts = [];
    for (let i = 0; i < TRACK_SAMPLES; i++) {
      const p = sampled[i], tg = sampledTangents[i];
      const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
      linePts.push(new THREE.Vector3(p.x + nx / len * (ROAD_WIDTH / 2 - 0.4) * side, 0.02, p.z + nz / len * (ROAD_WIDTH / 2 - 0.4) * side));
    }
    linePts.push(linePts[0].clone());
    trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: side > 0 ? 0xffcc00 : 0x2de2ff, transparent: true, opacity: 0.55 })));
    const edge = new THREE.Mesh(
      buildStrip(side * (ROAD_WIDTH / 2 - 0.55), side * (ROAD_WIDTH / 2 - 0.15), 0.015),
      new THREE.MeshBasicMaterial({ color: side > 0 ? 0xffcc00 : 0x33ddff })
    );
    trackGroup.add(edge);
  }
  // center double-yellow (two thin solid strips)
  for (const off of [-0.35, 0.35]) {
    const dbl = new THREE.Mesh(
      buildStrip(off - 0.16, off + 0.16, 0.015),
      new THREE.MeshBasicMaterial({ color: 0xffb800 })
    );
    trackGroup.add(dbl);
  }
  // white dashed lane dividers at ±laneW (instanced-style individual dashes)
  {
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.92 });
    for (const off of [-laneW, laneW]) {
      for (let i = 0; i < TRACK_SAMPLES; i += 6) {
        if (i % 12 !== 0) continue;
        const p = sampled[i], tg = sampledTangents[i];
        const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3.2), dashMat);
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(tg.x, tg.z);
        m.position.set(p.x + nx / len * off, 0.02, p.z + nz / len * off);
        trackGroup.add(m);
      }
    }
  }
  // red/white guardrail walls + posts every 8 samples
  trackGroup.add(new THREE.Mesh(buildWalls(ROAD_WIDTH / 2 + 0.7), stdMat(0x8a1a1a, 0.5, 0.3)));
  trackGroup.add(new THREE.Mesh(buildWalls(-ROAD_WIDTH / 2 - 0.7), stdMat(0x1e3a5f, 0.5, 0.3)));
  {
    const postGeo = new THREE.BoxGeometry(0.35, 1.1, 0.35);
    const postMat = stdMat(0x9a9aa2, 0.5, 0.6);
    const railMat = stdMat(0xb8bcc4, 0.35, 0.8);
    for (const side of [1, -1]) {
      const off = side * (ROAD_WIDTH / 2 + 1.1);
      const railPts = [];
      for (let i = 0; i < TRACK_SAMPLES; i += 8) {
        const p = sampled[i], tg = sampledTangents[i];
        const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
        const x = p.x + nx / len * off, z = p.z + nz / len * off;
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 0.55, z); trackGroup.add(post);
        railPts.push(new THREE.Vector3(x, 1.05, z));
      }
      railPts.push(railPts[0].clone());
      trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(railPts), new THREE.LineBasicMaterial({ color: 0xcfd4dc })));
      // solid rail ribbon so it reads as guardrail, not wire
      const rail = new THREE.Mesh(buildStrip(off - 0.15, off + 0.15, 1.0), railMat);
      rail.scale.y = 1; trackGroup.add(rail);
    }
  }
  // red/white curbs (alternating blocks just inside the edge)
  {
    const curbGeo = new THREE.BoxGeometry(1.4, 0.28, 2.2);
    for (const side of [1, -1]) {
      for (let i = 0; i < TRACK_SAMPLES; i += 4) {
        const p = sampled[i], tg = sampledTangents[i];
        const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
        const off = side * (ROAD_WIDTH / 2 - 1.0);
        const m = new THREE.Mesh(curbGeo, (i >> 2) % 2 ? stdMat(0xc02020, 0.7, 0) : stdMat(0xe8e8e8, 0.7, 0));
        m.position.set(p.x + nx / len * off, 0.1, p.z + nz / len * off);
        m.rotation.y = Math.atan2(tg.x, tg.z);
        trackGroup.add(m);
      }
    }
  }
  // street lights every 18 samples, alternating sides (emissive lamp + glow, no per-lamp light)
  {
    const poleMat = stdMat(0x303036, 0.5, 0.7);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd77a, transparent: true, opacity: 0.22 });
    for (let i = 0; i < TRACK_SAMPLES; i += 18) {
      const side = (i / 18) % 2 === 0 ? 1 : -1;
      const p = sampled[i], tg = sampledTangents[i];
      const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
      const bx = p.x + nx / len * side * (ROAD_WIDTH / 2 + 4.2), bz = p.z + nz / len * side * (ROAD_WIDTH / 2 + 4.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 9, 8), poleMat);
      pole.position.set(bx, 4.5, bz); pole.castShadow = IS_HIGH(); trackGroup.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 3.2), poleMat);
      arm.position.set(bx - nx / len * side * 1.5, 8.9, bz - nz / len * side * 1.5);
      arm.lookAt(p.x, 8.9, p.z); trackGroup.add(arm);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), lampMat);
      lamp.position.set(bx - nx / len * side * 2.8, 8.7, bz - nz / len * side * 2.8);
      trackGroup.add(lamp);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), glowMat);
      glow.position.copy(lamp.position); trackGroup.add(glow);
    }
  }
  {
    // start/finish checker + gantry + intersection cross-road
    const p = sampled[0], tg = sampledTangents[0]; const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(tg.x, tg.z); m.position.set(p.x, 0.05, p.z); const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 16; const cx = cvs.getContext('2d'); for (let x = 0; x < 8; x++) { cx.fillStyle = x % 2 ? '#fff' : '#111'; cx.fillRect(x * 8, 0, 8, 16); } const tex = new THREE.CanvasTexture(cvs); tex.magFilter = THREE.NearestFilter; m.material.map = tex; trackGroup.add(m);
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 6, 4, 0.6), stdMat(0xffcc00, 0.45, 0.4)); gantry.position.set(p.x, 5, p.z); gantry.lookAt(p.x + tg.x * 10, 5, p.z + tg.z * 10); gantry.castShadow = IS_HIGH(); trackGroup.add(gantry);
    for (const gx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), stdMat(0x33333a, 0.6, 0.4));
      const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
      leg.position.set(p.x + nx / len * gx * (ROAD_WIDTH / 2 + 2.4), 2.5, p.z + nz / len * gx * (ROAD_WIDTH / 2 + 2.4));
      leg.castShadow = IS_HIGH(); trackGroup.add(leg);
    }
    // intersection: crossing side-road quad + stop line at start
    const nx0 = -tg.z, nz0 = tg.x; const l0 = Math.hypot(nx0, nz0) || 1;
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH * 2.2, 10), stdMat(0x2c2c34, 0.9, 0));
    cross.rotation.x = -Math.PI / 2; cross.rotation.z = Math.atan2(tg.x, tg.z) + Math.PI / 2;
    cross.position.set(p.x, -0.015, p.z); trackGroup.add(cross);
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH - 4, 1.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    stop.rotation.x = -Math.PI / 2; stop.rotation.z = Math.atan2(tg.x, tg.z);
    stop.position.set(p.x - tg.x * 5, 0.03, p.z - tg.z * 5); trackGroup.add(stop);
  }
  // bridge overpass at 1/3 + tunnel arches at 2/3 of the loop
  {
    const bi = Math.floor(TRACK_SAMPLES / 3), ti = Math.floor(TRACK_SAMPLES * 2 / 3);
    const bp = sampled[bi], btg = sampledTangents[bi];
    const deck = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 14, 1.2, 9), stdMat(0x55555e, 0.8, 0.1));
    deck.position.set(bp.x, 7.5, bp.z); deck.rotation.y = Math.atan2(btg.x, btg.z) + Math.PI / 2;
    deck.castShadow = IS_HIGH(); trackGroup.add(deck);
    for (const s of [-1, 1]) {
      const nx = -btg.z, nz = btg.x; const len = Math.hypot(nx, nz) || 1;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7.5, 2.2), stdMat(0x3a3a42, 0.8, 0.1));
      pillar.position.set(bp.x + nx / len * s * (ROAD_WIDTH / 2 + 5), 3.4, bp.z + nz / len * s * (ROAD_WIDTH / 2 + 5));
      trackGroup.add(pillar);
    }
    for (let k = -2; k <= 2; k++) {
      const tp = sampled[(ti + k * 4 + TRACK_SAMPLES) % TRACK_SAMPLES];
      const ttg = sampledTangents[(ti + k * 4 + TRACK_SAMPLES) % TRACK_SAMPLES];
      const arch = new THREE.Mesh(new THREE.TorusGeometry(ROAD_WIDTH / 2 + 2.5, 0.9, 8, 14, Math.PI), stdMat(0x3f3f48, 0.7, 0.2));
      arch.position.set(tp.x, 0, tp.z); arch.rotation.y = Math.atan2(ttg.x, ttg.z);
      trackGroup.add(arch);
    }
  }
  for (let c = 0; c < CHECKPOINTS; c++) checkpointPos.push(sampled[Math.floor(c / CHECKPOINTS * TRACK_SAMPLES)].clone());
  // scenery: buildings with lit windows + trees + hills (replaces Phase 6 random boxes)
  {
    const bldMats = [];
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.2, r = 150 + Math.random() * 110;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const w = 8 + Math.random() * 10, h = 12 + Math.random() * 30, d = 8 + Math.random() * 10;
      const mat = IS_HIGH()
        ? new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.8, metalness: 0.2, emissive: 0xffffff, emissiveMap: windowTex, emissiveIntensity: 0.55 })
        : new THREE.MeshLambertMaterial({ color: 0x3a3a45 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, h / 2 - 0.6, z); b.rotation.y = Math.random() * Math.PI;
      trackGroup.add(b); bldMats.push(mat);
    }
    const treeTrunk = stdMat(0x5a3a22, 0.9, 0), treeTop = stdMat(0x1e5a2a, 0.9, 0);
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2, r = 60 + Math.random() * 70;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      let onRoad = false;
      for (let s = 0; s < TRACK_SAMPLES; s += 10) { const dx = sampled[s].x - x, dz = sampled[s].z - z; if (dx * dx + dz * dz < 20 * 20) { onRoad = true; break; } }
      if (onRoad) continue;
      if (inShortcut(x, z, 4)) continue; // Phase 10: keep secret cuts clear
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), treeTrunk);
      trunk.position.set(x, 1.2, z); trackGroup.add(trunk);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.8 + Math.random(), 4 + Math.random() * 2, 8), treeTop);
      top.position.set(x, 4.4, z); top.castShadow = IS_HIGH(); trackGroup.add(top);
    }
    const hillMat = stdMat(0x14301c, 1.0, 0);
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + 0.3, r = 330 + Math.random() * 90;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(60 + Math.random() * 40, 50 + Math.random() * 40, 7), hillMat);
      hill.position.set(Math.cos(ang) * r, -2, Math.sin(ang) * r);
      trackGroup.add(hill);
    }
  }
  applyTimeOfDay(todPhase); // auto-cycle is driven per-frame; gameTime not yet initialized here
  buildFeatureMeshes(); // Phase 10: shortcut strips, hazards, ramps
  buildBannerMeshes(); // Phase 11: brand + people banners from banners-config.json
}
function buildRoad(){
  const pos=[], idx=[], uv=[];
  for(let i=0;i<TRACK_SAMPLES;i++){
    const p=sampled[i], tg=sampledTangents[i];
    const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
    pos.push(p.x+nnx*ROAD_WIDTH/2,0,p.z+nnz*ROAD_WIDTH/2, p.x-nnx*ROAD_WIDTH/2,0,p.z-nnz*ROAD_WIDTH/2);
    uv.push(0,i/TRACK_SAMPLES*12, 1,i/TRACK_SAMPLES*12);
  }
  for(let i=0;i<TRACK_SAMPLES;i++){ const a=i*2,b=i*2+1, na=((i+1)%TRACK_SAMPLES)*2, nb=((i+1)%TRACK_SAMPLES)*2+1; idx.push(a,nb,b, a,na,nb); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function buildWalls(offset){
  const pos=[], idx=[]; const h=WALL_HEIGHT;
  for(let i=0;i<TRACK_SAMPLES;i++){ const p=sampled[i], tg=sampledTangents[i]; const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len; const cx=p.x+nnx*offset, cz=p.z+nnz*offset; pos.push(cx,0,cz, cx,h,cz); }
  for(let i=0;i<TRACK_SAMPLES;i++){ const a0=i*2,a1=i*2+1,b0=((i+1)%TRACK_SAMPLES)*2,b1=((i+1)%TRACK_SAMPLES)*2+1; idx.push(a0,b0,a1, a1,b0,b1); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function switchTrack(idx){
  buildTrack(idx);
  try { settings = saveSettings({ track: currentTrackIdx }); } catch {}
  spawnPickups();
  spawnRoadblocks();
  placeCars();
  restart();
}

// ---------- COMBAT STATE (server-separable) ----------
// Phase 3: sync localStorage boot for instant HUD, then upgrade from IndexedDB.
let profile = loadProfile();
migrateShop(profile); // Phase 9 vehicles/weapons/upgrades backfill
let settings = loadSettings();
function persistProfile(immediate = false){
  saveProfileUnified(profile, { immediate });
  if (profile.equippedSkin && settings.lastCar !== profile.equippedSkin) {
    settings = saveSettings({ lastCar: profile.equippedSkin, lastPlayedAt: Date.now() });
  }
}
// Local XP that also feeds season S1 points (server mirrors this via AWARD).
function grantXP(amount){
  const r = addXP(profile, amount);
  profile.seasonPoints = (profile.seasonPoints || 0) + amount;
  return r;
}
function refreshEconHUD(){
  if(coinsValEl) coinsValEl.textContent = profile.coins;
  if(gemsValEl) gemsValEl.textContent = profile.gems;
  if(xpValEl) xpValEl.textContent = profile.xp;
  if(levelBadgeEl){
    const lvl = getLevelFromXP(profile.xp);
    const tier = getTier(lvl);
    levelBadgeEl.textContent = `LVL ${lvl} • ${tier.name}`;
    levelBadgeEl.style.background = `linear-gradient(90deg, ${tier.color}, #ff2d2d)`;
  }
  persistProfile();
}
function popCoins(text, cls=''){
  if(!coinsPopEl) return;
  const d=document.createElement('div'); d.className='pop '+cls; d.textContent=text; coinsPopEl.appendChild(d);
  setTimeout(()=>d.remove(), 900);
}
let coinsTokens=[]; // economy token state
let coinsTokenMeshes=[];
let coinsTokenId=0;
refreshEconHUD();

// ---------- PHASE 3 — offline-first boot, PWA, settings ----------
let deferredInstallPrompt = null;
function updateOfflineBadge(){
  if(!offlineBadge) return;
  offlineBadge.classList.toggle('show', !navigator.onLine);
}
async function refreshSyncInfo(){
  if(!syncInfo) return;
  try {
    const n = await getSyncQueueCount();
    syncInfo.textContent = `Sync queue: ${n} pending${navigator.onLine ? '' : ' (offline)'}`;
  } catch { syncInfo.textContent = 'Sync queue: stub active'; }
}
async function renderHistory(){
  if(!historyList) return;
  try {
    const list = await getMatches(10);
    if(!list.length){ historyList.textContent = 'No races yet — finish one!'; return; }
    historyList.innerHTML = list.map((m) => {
      const d = new Date(m.date).toLocaleDateString();
      const suf = m.rank===1?'ST':m.rank===2?'ND':m.rank===3?'RD':'TH';
      return `<div>P${m.rank}${suf} • ${m.kills||0} kills • +$${m.coinsBonus||0} +${m.xpGain||0}XP • ${d}</div>`;
    }).join('');
  } catch { historyList.textContent = 'History unavailable.'; }
}
// Upgrade profile from IndexedDB (migrates localStorage Phase 2 data once).
(async () => {
  try {
    const unified = await loadProfileUnified();
    if (unified && (unified.coins !== profile.coins || unified.xp !== profile.xp || unified.gems !== profile.gems || unified.equippedSkin !== profile.equippedSkin)) {
      profile = unified;
      migrateShop(profile);
      refreshEconHUD();
      if (typeof player !== 'undefined' && player && player.body) {
        const skin = GARAGE_SKINS.find((k) => k.id === profile.equippedSkin);
        if (skin) { player.body.material.color.setHex(skin.color); if(player.underglow) player.underglow.material.color.setHex(skin.color); player.color = skin.color; }
      }
    }
  } catch {}
  // Apply saved session: last car + settings checkboxes.
  try {
    settings = loadSettings();
    if (settings.lastCar && profile.equippedSkin !== settings.lastCar && profile.unlockedSkins.includes(settings.lastCar)) {
      profile.equippedSkin = settings.lastCar;
      persistProfile(true);
    }
    if (setAudio) setAudio.checked = settings.audio !== false;
    if (setTouch) setTouch.checked = settings.touchControls !== false;
    applyTouchSetting();
  } catch {}
  renderHistory();
  refreshSyncInfo();
  registerServiceWorker();
  installCrashReporter();
})();
function applyTouchSetting(){
  const controls = document.getElementById('controls');
  const on = settings.touchControls !== false;
  if (controls && window.innerWidth < 700) controls.style.display = on ? '' : 'none';
}
addEventListener('online', () => { updateOfflineBadge(); refreshSyncInfo(); flushSyncQueueStub().then(refreshSyncInfo); });
addEventListener('offline', () => { updateOfflineBadge(); refreshSyncInfo(); });
updateOfflineBadge();
setInterval(refreshSyncInfo, 8000);
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn) installBtn.classList.add('show');
});
if (installBtn) installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try { await deferredInstallPrompt.userChoice; } catch {}
  deferredInstallPrompt = null;
  installBtn.classList.remove('show');
});
function openSettings(){ renderHistory(); refreshSyncInfo(); renderLiveops(); if(settingsOverlay) settingsOverlay.classList.add('show'); }
function closeSettings(){ if(settingsOverlay) settingsOverlay.classList.remove('show'); }
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settingsOverlay) settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });
if (setAudio) setAudio.addEventListener('change', () => { settings = saveSettings({ audio: setAudio.checked }); enqueueSyncOp('settings.save', { audio: settings.audio }); });
if (setTouch) setTouch.addEventListener('change', () => { settings = saveSettings({ touchControls: setTouch.checked }); applyTouchSetting(); enqueueSyncOp('settings.save', { touchControls: settings.touchControls }); });
if (flushSyncBtn) flushSyncBtn.addEventListener('click', async () => {
  const r = await flushSyncQueueStub();
  if (syncInfo) syncInfo.textContent = r.sent ? `Sync stub: ${r.sent} op(s) queued for /api/sync` : (r.reason === 'offline' ? 'Offline — will sync later' : 'Sync queue: 0 pending');
  refreshSyncInfo();
});
if (resetProgressBtn) resetProgressBtn.addEventListener('click', async () => {
  if (!confirm('Reset coins, gems, XP and skins?')) return;
  profile = createDefaultProfile();
  persistProfile(true);
  refreshEconHUD();
  renderHistory();
});

const combatStates=[]; // index aligned with cars
const projectiles=[]; // shared projectile sim
const pickups=[]; // pickup states
const effects=[]; // {pos, vel, life, mesh, scale}
let shake=0;
// ---- shared world state, declared EARLY so every init fn (buildTrack/placeCars/
// spawnPickups/spawnRoadblocks) can run in any order without TDZ/undefined crashes
// (PHASE 16 phone-fix: these were previously declared mid-file; top-level init
// calls hit them before initialization -> static dead page on phone) ----
const pickupMeshes=[];
const projectileMeshes=[];
let shortcutSegs=[]; // {ax,az,bx,bz,w,claimed} Phase 10
let hazards=[];      // {type,x,z,r}
let ramps=[];        // {x,z,yaw}

// ---------- PHASE 9 — procedural vehicle generator ----------
// Original designs, no logos or real names. Builders are per-class; every
// vehicle keeps the same rig interface (body/wheels/brakeMat/flame...).
// glTF: drop a file at game/public/models/<vehicleId>.glb and set
// spec.model = 'models/<vehicleId>.glb' — it loads with fallback to procedural.
const BOT_RIDES = ['vortex_gt', 'nebula', 'marauder', 'tortoise', 'trike'];
const MODEL_CACHE = {};
async function tryFitModel(c, spec) {
  if (!spec || !spec.model) return false;
  try {
    if (!MODEL_CACHE[spec.model]) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(spec.model);
      MODEL_CACHE[spec.model] = gltf.scene;
    }
    const src = MODEL_CACHE[spec.model];
    if (!src || c.vehicleId !== spec.id) return false;
    const m = src.clone();
    // normalize to ~5u long, sit on ground
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const s = 5.2 / Math.max(size.x, size.z, 1);
    m.scale.setScalar(s);
    const b2 = new THREE.Box3().setFromObject(m);
    m.position.y -= b2.min.y;
    c.chassis.clear();
    c.chassis.add(m);
    m.traverse((o) => { if (o.isMesh && IS_HIGH()) o.castShadow = true; });
    return true;
  } catch { return false; } // missing file? stay procedural
}
function paintMat(hex, rough = 0.35, metal = 0.6) {
  return IS_HIGH()
    ? new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal })
    : new THREE.MeshLambertMaterial({ color: hex });
}
function buildChassis(g, spec, paintHex) {
  const chassis = new THREE.Group();
  g.add(chassis);
  const cls = spec.cls || 'super';
  const wheels = [];
  let body = null, brakeMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  const add = (mesh, x=0, y=0, z=0) => { mesh.position.set(x, y, z); if (IS_HIGH() && mesh.isMesh) mesh.castShadow = true; chassis.add(mesh); return mesh; };
  const wheel = (x, y, z, r=0.55, w=0.5, front=false) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), paintMat(0x0a0a0a, 0.85, 0.1));
    m.rotation.z = Math.PI / 2; m.position.set(x, y, z);
    if (IS_HIGH()) m.castShadow = true;
    chassis.add(m); wheels.push({ mesh: m, front }); return m;
  };
  const headlight = (x, y, z) => add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.12), new THREE.MeshBasicMaterial({ color: 0xd8f4ff })), x, y, z);
  const brake = (w, x, y, z) => { const b = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, 0.12), brakeMat), x, y, z); return b; };
  if (cls === 'scifi') {
    // hover saucer: disc + dome + pods + glow ring, no wheels
    body = add(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 0.55, 18), paintMat(paintHex)), 0, 0.62, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10, 0, Math.PI*2, 0, Math.PI/2), paintMat(0x11131a, 0.15, 0.9)), 0, 0.85, -0.3);
    for (const s of [-1, 1]) {
      const pod = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10), paintMat(paintHex, 0.4, 0.5)), s * 2.1, 0.55, -0.6);
      pod.rotation.x = Math.PI / 2;
      const tip = add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2de2ff })), s * 2.1, 0.55, -1.75);
      void tip;
    }
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: paintHex })), 0, 0.4, 0);
    ring.rotation.x = Math.PI / 2;
    headlight(-0.9, 0.6, 2.35); headlight(0.9, 0.6, 2.35);
    brake(1.8, 0, 0.66, -2.5);
  } else if (cls === 'war') {
    // gun-truck: tall hull + plow + cage + roof gun + big wheels
    body = add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.3, 4.6), paintMat(paintHex, 0.55, 0.35)), 0, 0.95, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.6), paintMat(0x14151c, 0.3, 0.7)), 0, 1.9, -0.5);
    const plow = add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.3), paintMat(0x2a2a32, 0.6, 0.4)), 0, 0.55, 2.6);
    plow.rotation.x = -0.35;
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 8), paintMat(0x1c1c22, 0.5, 0.6)), 0, 2.6, -0.5);
    void post;
    const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 8), paintMat(0x101014, 0.4, 0.7)), 0, 2.75, 0.4);
    gun.rotation.x = Math.PI / 2;
    wheel(-1.6, 0.62, 1.5, 0.62); wheel(1.6, 0.62, 1.5, 0.62);
    wheel(-1.6, 0.62, -1.5, 0.62); wheel(1.6, 0.62, -1.5, 0.62);
    headlight(-1.0, 0.9, 2.32); headlight(1.0, 0.9, 2.32);
    brake(2.2, 0, 1.0, -2.32);
  } else if (cls === 'tank') {
    // siege hull: tracks + turret + barrel, no steering wheels
    body = add(new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.0, 4.8), paintMat(paintHex, 0.6, 0.3)), 0, 1.05, 0);
    for (const s of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.0, 5.2), paintMat(0x151517, 0.85, 0.1)), s * 1.85, 0.5, 0);
      for (let k = -2; k <= 2; k++) {
        const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10), paintMat(0x2e2e36, 0.7, 0.3)), s * 1.85, 0.42, k * 1.0);
        w.rotation.z = Math.PI / 2;
      }
    }
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.7, 14), paintMat(paintHex, 0.55, 0.35)), 0, 1.85, -0.3);
    const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.0, 8), paintMat(0x101014, 0.4, 0.7)), 0, 1.95, 1.6);
    barrel.rotation.x = Math.PI / 2;
    headlight(-1.0, 0.9, 2.42); headlight(1.0, 0.9, 2.42);
    brake(2.2, 0, 1.0, -2.42);
  } else if (cls === 'crazy') {
    if (spec.id === 'trike') {
      // rocket trike: narrow dart + 3 wheels + booster cones
      body = add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 4.6), paintMat(paintHex)), 0, 0.6, 0.2);
      const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), paintMat(0xffffff, 0.3, 0.4)), 0, 0.6, 3.2);
      nose.rotation.x = Math.PI / 2;
      add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 1.2), paintMat(0x11131a, 0.2, 0.8)), 0, 1.15, -0.6);
      for (const s of [-1, 1]) {
        const b = add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 8), paintMat(0x333338, 0.5, 0.6)), s * 0.7, 0.6, -2.6);
        b.rotation.x = -Math.PI / 2;
      }
      wheel(0, 0.5, 2.4, 0.5, 0.4, true);
      wheel(-1.1, 0.55, -1.4, 0.55); wheel(1.1, 0.55, -1.4, 0.55);
      headlight(0, 0.62, 2.62);
      brake(1.2, 0, 0.66, -2.42);
    } else {
      // doom kart: tiny kart + rocket rack + spoiler
      body = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 3.1), paintMat(paintHex)), 0, 0.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, 1.0), paintMat(0x11131a, 0.2, 0.8)), 0, 0.95, -0.3);
      for (const s of [-0.5, 0.5]) {
        const r = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8), paintMat(0xcc2222, 0.5, 0.4)), s, 1.0, -1.9);
        r.rotation.x = Math.PI / 2;
      }
      const wing = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.7), paintMat(0x14141a, 0.5, 0.5)), 0, 1.45, -1.9);
      void wing;
      wheel(-1.05, 0.32, 1.0, 0.32, 0.35, true); wheel(1.05, 0.32, 1.0, 0.32, 0.35, true);
      wheel(-1.05, 0.36, -1.1, 0.36, 0.4); wheel(1.05, 0.36, -1.1, 0.36, 0.4);
      headlight(-0.6, 0.5, 1.58); headlight(0.6, 0.5, 1.58);
      brake(1.6, 0, 0.56, -1.58);
    }
  } else {
    // super: wedge + canopy + spoiler + 4 wheels
    body = add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.75, 4.9), paintMat(paintHex)), 0, 0.58, -0.1);
    const nose = add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.45, 1.2), paintMat(paintHex, 0.3, 0.65)), 0, 0.42, 2.6);
    void nose;
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), paintMat(0x0e1016, 0.12, 0.95)), 0, 1.12, -0.5);
    for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.5), paintMat(0x14141a, 0.5, 0.5)), s * 1.1, 1.0, -2.4);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.7), paintMat(0x14141a, 0.4, 0.6)), 0, 1.3, -2.4);
    wheel(-1.55, 0.5, 1.55, 0.5, 0.45, true); wheel(1.55, 0.5, 1.55, 0.5, 0.45, true);
    wheel(-1.55, 0.55, -1.5, 0.55, 0.5); wheel(1.55, 0.55, -1.5, 0.55, 0.5);
    headlight(-0.95, 0.55, 2.55); headlight(0.95, 0.55, 2.55);
    brake(2.0, 0, 0.62, -2.58);
  }
  return { chassis, body, wheels, brakeMat };
}

// Per-car derived stats from vehicle + upgrades.
function applyVehicleStats(c, isPlayerCar) {
  const levels = isPlayerCar ? upgLevels(profile, c.vehicleId) : { engine: 0, armor: 0, tank: 0, suspension: 0 };
  const st = vehicleStats(c.vehicleId, levels) || vehicleStats('falcon_s', levels);
  c.statTop = st.top; c.maxSpeed = st.top;
  c.accelMult = st.accel; c.handlingMult = st.handling;
  c.maxHP = st.hp; c.fuelMax = st.fuel; c.fuelUse = st.fuelUse;
  c.cstate.maxHealth = st.hp;
  return st;
}
function mountsFor(c) {
  if (c.isPlayer) {
    const out = [];
    for (const slot of [profile.mounts.slot1, profile.mounts.slot2]) {
      if (!slot) continue;
      if (!profile.weapons.includes(slot) && slot !== 'mg') continue;
      const w = shopWeapon(slot);
      if (!w || !w.mountable) continue;
      out.push({ type: slot, ammo: w.raceAmmo, raceAmmo: w.raceAmmo });
    }
    if (!out.length) out.push({ type: 'mg', ammo: 150, raceAmmo: 150 });
    return out.slice(0, 2);
  }
  // bots: mg always, 40% carry rockets on 2-slot rides
  const spec = vehicleSpec(c.vehicleId);
  const m = [{ type: 'mg', ammo: 150, raceAmmo: 150 }];
  if (spec && spec.slots > 1 && Math.random() < 0.4) m.push({ type: 'rocket', ammo: 6, raceAmmo: 6 });
  return m;
}

// ---------- CAR FACTORY ----------
function makeCar(color, isPlayer, idx){
  const g=new THREE.Group();
  const effColor = (isPlayer && profile.equippedSkin) ? (GARAGE_SKINS.find(k=>k.id===profile.equippedSkin)?.color ?? color) : color;
  const vid = isPlayer
    ? (profile.equippedVehicle || 'falcon_s')
    : BOT_RIDES[(idx - 1 + BOT_RIDES.length) % BOT_RIDES.length];
  const spec = vehicleSpec(vid) || vehicleSpec('falcon_s');
  const ch = buildChassis(g, spec, effColor);
  const body = ch.body, wheels = ch.wheels, brakeMat = ch.brakeMat;
  const flame=new THREE.Mesh(new THREE.ConeGeometry(0.6,1.6,8), new THREE.MeshBasicMaterial({color:0x00d0ff, transparent:true, opacity:0})); flame.rotation.x=Math.PI; flame.position.set(0,0.5,-3.1); g.add(flame);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(2.4,12), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.35})); shadow.rotation.x=-Math.PI/2; shadow.position.y=0.02; g.add(shadow);
  const underglow=new THREE.Mesh(new THREE.RingGeometry(2.0,2.5,20), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.5, side:THREE.DoubleSide})); underglow.rotation.x=-Math.PI/2; underglow.position.y=0.04; g.add(underglow);
  // shield bubble
  const shieldMesh=new THREE.Mesh(new THREE.SphereGeometry(3.2,16,12), new THREE.MeshBasicMaterial({color:0x2de2ff, transparent:true, opacity:0, wireframe:true})); shieldMesh.visible=false; g.add(shieldMesh);
  // damage smoke
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8), new THREE.MeshBasicMaterial({color:0x555555, transparent:true, opacity:0})); smoke.position.set(0,1.2,-1.2); g.add(smoke);
  scene.add(g);
  const cstate=createCombatState(idx, isPlayer);
  combatStates.push(cstate);
  const car = {
    mesh:g, body, flame, shieldMesh, smoke, underglow, wheels, brakeMat,
    chassis: ch.chassis, vehicleId: spec.id,
    pos:new THREE.Vector3(), vel:new THREE.Vector3(), yaw:0, speed:0,
    lap:0, checkpoint:0, trackIdx:0, progress:0, isPlayer, color, idx,
    cstate,
    maxSpeed: spec.top, accelMult: spec.accel, handlingMult: spec.handling,
    maxHP: spec.hp, fuelMax: spec.fuel, fuelUse: spec.fuelUse,
    boostTime:0, targetIdx:0, stuckTime:0,
    fireCooldown:0,
    dodgeDir:0,
    vy:0, jumpY:0, airborne:false,
    oilT:0, rampCd:0, // Phase 10 hazard status
    fuel: spec.fuel, out: false, outReason: null, // Phase 8 resources
  };
  applyVehicleStats(car, isPlayer);
  resetMounts(car.cstate, mountsFor(car));
  tryFitModel(car, spec); // glTF if configured, else stays procedural
  return car;
}
const cars=[];
const botColors=[0x2d7dff,0xffcc00,0x2ecc71,0xcc2dff,0xff7a00];
const player=makeCar(0xff2d2d,true,0); cars.push(player);
for(let i=0;i<AI_COUNT;i++) cars.push(makeCar(botColors[i%botColors.length], false, i+1));

function placeCars(){
  const start=sampled[0], tg=sampledTangents[0]; const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
  const offsets=[-6,-2,2,-6,-2,2], rows=[-8,-14];
  cars.forEach((c,i)=>{
    const col=offsets[i], row=rows[Math.floor(i/3)];
    c.pos.set(start.x - tg.x*(-row) + nnx*col, 0, start.z - tg.z*(-row) + nnz*col);
    c.yaw=Math.atan2(tg.x,tg.z); c.vel.set(0,0,0); c.speed=0; c.lap=0; c.checkpoint=0; c.trackIdx=0; c.progress=0; c.boostTime=0; c.stuckTime=0; c.targetIdx=10+i*3; c.fireCooldown=0; c.dodgeDir=0; c.vy=0; c.jumpY=0; c.airborne=false; c.oilT=0; c.rampCd=0;
    // Phase 8: fresh fuel + mounted reserve each race; clear out flags
    // Phase 9: re-derive stats (upgrades may have changed in garage)
    applyVehicleStats(c, c.isPlayer);
    c.fuel=c.fuelMax; c.out=false; c.outReason=null;
    resetMounts(c.cstate, mountsFor(c));
    c.mesh.visible=true;
    lowFuelWarned=false;
    c.cstate.health=c.maxHP; c.cstate.maxHealth=c.maxHP; c.cstate.wrecked=false; c.cstate.invuln=0; c.cstate.shield=0; c.cstate.disabled=0; c.cstate.weapon=null; c.cstate.damageFlash=0; c.cstate.lastAttacker=null;
    c.mesh.position.copy(c.pos); c.mesh.rotation.y=c.yaw; c.mesh.visible=true; c.body.material.transparent=false; c.body.material.opacity=1;
    c.shieldMesh.visible=false; c.smoke.material.opacity=0;
  });
  projectiles.length=0; projectileMeshes.forEach(m=>scene.remove(m)); projectileMeshes.length=0;
  coinsTokens.forEach(t=>{ const mm=coinsTokenMeshes[coinsTokens.indexOf(t)]; if(mm) scene.remove(mm); });
  coinsTokens.length=0; coinsTokenMeshes.forEach(m=>scene.remove(m)); coinsTokenMeshes.length=0;
  effects.forEach(e=>scene.remove(e.mesh)); effects.length=0;
  // reapply skin if changed
  if(player && profile.equippedSkin){
    const skin=GARAGE_SKINS.find(k=>k.id===profile.equippedSkin);
    if(skin) player.body.material.color.setHex(skin.color); if(player.underglow) player.underglow.material.color.setHex(skin.color);
  }
}

// ---------- PHASE 4 — online multiplayer (solo bots stay as practice forever) ----------
const onlineBtn = document.getElementById('onlineBtn');
const netDot = document.getElementById('netDot');
const onlineOverlay = document.getElementById('onlineOverlay');
const onlineClose = document.getElementById('onlineClose');
const netStatus = document.getElementById('netStatus');
const netName = document.getElementById('netName');
const netServer = document.getElementById('netServer');
const netCode = document.getElementById('netCode');
const quickMatchBtn = document.getElementById('quickMatchBtn');
const joinCodeBtn = document.getElementById('joinCodeBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const rosterList = document.getElementById('rosterList');
const chatFeed = document.getElementById('chatFeed');
const chatRow = document.getElementById('chatRow');
let netMode = 'solo'; // 'solo' | 'online'
let net = null;
let netNameSelf = 'Racer';
const remoteGhosts = []; // {car, netId, name, active}
for (let i = 0; i < 5; i++) {
  const g = makeCar(botColors[i % botColors.length], false, 10 + i);
  g.netRemote = true; g.netId = null; g.netName = '';
  g.mesh.visible = false;
  remoteGhosts.push({ car: g, netId: null, name: '', active: false });
}
function pushChatMsg(who, text) {
  if (!chatFeed) return;
  const div = document.createElement('div');
  div.textContent = `${who}: ${text}`;
  chatFeed.appendChild(div);
  while (chatFeed.children.length > 30) chatFeed.firstChild.remove();
  chatFeed.scrollTop = chatFeed.scrollHeight;
}
function renderRoster(roster) {
  if (!rosterList) return;
  if (!roster || !roster.length) { rosterList.textContent = 'No lobby yet.'; return; }
  renderRosterCache = roster;
  // Phase 13: tags for humans, never usernames.
  rosterList.innerHTML = roster.map((r) => `<div>${(net && r.id === net.clientId) ? '⭐ ' : ''}👤 ${r.tag || r.id} <span style="opacity:.5">${r.id}</span></div>`).join('') || 'Waiting…';
  const n = roster.length;
  if (lobbyInfo) lobbyInfo.textContent = isHost
    ? `PRIVATE ROOM ${net ? net.roomCode : ''} — ${n}/6 racers`
    : `SEARCHING… ${n}/6 racers — starts full or in ~15 s (bots fill)`;
  if (inviteRow) inviteRow.style.display = isHost && net && net.roomCode ? '' : 'none';
  if (inviteLink && net && net.roomCode) inviteLink.textContent = inviteURL(net.roomCode);
  if (botsRow) botsRow.style.display = isHost ? 'flex' : 'none';
  if (startBtn) startBtn.style.display = isHost ? '' : 'none';
}
let renderRosterCache = [];
function setOnlineMode(on) {
  netMode = on ? 'online' : 'solo';
  if (!on) netPractice = false;
  // Phase 12 practice: bots stay visible (solo grid + server session)
  for (const c of cars) { if (!c.isPlayer) c.mesh.visible = !on || netPractice; }
  if (!on) for (const g of remoteGhosts) { g.active = false; g.netId = null; g.car.mesh.visible = false; }
  if (onlineBtn) onlineBtn.classList.toggle('online', on);
  if (netDot) netDot.classList.toggle('on', on);
  if (netStatus) netStatus.textContent = on ? (netPractice ? `PRACTICE room ${net ? net.roomCode : ''} — bots + server wallet` : `ONLINE room ${net ? net.roomCode : ''} — real humans, bots hidden`) : 'Solo mode (bots). Connect to race real humans.';
}
function openOnline() { if (onlineOverlay) onlineOverlay.classList.add('show'); }
function closeOnline() { if (onlineOverlay) onlineOverlay.classList.remove('show'); }
if (onlineBtn) onlineBtn.addEventListener('click', openOnline);
if (onlineClose) onlineClose.addEventListener('click', closeOnline);
// Phase 13: no username/server boxes — baked server + server tags (netName/netServer elements removed).
if (chatRow && !chatRow.children.length) {
  QUICK_CHAT.forEach((q) => {
    const b = document.createElement('button');
    b.textContent = q;
    b.addEventListener('click', () => { if (net && net.online) net.sendEmote(q); else pushChatMsg('solo', q); });
    chatRow.appendChild(b);
  });
}
// ---------- PHASE 16 connection states: connecting / waking (60s countdown) / failed ----------
const connOverlay = document.getElementById('connOverlay');
const connTitle = document.getElementById('connTitle');
const connSub = document.getElementById('connSub');
const connCount = document.getElementById('connCount');
const connSpin = document.getElementById('connSpin');
const connRetryBtn = document.getElementById('connRetryBtn');
let connTimer = null;
function showConnState(state, detail){
  if (!connOverlay) return;
  connOverlay.classList.add('show');
  if (connRetryBtn) connRetryBtn.style.display = state === 'failed' ? 'block' : 'none';
  if (connSpin) connSpin.style.display = state === 'failed' ? 'none' : 'block';
  if (state === 'connecting') { connTitle.textContent = 'CONNECTING'; connSub.textContent = detail || 'Finding the fastest server…'; connCount.textContent = ''; }
  if (state === 'waking') { connTitle.textContent = 'SERVER WAKING UP'; connSub.textContent = 'Free server spins down when idle — first load takes up to a minute.'; }
  if (state === 'failed') { connTitle.textContent = 'CONNECTION FAILED'; connSub.textContent = detail || 'Could not reach the server. Check your internet and retry.'; connCount.textContent = ''; }
  if (state === 'hide') connOverlay.classList.remove('show');
}
function startWakeCountdown(seconds = 60){
  stopWakeCountdown();
  const t0 = Date.now();
  connTimer = setInterval(()=>{
    const left = Math.max(0, seconds - Math.floor((Date.now() - t0) / 1000));
    if (connCount) connCount.textContent = left + 's';
    if (left <= 0) stopWakeCountdown();
  }, 250);
}
function stopWakeCountdown(){ if (connTimer) { clearInterval(connTimer); connTimer = null; } if (connCount) connCount.textContent = ''; }
if (connRetryBtn) connRetryBtn.addEventListener('click', ()=>{ showConnState('connecting'); connectNet(lobbyMode || 'quick'); });

async function ensureConnected() {
  if (net && net.connected) return true;
  const url = resolveServerURL();
  const t0 = Date.now();
  showConnState('connecting', url.replace(/^wss?:\/\//, ''));
  if (netStatus) netStatus.textContent = 'Connecting…';
  try {
    if (net) { try { net.disconnect(); } catch {} }
    net = new NetClient();
    wireNet(net);
    // Free-tier hosts (Render) sleep: if the first attempt takes >4s, switch to
    // the 'server waking up' state with a 60s countdown instead of a dead screen.
    const slowTimer = setTimeout(()=>{ if (!(net && net.connected)) { showConnState('waking'); startWakeCountdown(60); } }, 4000);
    try {
      await net.connect(url);
    } finally {
      clearTimeout(slowTimer);
    }
    stopWakeCountdown();
    showConnState('hide');
    rememberServerURL(url);
    net.hello('', profile.equippedSkin || 'default', getAccountId());
    await new Promise((r) => setTimeout(r, 250));
    return true;
  } catch (e) {
    stopWakeCountdown();
    showConnState('failed', `${url.replace(/^wss?:\/\//, '')} — ${(e && e.message) || 'unreachable'}`);
    if (netStatus) netStatus.textContent = 'Connect failed — retry.';
    setOnlineMode(false);
    return false;
  }
}
// Phase 13 lobby flows. Practice starts instantly (bots + server).
// Quick/private wait for the server START signal (15 s auto-fill).
let lobbyMode = null;
let isHost = false;
async function connectNet(mode, codeOverride) {
  openOnline();
  if (!await ensureConnected()) return;
  lobbyMode = mode;
  isHost = (mode === 'host');
  netPractice = (mode === 'practice');
  if (mode === 'code') {
    const code = ((codeOverride || (netCode && netCode.value.trim())) || '').toUpperCase();
    if (!code) { if (netStatus) netStatus.textContent = 'Paste an invite room code.'; return; }
    net.joinCode(code);
  } else if (mode === 'host') net.joinHost();
  else if (mode === 'practice') net.joinPractice();
  else net.joinQuick();
  setOnlineMode(true);
  if (mode === 'practice') {
    // instant start, full bot grid, server-backed wallet
    hideLobbyPanel();
    restart();
    startGame();
    if (netStatus) netStatus.textContent = 'Practice — bots + server wallet.';
  } else {
    showLobbyPanel();
    if (netStatus) netStatus.textContent = mode === 'host' ? 'Private room ready — share the invite link.' : 'Searching for racers… (bots fill after ~15 s)';
  }
}
function inviteURL(code) {
  try { return location.origin + location.pathname + '?room=' + code; }
  catch { return '?room=' + code; }
}
// ?room=CODE deep link: connect + drop straight into the waiting lobby.
setTimeout(() => {
  try {
    const code = new URLSearchParams(location.search).get('room');
    if (code) {
      openOnline();
      if (netCode) netCode.value = code.toUpperCase();
      connectNet('code', code);
    }
  } catch {}
}, 600);
function wireNet(n) {
  n.onRoster = (roster) => {    renderRoster(roster);
    if (netStatus && n.roomCode) netStatus.textContent = `Room ${n.roomCode} — ${roster.length}/6 racers`;
  };
  n.onEmote = (m) => pushChatMsg(m.name || m.from, m.text);
  n.onFire = () => {};
  n.onAccount = (m) => {
    if (m.accountId) setAccountId(m.accountId);
    flushBannerQueue(); // Phase 11: send queued offline banner events
    // Phase 13: tag identity + server wallet mirror (server is truth, no local wallet).
    if (m.tag) {
      profile.tag = m.tag;
      if (net) net.tag = m.tag;
      const tagVal = document.getElementById('tagVal');
      if (tagVal) tagVal.textContent = m.tag;
    }
    if (typeof m.coins === 'number') profile.coins = m.coins;
    if (typeof m.gems === 'number') profile.gems = m.gems;
    if (typeof m.xp === 'number' && m.xp > profile.xp) profile.xp = m.xp;
    refreshEconHUD();
    if (netStatus && n.roomCode) netStatus.textContent = `Room ${n.roomCode} — server wallet $${m.coins} · ${m.xp}XP`;
    // Phase 9: server inventory (shop-confirmed) merges into local profile
    if (m.inventory) {
      migrateShop(profile);
      let changed = false;
      for (const v of (m.inventory.vehicles || [])) if (!profile.vehicles.includes(v)) { profile.vehicles.push(v); changed = true; }
      for (const w of (m.inventory.weapons || [])) if (!profile.weapons.includes(w)) { profile.weapons.push(w); changed = true; }
      Object.assign(profile.upgrades, m.inventory.upgrades || {});
      if (changed && garageOverlay && garageOverlay.classList.contains('show')) renderGarage();
      persistProfile(true);
    }
  };
  // Phase 9: server purchase verdicts
  n.onBuy = (m) => {
    pendingBuy = null;
    if (!m.ok) { popCoins(`SHOP: ${m.reason || 'denied'}`,''); renderGarage(); return; }
    const fn = m.kind === 'vehicle' ? () => buyVehicle(profile, m.item, { server: true })
      : m.kind === 'weapon' ? () => buyWeapon(profile, m.item, { server: true })
      : () => buyUpgrade(profile, m.vehicle, m.item, { server: true });
    const r = fn();
    if (typeof m.coins === 'number') profile.coins = m.coins;
    if (typeof m.gems === 'number') profile.gems = m.gems;
    if (m.kind === 'vehicle' && r.ok) { equipVehicle(profile, m.item); setPlayerVehicle(m.item); }
    if (m.kind === 'upgrade' && r.ok) applyVehicleStats(player, true);
    refreshEconHUD(); persistProfile(true); renderGarage();
    sfx('pickup');
    popCoins(r.ok ? 'PURCHASED ✓' : `SHOP: ${r.reason}`,'xp');
  };
  // Phase 12: server-owned revive verdict (gems deducted server-side).
  n.onReviveOk = (m) => {
    pendingRevive = false;
    if(!m.ok){ popCoins(`REVIVE: ${m.reason || 'denied'}`,''); showReviveOverlay(); return; }
    if(typeof m.gems === 'number') profile.gems = m.gems;
    refreshEconHUD(); persistProfile(true);
    popCoins(`-${m.cost} 💎 (server)`,'gem');
    applyPlayerRevive();
  };
  // Phase 13 race start: countdown, then local grid sized by the server.
  n.onStart = (m) => {
    hideLobbyPanel();
    closeOnline();
    const bots = Math.max(0, Math.min(5, m.bots | 0));
    const humans = Array.isArray(m.humans) ? m.humans.length : 0;
    let sec = Math.max(1, m.inSec | 0 || 3);
    paused = false; pauseOverlay.classList.remove('show');
    centerMsg.style.display = '';
    const tick = () => {
      if (sec > 0) {
        centerMsg.innerHTML = `<h1>${sec}</h1><p>${humans} HUMANS + ${bots} BOTS — GET READY</p>`;
        sec--;
        setTimeout(tick, 1000);
      } else {
        restart();
        setBotCount(bots);
        startGame();
        popCoins(`${humans}V${bots}B — RACE!`, 'xp');
      }
    };
    tick();
  };
  // Phase 13: mid-race drops pause the game and return to the lobby.
  n.onDisconnect = () => {
    // PHASE 16 fix: a failed connect used to land here and setOnlineMode(false)
    // instantly cleared the connection overlay — hiding CONNECTING/WAKING/FAILED.
    // Only treat as a mid-race drop when a race had actually started.
    if (connOverlay && connOverlay.classList.contains('show')) return; // a conn state screen owns the UI
    if (!started || finished) { setOnlineMode(false); return; }
    paused = true;
    window.__dropLobby = true;
    pauseTitle.textContent = 'DISCONNECTED';
    pauseSub.textContent = 'Connection lost. Reconnect to race.';
    pauseOverlay.classList.add('show');
    document.getElementById('restartBtn').textContent = 'BACK TO LOBBY';
  };
  n.onAward = (m) => {
    // Server is the only minter: apply its award to the local wallet mirror.
    if (typeof m.coins === 'number' && m.coins > 0) { addCoins(profile, m.coins); popCoins(`+$${m.coins} (${m.reason})`); }
    if (typeof m.xp === 'number' && m.xp > 0) {
      const r = grantXP(m.xp);
      popCoins(`+${m.xp} XP (${m.reason})`, 'xp');
      if (r.levelUp) popCoins(`LEVEL ${r.after}!`, 'xp');
    }
    refreshEconHUD(); persistProfile(true);
    supabaseSync(profile);
  };
  n.onBoard = (m) => {
    if (!rosterList) return;
    const rows = (m.entries || []).map((e, i) => `<div>${i + 1}. ${e.name} — ${e.xp}XP · ${e.wins}W/${e.races}</div>`).join('');
    rosterList.innerHTML = `<b>🏆 LEADERBOARD</b><br>${rows || 'No entries yet — finish a race!'}`;
  };
  n.onHit = (m) => {
    // Server-side hit registration is authoritative: trust its hp.
    if (m.targetId === n.clientId) {
      player.cstate.health = Math.max(0, m.hp);
      if (m.killed || player.cstate.health <= 0) { player.cstate.health = 0; onCarWrecked(player); }
      else { spawnHitSpark(player.pos); triggerHitFlash(true); }
    } else {
      const g = remoteGhosts.find((x) => x.netId === m.targetId);
      if (g) {
        g.car.cstate.health = Math.max(0, m.hp);
        if (m.killed) onCarWrecked(g.car);
      }
      pushKillFeedSilent(m.attackerId, m.targetId, m.weapon);
    }
  };
  n.onError = (m) => {
    if (m.correct) {
      player.pos.x = m.correct.x; player.pos.z = m.correct.z;
      player.vel.multiplyScalar(0.4);
    }
  };
}
function pushKillFeedSilent(attackerId, targetId, weapon) {
  try {
    // Phase 13: resolve roster tags so the feed shows RK-XXXX, never raw ids.
    const tagOf = (id) => {
      if (id === (net && net.clientId)) return profile.tag || id;
      const r = (renderRosterCache || []).find((x) => x.id === id);
      if (r && r.tag) return r.tag;
      for (const g of remoteGhosts) if (g.netId === id && g.name) return g.name;
      return id;
    };
    const div = document.createElement('div'); div.className = 'kill';
    div.textContent = `👤 ${tagOf(attackerId)} → ${tagOf(targetId)} (${weapon || 'hit'})`;
    killFeedEl.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 400); }, 2200);
  } catch {}
}
if (quickMatchBtn) quickMatchBtn.addEventListener('click', () => connectNet('quick'));
if (joinCodeBtn) joinCodeBtn.addEventListener('click', () => connectNet('code'));
const practiceBtn = document.getElementById('practiceBtn');
if (practiceBtn) practiceBtn.addEventListener('click', () => connectNet('practice'));
const hostBtn = document.getElementById('hostBtn');
if (hostBtn) hostBtn.addEventListener('click', () => connectNet('host'));
const lobbyPanel = document.getElementById('lobbyPanel');
const lobbyInfo = document.getElementById('lobbyInfo');
const inviteRow = document.getElementById('inviteRow');
const inviteLink = document.getElementById('inviteLink');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const botsRow = document.getElementById('botsRow');
const botsToggle = document.getElementById('botsToggle');
const startBtn = document.getElementById('startBtn');
function showLobbyPanel() { if (lobbyPanel) lobbyPanel.style.display = ''; }
function hideLobbyPanel() { if (lobbyPanel) lobbyPanel.style.display = 'none'; }
if (copyInviteBtn) copyInviteBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteLink.textContent); popCoins('LINK COPIED', 'xp'); }
  catch { popCoins(inviteLink.textContent, ''); }
});
if (startBtn) startBtn.addEventListener('click', () => {
  if (!net || !isHost) return;
  net.sendStartReq(botsToggle ? botsToggle.checked : true);
  startBtn.disabled = true;
});
// Phase 13 race start: server START → countdown → local grid (humans + N bots).
function setBotCount(n) {
  let shown = 0;
  cars.forEach((c) => {
    if (c.isPlayer) return;
    if (shown < n) { shown++; c.out = false; c.mesh.visible = true; }
    else { c.out = true; c.outReason = 'bench'; c.mesh.visible = false; }
  });
}
if (disconnectBtn) disconnectBtn.addEventListener('click', () => {
  try { if (net) net.disconnect(); } catch {}
  setOnlineMode(false);
  restart();
  if (netStatus) netStatus.textContent = 'Solo mode (bots). Connect to race real humans.';
  if (rosterList) rosterList.textContent = 'No lobby yet.';
});
const boardBtn = document.getElementById('boardBtn');
if (boardBtn) boardBtn.addEventListener('click', () => {
  if (net && net.online) net.requestBoard();
  else if (rosterList) rosterList.innerHTML = '<b>🏆 LEADERBOARD</b><br>Connect online to see the board.';
});
const syncCodeEl = document.getElementById('syncCode');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
if (exportBtn) exportBtn.addEventListener('click', () => {
  try { if (syncCodeEl) syncCodeEl.value = exportSyncCode(profile); } catch {}
});
if (importBtn) importBtn.addEventListener('click', () => {
  try {
    if (!syncCodeEl || !syncCodeEl.value.trim()) return;
    profile = importSyncCode(syncCodeEl.value);
    refreshEconHUD(); persistProfile(true); renderGarage();
  } catch { popCoins('BAD SYNC CODE'); }
});
// Phase 6 live-ops UI: tracks, daily, season.
const trackRow = document.getElementById('trackRow');
const dailyInfo = document.getElementById('dailyInfo');
const seasonInfo = document.getElementById('seasonInfo');
const claimSeasonBtn = document.getElementById('claimSeasonBtn');
function renderLiveops() {
  if (trackRow && !trackRow.children.length) {
    TRACKS.forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.name;
      b.style.cssText = 'flex:1;padding:8px 4px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-weight:800;font-size:10px;pointer-events:auto';
      b.title = t.desc;
      b.addEventListener('click', () => {
        switchTrack(i);
        [...trackRow.children].forEach((x, j) => x.style.background = j === currentTrackIdx ? '#ffcc00' : 'rgba(255,255,255,.08)');
        [...trackRow.children].forEach((x, j) => x.style.color = j === currentTrackIdx ? '#111' : '#fff');
      });
      trackRow.appendChild(b);
    });
  }
  if (trackRow) [...trackRow.children].forEach((x, j) => { x.style.background = j === currentTrackIdx ? '#ffcc00' : 'rgba(255,255,255,.08)'; x.style.color = j === currentTrackIdx ? '#111' : '#fff'; });
  if (dailyInfo) {
    const d = getDailyState();
    dailyInfo.textContent = `📅 ${d.challenge.title} — ${d.claimed ? 'claimed today ✓' : 'unclaimed (finish a race!)'}`;
  }
  if (seasonInfo) {
    const s = seasonProgress(profile);
    seasonInfo.textContent = `🏁 Season ${SEASON_ID}: ${s.pts} pts — next: ${s.next ? s.next.label : 'all claimed ✓'}`;
  }
}
if (claimSeasonBtn) claimSeasonBtn.addEventListener('click', () => {
  const s = seasonProgress(profile);
  if (!s.next) { popCoins('SEASON COMPLETE'); return; }
  const r = claimSeasonReward(profile, s.next.points);
  if (r.ok) { refreshEconHUD(); persistProfile(true); popCoins(`+${r.gems} 💎 ${r.label}`, 'gem'); renderLiveops(); }
  else popCoins('NOT ENOUGH PTS');
});
setInterval(() => {
  if (netMode !== 'online' || !net || !net.online || !started || paused || finished) return;
  if (player.cstate.wrecked) return;
  try {
    net.sendInput({
      steer: 0, accel: 1, boost: player.boostTime > 0, fire: false,
      pos: player.pos, yaw: player.yaw, speed: player.speed,
      hp: player.cstate.health, wrecked: false, lap: player.lap,
      fuel: Math.round(player.fuel), // Phase 12: server clamps 0..fuelMax
    });
  } catch {}
}, 50);
function updateRemoteGhosts() {
  if (netMode !== 'online' || !net) return;
  const states = net.getRemoteStates();
  const byId = new Map(states.map((s) => [s.id, s]));
  for (const g of remoteGhosts) {
    if (g.netId && byId.has(g.netId)) {
      const s = byId.get(g.netId);
      g.name = s.name || g.name; g.active = true;
      g.car.netName = g.name;
      g.car.mesh.visible = true;
      g.car.pos.set(s.x, 0, s.z);
      g.car.yaw = s.yaw; g.car.speed = s.speed; g.car.lap = s.lap || 0;
      g.car.cstate.health = s.hp; g.car.cstate.wrecked = !!s.wrecked;
      g.car.mesh.position.set(s.x, 0.15, s.z);
      g.car.mesh.rotation.y = s.yaw;
      const near = nearestTrackIdx(g.car.pos);
      g.car.trackIdx = near.idx;
      g.car.progress = g.car.lap + near.idx / TRACK_SAMPLES;
    } else {
      const unused = states.find((x) => !remoteGhosts.some((r) => r.active && r.netId === x.id));
      if (unused) {
        g.netId = unused.id; g.name = unused.name || 'Rival'; g.active = true;
        g.car.netName = g.name;
        g.car.mesh.visible = true;
      } else { g.active = false; g.netId = null; g.car.mesh.visible = false; }
    }
  }
  for (const g of remoteGhosts) {
    if (g.active && g.netId && !byId.has(g.netId)) { g.active = false; g.netId = null; g.car.mesh.visible = false; }
  }
}
function reconcilePlayer() {
  if (netMode !== 'online' || !net) return;
  try {
    const fix = net.reconcile(player.pos);
    if (fix) {
      player.pos.x = fix.x; player.pos.z = fix.z;
      if (fix.snapped) player.vel.multiplyScalar(0.4);
    }
  } catch {}
}
// (pickupMeshes moved to top of file)
// Phase 8: pickups are bonus extras — weapons plus fuel/ammo. Weapons still expire.
function pickupColor(type){
  if(WEAPON_DEFS[type]) return WEAPON_DEFS[type].color;
  return { fuel:0x2ecc71, ammo:0xff9a3d }[type] || 0xffffff;
}
function pickupIcon(type){
  if(WEAPON_DEFS[type]) return WEAPON_DEFS[type].icon;
  return { fuel:'⛽', ammo:'📦' }[type] || '❔';
}
function rollPhase8Pickup(){
  const r = Math.random();
  if(r<0.24) return 'rocket';
  if(r<0.46) return 'mg';
  if(r<0.58) return 'mine';
  if(r<0.68) return 'shield';
  if(r<0.81) return 'fuel';
  if(r<0.88) return 'ammo';
  if(r<0.93) return 'plasma';
  if(r<0.96) return 'railgun';
  if(r<0.98) return 'emp';
  return 'swarm';
}
function createPickupMesh(type){
  const colors={rocket:0xff3b30, mg:0xffcc00, mine:0x8a2be2, shield:0x2de2ff, fuel:0x2ecc71, ammo:0xff9a3d, plasma:0x39ff88, railgun:0x66ccff, emp:0xffe14d, swarm:0xff8a3d};
  const grp=new THREE.Group();
  let geo, mat;
  if(type==='rocket'){ geo=new THREE.CylinderGeometry(0.18,0.18,1.2,8); mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(geo,mat); m.rotation.z=Math.PI/2; grp.add(m); const tip=new THREE.Mesh(new THREE.ConeGeometry(0.24,0.5,8), mat); tip.rotation.z=-Math.PI/2; tip.position.x=0.7; grp.add(tip); }
  else if(type==='mg'){ geo=new THREE.BoxGeometry(1.0,0.25,0.45); mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(geo,mat); grp.add(m); }
  else if(type==='mine'){ geo=new THREE.SphereGeometry(0.45,10,8); mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(geo,mat); m.scale.y=0.65; grp.add(m); const ring=new THREE.Mesh(new THREE.TorusGeometry(0.36,0.06,6,12), new THREE.MeshBasicMaterial({color:0xff0000})); ring.rotation.x=Math.PI/2; grp.add(ring); }
  else if(type==='fuel'){ mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.9,0.45), mat); grp.add(m); const h=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.25,0.2), new THREE.MeshLambertMaterial({color:0x222222})); h.position.y=0.55; grp.add(h); }
  else if(type==='ammo'){ mat=new THREE.MeshLambertMaterial({color:0x555555}); const m=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.6,0.6), mat); grp.add(m); const s=new THREE.Mesh(new THREE.BoxGeometry(0.92,0.18,0.62), new THREE.MeshLambertMaterial({color:colors[type]})); grp.add(s); }
  else if(type==='plasma'){ mat=new THREE.MeshBasicMaterial({color:colors[type]}); const m=new THREE.Mesh(new THREE.IcosahedronGeometry(0.55,0), mat); grp.add(m); }
  else if(type==='railgun'){ mat=new THREE.MeshBasicMaterial({color:colors[type]}); const m=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,1.5), mat); grp.add(m); }
  else if(type==='emp'){ mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(new THREE.TorusGeometry(0.45,0.16,8,14), mat); grp.add(m); }
  else if(type==='swarm'){ mat=new THREE.MeshLambertMaterial({color:colors[type]}); for(let k=0;k<3;k++){ const m=new THREE.Mesh(new THREE.ConeGeometry(0.16,0.55,6), mat); m.position.set((k-1)*0.35, (k%2)*0.3, 0); grp.add(m); } }
  else { geo=new THREE.OctahedronGeometry(0.55,0); mat=new THREE.MeshLambertMaterial({color:colors[type]}); const m=new THREE.Mesh(geo,mat); grp.add(m); }
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.75,0.08,12), new THREE.MeshBasicMaterial({color:colors[type], transparent:true, opacity:0.22})); base.position.y=-0.45; grp.add(base);
  // glow sprite
  const glow=new THREE.Mesh(new THREE.CircleGeometry(0.9,12), new THREE.MeshBasicMaterial({color:colors[type], transparent:true, opacity:0.18})); glow.rotation.x=-Math.PI/2; glow.position.y=0.02; grp.add(glow);
  // label
  return grp;
}
function spawnPickups(){
  pickups.length=0; pickupMeshes.forEach(m=>scene.remove(m)); pickupMeshes.length=0;
  for(let i=0;i<PICKUP_COUNT;i++){
    const idx=Math.floor((i+0.5)/PICKUP_COUNT * TRACK_SAMPLES);
    const base=sampled[idx], tg=sampledTangents[idx];
    const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
    const jitter=(Math.random()-0.5)*9;
    const x=base.x+nnx*jitter, z=base.z+nnz*jitter;
    const type=rollPhase8Pickup();
    const state=createPickupState(i, idx, {x,z});
    state.type=type; state.pos={x, y:0.35, z}; state.alive=true; state.respawnIn=0;
    pickups.push(state);
    const mesh=createPickupMesh(type); mesh.position.set(x,0.55,z); mesh.userData.type=type; scene.add(mesh); pickupMeshes.push(mesh);
  }
  addShortcutCachePickups(); // Phase 10: hidden caches on secret cuts
}

// ---------- PHASE 8 — roadblocks (destructible / steer-around / heavy) ----------
const blocks=[];
const blockMeshes=[];
function makeBlockMesh(type){
  const grp = new THREE.Group();
  const solid = (geo, color, y=0) => {
    const m = new THREE.Mesh(geo, IS_HIGH()
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15 })
      : new THREE.MeshLambertMaterial({ color }));
    m.position.y = y; m.castShadow = IS_HIGH(); grp.add(m); return m;
  };
  if (type === 'cone') {
    solid(new THREE.ConeGeometry(0.7, 1.5, 10), 0xff6a00, 0.75);
    solid(new THREE.CylinderGeometry(0.55, 0.62, 0.18, 10), 0xffffff, 0.09);
  } else if (type === 'barrier') {
    solid(new THREE.BoxGeometry(3.4, 0.9, 0.6), 0xe8e8e8, 0.75);
    solid(new THREE.BoxGeometry(3.42, 0.28, 0.62), 0xdd2222, 1.05);
    for (const s of [-1.4, 1.4]) { const leg = solid(new THREE.BoxGeometry(0.25, 0.7, 0.5), 0x333333, 0.35); leg.position.x = s; }
  } else if (type === 'armored') {
    solid(new THREE.BoxGeometry(3.8, 1.6, 1.3), 0x3a3f48, 0.9);
    solid(new THREE.BoxGeometry(3.82, 0.3, 1.32), 0xffcc00, 1.75);
    solid(new THREE.BoxGeometry(0.5, 0.5, 1.5), 0x222222, 0.35);
  } else if (type === 'gate') {
    // Phase 10 crash gate: tall striped door, smash through it
    solid(new THREE.BoxGeometry(3.6, 2.2, 0.4), 0xff7a00, 1.1);
    solid(new THREE.BoxGeometry(3.62, 0.4, 0.42), 0xffffff, 1.9);
    solid(new THREE.BoxGeometry(3.62, 0.4, 0.42), 0x111111, 1.35);
    for (const s of [-1.7, 1.7]) solid(new THREE.BoxGeometry(0.3, 2.2, 0.3), 0x333338, 1.1).position.x = s;
  } else { // tires: indestructible wall, must steer around
    for (let s = 0; s < 3; s++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.3, 8, 14), new THREE.MeshLambertMaterial({ color: s === 1 ? 0xaa2222 : 0x1a1a1a }));
      t.position.set((s - 1) * 1.35, 0.62, 0); t.castShadow = IS_HIGH(); grp.add(t);
    }
  }
  return grp;
}
function spawnRoadblocks(){
  for (const m of blockMeshes) scene.remove(m);
  blocks.length = 0; blockMeshes.length = 0;
  const layout = genRoadblocks(TRACKS[currentTrackIdx].id, BLOCK_COUNT);
  for (const L of layout) {
    const idx = Math.floor(L.trackT * TRACK_SAMPLES) % TRACK_SAMPLES;
    const base = sampled[idx], tg = sampledTangents[idx];
    const nx = -tg.z, nz = tg.x; const len = Math.hypot(nx, nz) || 1;
    const x = base.x + nx / len * L.lateral, z = base.z + nz / len * L.lateral;
    const def = BLOCK_TYPES[L.type];
    blocks.push({ id: L.id, type: L.type, hp: def.hp, maxHp: def.hp, alive: true, respawnIn: 0, pos: new THREE.Vector3(x, 0, z), yaw: Math.atan2(tg.x, tg.z) });
    const mesh = makeBlockMesh(L.type);
    mesh.position.set(x, 0, z); mesh.rotation.y = Math.atan2(tg.x, tg.z);
    scene.add(mesh); blockMeshes.push(mesh);
  }
}
function resetRoadblocks(){
  blocks.forEach((b, i) => {
    const def = BLOCK_TYPES[b.type];
    b.hp = def.hp; b.alive = true; b.respawnIn = 0;
    if (blockMeshes[i]) { blockMeshes[i].visible = true; blockMeshes[i].scale.setScalar(1); }
  });
}
function destroyBlock(b, i, silent = false){
  b.alive = false; b.respawnIn = BLOCK_RESPAWN_S;
  if (blockMeshes[i]) blockMeshes[i].visible = false;
  if (!silent) spawnExplosion(b.pos, b.type === 'armored' ? 0xffcc00 : 0xff6a00, b.type === 'armored' ? 1.3 : 0.9, b.type === 'armored' ? 16 : 10); // boom sfx inside
}
function damageBlock(b, i, dmg){
  const def = BLOCK_TYPES[b.type];
  if (!b.alive || def.hp < 0) return false; // tires indestructible
  b.hp -= dmg;
  const m = blockMeshes[i];
  if (m) { m.scale.setScalar(1.12); setTimeout(() => m.scale.setScalar(1), 90); }
  if (b.hp <= 0) { destroyBlock(b, i); return true; }
  return false;
}
function tickBlocks(dt){
  blocks.forEach((b, i) => {
    if (b.alive) return;
    b.respawnIn -= dt;
    if (b.respawnIn <= 0) {
      const def = BLOCK_TYPES[b.type];
      b.hp = def.hp; b.alive = true;
      if (blockMeshes[i]) blockMeshes[i].visible = true;
    }
  });
}
// ---------- PHASE 10 — hazards + ramps ----------
function tickHazards(dt){
  for(const c of cars){
    if(c.out || c.cstate.wrecked) continue;
    if(c.rampCd>0) c.rampCd-=dt;
    if(c.oilT>0) c.oilT-=dt;
    for(const h of hazards){
      const dx=c.pos.x-h.x, dz=c.pos.z-h.z;
      if(dx*dx+dz*dz > h.r*h.r) continue;
      if(h.type==='oil'){
        if(c.oilT<=0 && c.isPlayer) popCoins('OIL SLICK!', '');
        c.oilT=HAZARD_TUNING.oil.effectTime;
      } else {
        const res=applyDamage(c.cstate, HAZARD_TUNING.debris.dps*dt, null, gameTime);
        if(res.killed) onCarWrecked(c);
        c.vel.multiplyScalar(1-HAZARD_TUNING.debris.slowPerSec*dt);
        if(Math.random()<dt*6) spawnHitSpark(c.pos);
      }
    }
    // ramps launch grounded fast cars
    if(!c.airborne && (c.rampCd||0)<=0 && c.speed>10){
      for(const r of ramps){
        const dx=c.pos.x-r.x, dz=c.pos.z-r.z;
        if(dx*dx+dz*dz < 3.4*3.4){
          c.vy=RAMP_VY; c.airborne=true; c.rampCd=1.2;
          if(c.isPlayer){ sfx('jump'); popCoins('RAMP!', 'xp'); }
          break;
        }
      }
    }
  }
}

// ---------- PHASE 10 — shortcuts, hazards, ramps ----------
// (state moved to top of file: shortcutSegs / hazards / ramps)
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}
function inShortcut(x, z, pad = 0) {
  for (const s of shortcutSegs) {
    const rr = s.w / 2 + pad;
    if (segDist2(x, z, s.ax, s.az, s.bx, s.bz) < rr * rr) return s;
  }
  return null;
}
function computeShortcutSegs() {
  shortcutSegs = [];
  const tid = TRACKS[currentTrackIdx].id;
  for (const def of (SHORTCUT_DEFS[tid] || [])) {
    const A = sampled[Math.floor(def.a * TRACK_SAMPLES) % TRACK_SAMPLES];
    const B = sampled[Math.floor(def.b * TRACK_SAMPLES) % TRACK_SAMPLES];
    shortcutSegs.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, w: def.width || 9, claimed: false });
  }
}
function chordStrip(s) {
  const N = 16, pos = [], idxA = [], uv = [];
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
  const bow = Math.min(8, len * 0.08);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cx = s.ax + dx * t + nx * Math.sin(t * Math.PI) * bow;
    const cz = s.az + dz * t + nz * Math.sin(t * Math.PI) * bow;
    pos.push(cx + nx * s.w / 2, 0.005, cz + nz * s.w / 2, cx - nx * s.w / 2, 0.005, cz - nz * s.w / 2);
    uv.push(0, t * len / 8, 1, t * len / 8);
  }
  for (let i = 0; i < N; i++) { const a = i * 2, b = i * 2 + 1, na = (i + 1) * 2, nb = (i + 1) * 2 + 1; idxA.push(a, nb, b, a, na, nb); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idxA); g.computeVertexNormals(); return g;
}
function tireStack(x, z, yaw) {
  const grp = new THREE.Group();
  for (let s = 0; s < 3; s++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.3, 8, 12), new THREE.MeshLambertMaterial({ color: s === 1 ? 0xaa2222 : 0x1a1a1a }));
    t.position.set((s - 1) * 1.35, 0.62, 0); t.castShadow = IS_HIGH(); grp.add(t);
  }
  grp.position.set(x, 0, z); grp.rotation.y = yaw;
  trackGroup.add(grp); return grp;
}
function chevronBoard(x, z, yaw) {
  const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 32;
  const cx = cvs.getContext('2d');
  cx.fillStyle = '#ff7a00'; cx.fillRect(0, 0, 64, 32);
  cx.fillStyle = '#111';
  for (let k = -1; k < 3; k++) { cx.beginPath(); cx.moveTo(k * 20 + 8, 30); cx.lineTo(k * 20 + 20, 16); cx.lineTo(k * 20 + 8, 2); cx.lineTo(k * 20 + 14, 2); cx.lineTo(k * 20 + 26, 16); cx.lineTo(k * 20 + 14, 30); cx.fill(); }
  const tex = new THREE.CanvasTexture(cvs);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  m.position.set(x, 1.5, z); m.rotation.y = yaw;
  trackGroup.add(m);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.5, 0.25), stdMat(0x333338, 0.7, 0.2));
  leg.position.set(x, 0.4, z); trackGroup.add(leg);
}
function buildFeatureMeshes() {
  hazards = []; ramps = [];
  const tid = TRACKS[currentTrackIdx].id;
  // shortcut strips + funnels + signs
  for (const s of shortcutSegs) {
    const strip = new THREE.Mesh(chordStrip(s), IS_HIGH()
      ? new THREE.MeshStandardMaterial({ color: 0x2e2e36, roughness: 0.85, metalness: 0.05 })
      : new THREE.MeshLambertMaterial({ color: 0x2e2e36 }));
    strip.receiveShadow = IS_HIGH(); trackGroup.add(strip);
    const yaw = Math.atan2(s.bx - s.ax, s.bz - s.az);
    const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
    for (const end of [{ x: s.ax, z: s.az, f: -1 }, { x: s.bx, z: s.bz, f: 1 }]) {
      for (const side of [-1, 1]) {
        tireStack(end.x + nx * side * (s.w / 2 + 1.2) - dx / len * end.f * 2, end.z + nz * side * (s.w / 2 + 1.2) - dz / len * end.f * 2, yaw);
      }
      chevronBoard(end.x + nx * (s.w / 2 + 3.2), end.z + nz * (s.w / 2 + 3.2), yaw + Math.PI / 2);
    }
  }
  // hazards
  for (const hz of (HAZARD_DEFS[tid] || [])) {
    const idx = Math.floor(hz.t * TRACK_SAMPLES) % TRACK_SAMPLES;
    const base = sampled[idx], tg = sampledTangents[idx];
    const nx = -tg.z, nz = tg.x, l = Math.hypot(nx, nz) || 1;
    const x = base.x + nx / l * hz.lateral, z = base.z + nz / l * hz.lateral;
    if (hz.type === 'oil') {
      const slick = new THREE.Mesh(new THREE.CircleGeometry(hz.r, 20), IS_HIGH()
        ? new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.08, metalness: 0.7 })
        : new THREE.MeshBasicMaterial({ color: 0x0a0a12 }));
      slick.rotation.x = -Math.PI / 2; slick.position.set(x, 0.02, z); trackGroup.add(slick);
      const rim = new THREE.Mesh(new THREE.RingGeometry(hz.r - 0.5, hz.r, 20), new THREE.MeshBasicMaterial({ color: 0x7a2be2, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      rim.rotation.x = -Math.PI / 2; rim.position.set(x, 0.025, z); trackGroup.add(rim);
    } else {
      const decal = new THREE.Mesh(new THREE.CircleGeometry(hz.r, 16), new THREE.MeshBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.7 }));
      decal.rotation.x = -Math.PI / 2; decal.position.set(x, 0.015, z); trackGroup.add(decal);
      for (let k = 0; k < 8; k++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * hz.r * 0.8;
        const rock = new THREE.Mesh(new THREE.TetrahedronGeometry(0.35 + Math.random() * 0.3), stdMat(k % 2 ? 0x6a5a48 : 0x4a4a52, 0.9, 0));
        rock.position.set(x + Math.cos(a) * rr, 0.25, z + Math.sin(a) * rr);
        rock.rotation.set(Math.random() * 3, Math.random() * 3, 0); rock.castShadow = IS_HIGH();
        trackGroup.add(rock);
      }
    }
    hazards.push({ type: hz.type, x, z, r: hz.r });
  }
  // ramps (launch wedges)
  for (const rp of (RAMP_DEFS[tid] || [])) {
    const idx = Math.floor(rp.t * TRACK_SAMPLES) % TRACK_SAMPLES;
    const base = sampled[idx], tg = sampledTangents[idx];
    const nx = -tg.z, nz = tg.x, l = Math.hypot(nx, nz) || 1;
    const x = base.x + nx / l * rp.lateral, z = base.z + nz / l * rp.lateral;
    const yaw = Math.atan2(tg.x, tg.z);
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 4.5), stdMat(0xff9a3d, 0.6, 0.2));
    wedge.position.set(x, 0.45, z); wedge.rotation.y = yaw; wedge.rotation.x = -0.0;
    wedge.rotateOnAxis(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), -0.24);
    wedge.castShadow = IS_HIGH(); trackGroup.add(wedge);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 4.5), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
      stripe.position.set(x + Math.cos(yaw) * side * 2.6, 0.75, z - Math.sin(yaw) * side * 2.6);
      stripe.rotation.y = yaw; trackGroup.add(stripe);
    }
    ramps.push({ x, z, yaw });
  }
}
// hidden fuel+ammo cache at each shortcut midpoint (bonus extras)
function addShortcutCachePickups() {
  for (const s of shortcutSegs) {
    const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
    for (const [type, off] of [['fuel', -2], ['ammo', 2]]) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz) || 1;
      const x = mx + (-dz / l) * off, z = mz + (dx / l) * off;
      const state = createPickupState(pickups.length, 0, { x, z });
      state.type = type; state.cache = type; state.pos = { x, y: 0.35, z }; state.alive = true; state.respawnIn = 0;
      pickups.push(state);
      const mesh = createPickupMesh(type); mesh.position.set(x, 0.55, z); scene.add(mesh); pickupMeshes.push(mesh);
    }
  }
}

// ---------- PHASE 11 — banners (config-driven billboards) ----------
// Brands: solid, cannot be bumped. People: bumpable (drive in) + likeable
// (♥ button when close). Images via banners-config.json, procedural fallback.
let brandBoards = [];  // {id,x,z,r}
let peopleBoards = []; // {id,name,x,z,board,wobble,bumpCd,likeCd}
let bannerViewed = new Set();
let bannerQueue = [];  // offline events, flushed when online
let likeTarget = null;
const likeBtn = document.getElementById('likeBtn');
function updateLikeBtn(){
  if(!likeBtn) return;
  if(likeTarget && started && !paused && !finished){
    likeBtn.textContent = `♥ LIKE ${likeTarget.name}`;
    likeBtn.classList.add('show');
  } else likeBtn.classList.remove('show');
}
if(likeBtn) likeBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!likeTarget) return;
  sendBannerEvent('like', likeTarget.id);
  likeTarget.likeCd = 60;
  popCoins(`♥ ${likeTarget.name} LIKED!`, 'xp'); sfx('ui');
  likeTarget = null; updateLikeBtn();
});
function placeholderBoard(name, color, big) {
  const cvs = document.createElement('canvas');
  cvs.width = big ? 256 : 128; cvs.height = big ? 128 : 160;
  const cx = cvs.getContext('2d');
  cx.fillStyle = color || '#333'; cx.fillRect(0, 0, cvs.width, cvs.height);
  cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = 6; cx.strokeRect(4, 4, cvs.width - 8, cvs.height - 8);
  cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  if (big) {
    cx.font = '900 34px system-ui,sans-serif';
    cx.fillText(name, cvs.width / 2, cvs.height / 2);
  } else {
    cx.font = '900 64px system-ui,sans-serif';
    cx.fillText((name || '?')[0].toUpperCase(), cvs.width / 2, 62);
    cx.font = '900 22px system-ui,sans-serif';
    cx.fillText(name, cvs.width / 2, 128);
  }
  const tex = new THREE.CanvasTexture(cvs);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch {}
  return tex;
}
function tryBoardImage(mesh, image) {
  if (!image) return;
  try {
    new THREE.TextureLoader().load('./' + image,
      (tex) => { try { tex.colorSpace = THREE.SRGBColorSpace; } catch {} mesh.material.map = tex; mesh.material.needsUpdate = true; },
      undefined, () => {});
  } catch {}
}
function boardPos(t, lateral) {
  const idx = Math.floor(t * TRACK_SAMPLES) % TRACK_SAMPLES;
  const base = sampled[idx], tg = sampledTangents[idx];
  const nx = -tg.z, nz = tg.x, l = Math.hypot(nx, nz) || 1;
  return { x: base.x + nx / l * lateral, z: base.z + nz / l * lateral, yaw: Math.atan2(tg.x, tg.z) };
}
function buildBannerMeshes() {
  brandBoards = []; peopleBoards = [];
  const tid = TRACKS[currentTrackIdx].id;
  for (const b of (BANNERS_CONFIG.brands || []).filter((x) => x.track === tid)) {
    const p = boardPos(b.t, b.lateral);
    const grp = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.4),
      new THREE.MeshBasicMaterial({ map: placeholderBoard(b.name, b.color, true), side: THREE.DoubleSide }));
    face.position.y = 5.2; face.rotation.y = p.yaw + Math.PI / 2; grp.add(face);
    tryBoardImage(face, b.image);
    for (const s of [-3.6, 3.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.2, 0.5), stdMat(0x2a2a32, 0.7, 0.3));
      leg.position.set(p.x + Math.cos(p.yaw) * s, 2.6, p.z - Math.sin(p.yaw) * s);
      leg.castShadow = IS_HIGH(); trackGroup.add(leg);
    }
    grp.position.set(p.x, 0, p.z);
    trackGroup.add(grp);
    brandBoards.push({ id: b.id, x: p.x, z: p.z, r: 5.5 });
  }
  for (const b of (BANNERS_CONFIG.people || []).filter((x) => x.track === tid)) {
    const p = boardPos(b.t, b.lateral);
    const grp = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.75),
      new THREE.MeshBasicMaterial({ map: placeholderBoard(b.name, b.color, false), side: THREE.DoubleSide }));
    board.position.y = 2.4; grp.add(board);
    tryBoardImage(board, b.image);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.4, 8), stdMat(0x3a3a42, 0.6, 0.4));
    post.position.y = 0.6; grp.add(post);
    grp.position.set(p.x, 0, p.z);
    grp.rotation.y = p.yaw + Math.PI / 2;
    trackGroup.add(grp);
    peopleBoards.push({ id: b.id, name: b.name, x: p.x, z: p.z, board, grp, wobble: 0, bumpCd: 0, likeCd: 0 });
  }
}
function sendBannerEvent(action, id) {
  if (isOnline() && typeof net !== 'undefined' && net) {
    try { net.sendBanner(action, id); return; } catch {}
  }
  // offline: queue for later (cap 200)
  bannerQueue.push({ action, id, t: Date.now() });
  if (bannerQueue.length > 200) bannerQueue.splice(0, bannerQueue.length - 200);
  try { localStorage.setItem('rk.banners.queue', JSON.stringify(bannerQueue)); } catch {}
}
function flushBannerQueue() {
  if (!bannerQueue.length || !isOnline() || typeof net === 'undefined' || !net) return;
  try { bannerQueue = JSON.parse(localStorage.getItem('rk.banners.queue') || '[]'); } catch {}
  const batch = bannerQueue.splice(0, 20);
  for (const e of batch) { try { net.sendBanner(e.action, e.id); } catch {} }
  try { localStorage.setItem('rk.banners.queue', JSON.stringify(bannerQueue)); } catch {}
}
try { bannerQueue = JSON.parse(localStorage.getItem('rk.banners.queue') || '[]'); } catch { bannerQueue = []; }
setInterval(flushBannerQueue, 10000);
function tickBanners(dt) {
  likeTarget = null;
  let bestD = 12;
  for (const b of brandBoards) {
    const dx = player.pos.x - b.x, dz = player.pos.z - b.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 30 * 30 && !bannerViewed.has(b.id)) { bannerViewed.add(b.id); sendBannerEvent('view', b.id); }
    // solid: cannot be bumped — shove the car out, small slow, no damage
    const rr = b.r + 2;
    if (d2 < rr * rr && d2 > 0.01 && !player.out) {
      const d = Math.sqrt(d2);
      player.pos.x = b.x + dx / d * rr; player.pos.z = b.z + dz / d * rr;
      player.vel.multiplyScalar(0.85);
    }
  }
  for (const p of peopleBoards) {
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 30 && !bannerViewed.has(p.id)) { bannerViewed.add(p.id); sendBannerEvent('view', p.id); }
    if (p.bumpCd > 0) p.bumpCd -= dt;
    if (p.likeCd > 0) p.likeCd -= dt;
    if (p.wobble > 0) {
      p.wobble = Math.max(0, p.wobble - dt * 2.2);
      p.board.rotation.z = Math.sin(p.wobble * 14) * p.wobble * 0.5;
      if (p.wobble === 0) p.board.rotation.z = 0;
    }
    // bumpable: drive in → wobble + counted
    if (d < 3.4 && p.bumpCd <= 0 && !player.out && !player.cstate.wrecked) {
      p.wobble = 1; p.bumpCd = 3;
      sendBannerEvent('bump', p.id);
      spawnHitSpark(player.pos);
      player.vel.multiplyScalar(0.9);
      if (player.isPlayer) popCoins(`BUMP! ${p.name}`, 'xp');
    }
    if (d < bestD && p.likeCd <= 0 && !player.out) { bestD = d; likeTarget = p; }
  }
  updateLikeBtn();
}

// ---------- PROJECTILES ----------
// (projectileMeshes moved to top of file)
function makeCoinTokenMesh(amount){
  const g=new THREE.Group();
  const coin=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.16,14), new THREE.MeshLambertMaterial({color:0xffd700}));
  coin.rotation.x=Math.PI/2; g.add(coin);
  const inner=new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.18,12), new THREE.MeshBasicMaterial({color:0xfff6a0})); inner.rotation.x=Math.PI/2; g.add(inner);
  const glow=new THREE.Mesh(new THREE.CircleGeometry(0.85,12), new THREE.MeshBasicMaterial({color:0xffd700, transparent:true, opacity:0.18})); glow.rotation.x=-Math.PI/2; glow.position.y=0.02; g.add(glow);
  const label=document.createElement('canvas'); // not used, keep simple
  g.userData.amount=amount;
  return g;
}
function spawnCoinsTokens(pos){
  for(let i=0;i<TOKENS_PER_KILL;i++){
    const ang=(i/TOKENS_PER_KILL)*Math.PI*2 + Math.random()*0.4;
    const rad=1.1 + Math.random()*2.2;
    const p={x: pos.x + Math.cos(ang)*rad, y:0.18, z: pos.z + Math.sin(ang)*rad};
    const tok=createCoinToken('mt'+(coinsTokenId++), p, COINS_PER_KILL_TOKEN);
    // scatter a bit on ground
    coinsTokens.push(tok);
    const mesh=makeCoinTokenMesh(tok.amount); mesh.position.set(p.x, 0.35, p.z); scene.add(mesh); coinsTokenMeshes.push(mesh);
  }
}
function tickCoinsTokens(dt){
  for(let i=coinsTokens.length-1;i>=0;i--){
    const t=coinsTokens[i], m=coinsTokenMeshes[i];
    if(!t.alive){ scene.remove(m); coinsTokens.splice(i,1); coinsTokenMeshes.splice(i,1); continue; }
    t.life-=dt; t.bob+=dt*2.2;
    if(t.life<=0){
      // blink then remove
      if(t.life > -0.9) m.visible = Math.floor(gameTime*10)%2===0;
      else { scene.remove(m); coinsTokens.splice(i,1); coinsTokenMeshes.splice(i,1); continue; }
    } else {
      m.position.y = 0.35 + Math.sin(t.bob)*0.18;
      m.rotation.y += dt*1.8;
      if(t.life<3) m.visible = Math.floor(gameTime*8)%2===0; else m.visible=true;
    }
    // collect check (player + bots drive over = whoever collects gets it? bots steal)
    for(const c of cars){
      if(c.cstate.wrecked) continue;
      const d=Math.hypot(c.pos.x - t.pos.x, c.pos.z - t.pos.z);
      if(d < TOKEN_COLLECT_RADIUS){
        t.alive=false;
        if(c.isPlayer){
          // Phase 13: no local wallet — server mints token cash (AWARD reply).
          if(isOnline() && net) { try{ net.sendToken(t.amount); }catch{} popCoins(`+$${t.amount} (server)`); }
          // small xp? token not but we keep 0
        } else {
          // bot just removes token (steals) — no economy
        }
        // pop effect
        const ring=new THREE.Mesh(new THREE.RingGeometry(0.2,0.45,12), new THREE.MeshBasicMaterial({color:0xffd700, transparent:true, opacity:0.9, side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; ring.position.set(t.pos.x,0.12,t.pos.z); scene.add(ring); effects.push({mesh:ring, vel:new THREE.Vector3(), life:0.35, maxLife:0.35, kind:'ring', scale:0.8});
        break;
      }
    }
  }
}
function makeProjectileMesh(type){
  const col=WEAPON_DEFS[type]?.color || 0xffffff;
  let m;
  if(type==='mine'){
    m=new THREE.Mesh(new THREE.SphereGeometry(0.48,10,8), new THREE.MeshLambertMaterial({color:col}));
    m.scale.y=0.7;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.42,0.05,6,10), new THREE.MeshBasicMaterial({color:0xff2222, transparent:true, opacity:0.0})); ring.rotation.x=Math.PI/2; ring.name='ring'; m.add(ring);
  } else if(type==='mg'){
    m=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6), new THREE.MeshBasicMaterial({color:col}));
  } else if(type==='plasma'){
    // superheated bolt + halo
    m=new THREE.Mesh(new THREE.SphereGeometry(0.34,10,8), new THREE.MeshBasicMaterial({color:col}));
    const halo=new THREE.Mesh(new THREE.SphereGeometry(0.55,10,8), new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:0.35})); m.add(halo);
    const trail=new THREE.Mesh(new THREE.ConeGeometry(0.22,0.9,6), new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:0.6})); trail.rotation.x=Math.PI; trail.position.z=-0.6; m.add(trail);
  } else if(type==='railgun'){
    // hypersonic slug: long glowing needle
    m=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,2.4), new THREE.MeshBasicMaterial({color:col}));
    const glow=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,1.2), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.8})); m.add(glow);
  } else if(type==='emp'){
    // crackling coil ball + ring
    m=new THREE.Mesh(new THREE.SphereGeometry(0.4,10,8), new THREE.MeshBasicMaterial({color:col}));
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.62,0.07,6,12), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.8})); ring.name='ring'; m.add(ring);
  } else if(type==='swarm'){
    // micro-missile: small cone + flare
    m=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.8,6), new THREE.MeshLambertMaterial({color:col})); m.rotation.x=Math.PI/2;
    const flare=new THREE.Mesh(new THREE.SphereGeometry(0.12,6,6), new THREE.MeshBasicMaterial({color:0xffffaa})); flare.position.z=-0.45; m.add(flare);
  } else {
    m=new THREE.Mesh(new THREE.CapsuleGeometry(0.22,0.9,4,8), new THREE.MeshLambertMaterial({color:col})); m.rotation.x=Math.PI/2;
    const trail=new THREE.Mesh(new THREE.ConeGeometry(0.18,0.7,6), new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:0.7})); trail.rotation.x=Math.PI; trail.position.z=-0.55; m.add(trail);
  }
  return m;
}

// ---------- EFFECTS ----------
let lastBoomSfx=0;
function boomSfx(pos){
  try{
    const d=Math.hypot(player.pos.x-pos.x, player.pos.z-pos.z);
    const now=performance.now();
    if(d<75 && now-lastBoomSfx>140){ lastBoomSfx=now; sfx('explosion'); }
  }catch{}
}
function spawnExplosion(pos, color=0xff4422, scale=1, count=14){
  shake=Math.min(1.6, shake+0.55*scale);
  boomSfx(pos);
  // flash
  const flash=new THREE.Mesh(new THREE.SphereGeometry(1.2*scale,12,10), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.92})); flash.position.set(pos.x,0.5,pos.z); scene.add(flash); effects.push({mesh:flash, vel:new THREE.Vector3(), life:0.18, maxLife:0.18, kind:'flash', scale});
  // core
  const core=new THREE.Mesh(new THREE.SphereGeometry(0.9*scale,12,10), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.88})); core.position.set(pos.x,0.45,pos.z); scene.add(core); effects.push({mesh:core, vel:new THREE.Vector3(0,2.5,0), life:0.42, maxLife:0.42, kind:'core', scale});
  for(let i=0;i<count;i++){ const ang=Math.random()*Math.PI*2, sp=6+Math.random()*10; const p=new THREE.Mesh(new THREE.SphereGeometry(0.18+Math.random()*0.18,6,6), new THREE.MeshBasicMaterial({color: i%2?0xffcc00:color})); p.position.set(pos.x,0.5,pos.z); scene.add(p); effects.push({mesh:p, vel:new THREE.Vector3(Math.cos(ang)*sp, 2+Math.random()*4, Math.sin(ang)*sp), life:0.45+Math.random()*0.35, maxLife:0.8, kind:'debris'}); }
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.3,0.6,16), new THREE.MeshBasicMaterial({color:0xffcc00, transparent:true, opacity:0.85, side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; ring.position.set(pos.x,0.08,pos.z); scene.add(ring); effects.push({mesh:ring, vel:new THREE.Vector3(), life:0.38, maxLife:0.38, kind:'ring', scale});
}
function spawnHitSpark(pos){
  for(let i=0;i<5;i++){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.09,6,6), new THREE.MeshBasicMaterial({color:0xffffff})); m.position.set(pos.x,0.6,pos.z); scene.add(m); effects.push({mesh:m, vel:new THREE.Vector3((Math.random()-0.5)*10, 2+Math.random()*3, (Math.random()-0.5)*10), life:0.22, maxLife:0.22, kind:'spark'}); }
}

// ---------- KILL FEED / FEEDBACK ----------
function pushKillFeed(killerIdx, victimIdx, weapon){
  const killer=cars[killerIdx], victim=cars[victimIdx];
  const div=document.createElement('div'); div.className='kill';
  const wIcon= WEAPON_DEFS[weapon]?.icon || '💥';
  // Phase 13: your tag, or 🤖 BOT-n for bots.
  const killerName = killer.isPlayer?('YOU ' + (profile.tag || '')):`🤖 BOT-${killerIdx}`;
  const victimName = victim.isPlayer?('YOU ' + (profile.tag || '')):`🤖 BOT-${victimIdx}`;
  div.textContent=`${wIcon} ${killerName} → ${victimName} ${victim.health?`(${weapon})`:''}`;
  div.style.borderLeftColor = killer.isPlayer?'#2ecc71':'#ff3344';
  killFeedEl.appendChild(div);
  setTimeout(()=>{ div.style.opacity='0'; div.style.transform='translateX(20px)'; div.style.transition='all .4s'; setTimeout(()=>div.remove(),400); }, 2200);
}
let hitFlashTimer=0;
function triggerHitFlash(intense=false){
  hitFlash.classList.add('show'); hitFlashTimer=intense?0.2:0.12;
  if(intense) shake=Math.min(1.4, shake+0.6);
}
function updateEffects(dt){
  for(let i=effects.length-1;i>=0;i--){ const e=effects[i]; e.life-=dt; if(e.life<=0){ scene.remove(e.mesh); effects.splice(i,1); continue; } const t=1 - e.life/e.maxLife; e.mesh.position.addScaledVector(e.vel, dt); e.vel.y -= 9.8*dt*0.9; if(e.kind==='flash'){ e.mesh.material.opacity=1-t*1.0; e.mesh.scale.setScalar(1+t*2.2); } else if(e.kind==='core'){ e.mesh.material.opacity=0.88*(1-t); e.mesh.scale.setScalar(1+t*0.9); } else if(e.kind==='ring'){ e.mesh.scale.setScalar(1+t*5* (e.scale||1)); e.mesh.material.opacity=0.85*(1-t); } else if(e.kind==='debris'){ e.mesh.material.opacity=1-t; e.mesh.scale.setScalar(1 - t*0.5); } else if(e.kind==='spark'){ e.mesh.material.opacity=1-t; }
  }
  // smoke for low HP / wrecked
  cars.forEach(c=>{
    if(c.cstate.wrecked){ c.smoke.material.opacity=0.55; c.smoke.scale.setScalar(1+Math.sin(performance.now()*0.008 + c.idx)*0.2); c.smoke.position.y=1.4+Math.sin(performance.now()*0.005)*0.2; }
    else if(c.cstate.health<35){ c.smoke.material.opacity=0.32; c.smoke.scale.setScalar(0.9); }
    else if(c.cstate.health<62){ c.smoke.material.opacity=0.14; }
    else c.smoke.material.opacity=0;
    // shield
    if(c.cstate.shield>0 || c.cstate.invuln>0){ c.shieldMesh.visible=true; c.shieldMesh.material.opacity=0.22+Math.sin(performance.now()*0.012)*0.08; c.shieldMesh.scale.setScalar(1+Math.sin(performance.now()*0.01)*0.06); }
    else { c.shieldMesh.visible=false; }
    // wrecked visual: dark + tilt
    if(c.cstate.wrecked){ c.body.material.color.setHex(0x2a2a2a); c.mesh.rotation.z=Math.PI*0.18; c.mesh.rotation.x=0.25; }
    else { c.body.material.color.setHex(c.color); if(Math.abs(c.mesh.rotation.z)>0.4) c.mesh.rotation.z*=0.92; }
  });
}

// ---------- INPUT ----------
const keys={};
addEventListener('keydown',e=>{
  keys[e.key.toLowerCase()]=true;
  if(e.code==='Space') keys[' ']=true;
  if(e.key==='p'||e.key==='P') togglePause();
  if(e.key==='Escape') togglePause();
  if(e.key.toLowerCase()==='j' || e.key.toLowerCase()==='x' || e.key==='Enter'){ tryPlayerFire(); }
});
addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; if(e.code==='Space') keys[' ']=false; });
let touchSteer=0, touchAccel=0;
function bindHold(el,onStart,onEnd){ const s=e=>{e.preventDefault(); onStart(e);}, en=e=>{e.preventDefault(); onEnd(e);}; el.addEventListener('touchstart',s,{passive:false}); el.addEventListener('touchend',en,{passive:false}); el.addEventListener('mousedown',s); el.addEventListener('mouseup',en); el.addEventListener('mouseleave',en); }
bindHold(document.getElementById('left'), ()=>touchSteer=-1, ()=>{if(touchSteer===-1) touchSteer=0});
bindHold(document.getElementById('right'),()=>touchSteer=1, ()=>{if(touchSteer===1) touchSteer=0});
bindHold(document.getElementById('gas'), ()=>touchAccel=1, ()=>{if(touchAccel===1) touchAccel=0});
bindHold(document.getElementById('brake'),()=>touchAccel=-1, ()=>{if(touchAccel===-1) touchAccel=0});
let boostHeld=false;
['touchstart','mousedown'].forEach(ev=> boostBtn.addEventListener(ev,e=>{e.preventDefault(); boostHeld=true;}));
['touchend','mouseup','mouseleave'].forEach(ev=> boostBtn.addEventListener(ev,()=> boostHeld=false));
addEventListener('keydown',e=>{ if(e.code==='Space'||e.key==='Shift') boostHeld=true; });
addEventListener('keyup',e=>{ if(e.code==='Space'||e.key==='Shift') boostHeld=false; });
fireBtn.addEventListener('click',e=>{ e.preventDefault(); tryPlayerFire(); });
fireBtn.addEventListener('touchstart',e=>{ e.preventDefault(); tryPlayerFire(); },{passive:false});
let fireHeld=false;
['mousedown','touchstart'].forEach(ev=> fireBtn.addEventListener(ev,()=> fireHeld=true));
['mouseup','mouseleave','touchend'].forEach(ev=> fireBtn.addEventListener(ev,()=> fireHeld=false));
addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='j'||e.key==='x'||e.key==='X') fireHeld=true; });
addEventListener('keyup',e=>{ if(e.key.toLowerCase()==='j'||e.key==='x'||e.key==='X') fireHeld=false; });
// Phase 7: jump (C), camera (V), time-of-day (T)
function tryPlayerJump(){
  if (!started || paused || finished) return;
  if (player.cstate.wrecked || player.airborne) return;
  player.vy = 9.5; player.airborne = true;
  sfx('jump');
}
function cycleCamera(){ camMode = (camMode + 1) % CAM_NAMES.length; if (camBtn) camBtn.textContent = 'CAM:' + CAM_NAMES[camMode]; }
function cycleTOD(){
  const order = ['night', 'dusk', 'day', 'auto'];
  const cur = order.indexOf(skyTime) >= 0 ? skyTime : 'night';
  setTODMode(order[(order.indexOf(cur) + 1) % order.length]);
}
function setTODMode(mode){
  skyTime = mode;
  try { settings = saveSettings({ tod: mode }); } catch {}
  if (setTOD) setTOD.value = mode;
  if (mode !== 'auto') applyTimeOfDay(mode === 'day' ? 0.15 : mode === 'dusk' ? 0.62 : 0.85);
  if (todBtn) todBtn.textContent = mode === 'day' ? '☀️' : mode === 'dusk' ? '🌇' : mode === 'auto' ? '🔁' : '🌙';
}
addEventListener('keydown',e=>{
  if (e.key.toLowerCase()==='c' || e.key.toLowerCase()==='k') tryPlayerJump();
  if (e.key.toLowerCase()==='v') cycleCamera();
  if (e.key.toLowerCase()==='t') cycleTOD();
  if (e.key.toLowerCase()==='q') cyclePlayerMount(); // Phase 9 mount slot switch
});
// Phase 9: tap weapon card to switch mount slot (touch-friendly)
function cyclePlayerMount(){
  if(!started || paused || finished || player.out || spectating) return;
  if(!player.cstate.mounts || player.cstate.mounts.length<2){ popCoins('ONE SLOT — 2-slot rides hold more',''); return; }
  const m = cycleMount(player.cstate);
  if(m){ const def = WEAPON_DEFS[m.type]; popCoins(`${def.icon} ${def.label} [${player.cstate.mountIdx+1}/${player.cstate.mounts.length}]`,'xp'); sfx('ui'); }
}
if(weaponHUD){ weaponHUD.style.pointerEvents='auto'; weaponHUD.style.cursor='pointer'; weaponHUD.title='Tap to switch weapon mount'; weaponHUD.addEventListener('click', cyclePlayerMount); }
if (jumpBtn) { ['touchstart','mousedown'].forEach(ev=> jumpBtn.addEventListener(ev,e=>{ e.preventDefault(); tryPlayerJump(); })); }
if (camBtn) { camBtn.textContent = 'CAM:' + CAM_NAMES[camMode]; ['click','touchstart'].forEach(ev=> camBtn.addEventListener(ev,e=>{ e.preventDefault(); cycleCamera(); })); }
if (todBtn) { ['click','touchstart'].forEach(ev=> todBtn.addEventListener(ev,e=>{ e.preventDefault(); cycleTOD(); })); }
// Phase 7 gamepad: left stick steer, RT/LT accel/brake, A jump, RB fire, LB boost, Y camera.
const padState = { jump: false, cam: false, fire: false };
function pollGamepad(){
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (!gp) { padState.steer = 0; padState.accel = 0; return; }
    const dz = (v) => Math.abs(v) < 0.15 ? 0 : v;
    padState.steer = dz(gp.axes[0] || 0);
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    padState.accel = (rt > 0.15 ? 1 : 0) + (lt > 0.15 ? -0.6 : 0);
    padState.boost = !!(gp.buttons[4] && gp.buttons[4].pressed);
    const j = !!(gp.buttons[0] && gp.buttons[0].pressed);
    if (j && !padState.jump) tryPlayerJump();
    padState.jump = j;
    const cb = !!(gp.buttons[3] && gp.buttons[3].pressed);
    if (cb && !padState.cam) cycleCamera();
    padState.cam = cb;
    const sb = !!(gp.buttons[2] && gp.buttons[2].pressed); // Phase 9: X switches mount
    if (sb && !padState.slot) cyclePlayerMount();
    padState.slot = sb;
    const fb = !!(gp.buttons[5] && gp.buttons[5].pressed);
    if (fb && !padState.fire) tryPlayerFire();
    padState.fire = fb;
    if (padState.fire && player.cstate.weapon && player.cstate.weapon.type === 'mg') fireHeld = true;
    else if (!padState.fire) { /* keyboard may still hold */ }
  } catch { /* no gamepad API */ }
}

function tryPlayerFire(){
  if(!started || paused || finished) return;
  if(player.out || spectating) return;
  const cs=player.cstate; if(cs.wrecked) return;
  if(!canFire(cs)){ sfx('empty'); return; }
  const shots=fireWeapon(cs, player.pos, player.yaw, player.speed);
  const list=spawnShots(player, shots);
  if(list.length && list[0].type==='mine'){ spawnHitSpark(player.pos); }
}
// Phase 9: normalize single/volley returns, build meshes, play sound hook.
function spawnShots(owner, shots){
  const list = Array.isArray(shots) ? shots : (shots ? [shots] : []);
  for(const proj of list){
    if(!proj) continue;
    projectiles.push(proj);
    const m=makeProjectileMesh(proj.type); m.position.set(proj.pos.x, proj.pos.y, proj.pos.z); m.rotation.y=proj.yaw; scene.add(m); projectileMeshes.push(m);
  }
  if(owner && owner.isPlayer && list.length){
    sfx(SOUND_HOOKS[list[0].type] || list[0].type);
    if(typeof netMode!=='undefined' && netMode==='online' && typeof net!=='undefined' && net){
      try{ net.sendFire(list[0].type, owner.yaw); }catch{}
    }
  }
  return list;
}

let paused=false, started=false, finished=false, gameTime=0;
function togglePause(){ if(finished) return; paused=!paused; pauseOverlay.classList.toggle('show',paused); pauseTitle.textContent=paused?'PAUSED':''; }
document.getElementById('resumeBtn').addEventListener('click',()=>{ paused=false; pauseOverlay.classList.remove('show'); if(!started) startGame(); });
document.getElementById('restartBtn').addEventListener('click',()=>{
  if (window.__dropLobby) { // Phase 13: disconnect return path (see onDisconnect)
    window.__dropLobby = false;
    document.getElementById('restartBtn').textContent = 'RESTART RACE';
    paused = false; pauseOverlay.classList.remove('show');
    setOnlineMode(false);
    openOnline();
    return;
  }
  restart(); paused=false; pauseOverlay.classList.remove('show');
});
let firstTapDone = false;
// PHASE 16 fix: the 'TAP TO CONNECT' title sits ON TOP of the canvas (pointer-events:auto),
// so a canvas-only click handler never fired on phone = dead screen. One document-level
// handler now: first tap = fullscreen+landscape; tap outside any panel = connect & quick match.
document.addEventListener('click', (e) => {
  if (!firstTapDone) { firstTapDone = true; tryFullscreenLandscape(); }
  if (started || isOnline()) return;
  if (e.target.closest && e.target.closest('button, input, select, a, #onlineOverlay, #settingsOverlay, #garageOverlay, #pauseOverlay, #connOverlay, #rotatePrompt, #reviveOverlay, #outOverlay, .card')) return;
  openOnline();
  connectNet('quick');
});
function startGame(){ started=true; centerMsg.style.display='none'; try{ logEvent('race_start', { track: TRACKS[currentTrackIdx].id, mode: netMode }); }catch{} }
function restart(){
  placeCars(); spawnPickups(); resetRoadblocks(); for(const s of shortcutSegs) s.claimed=false; bannerViewed.clear(); if(likeBtn) likeBtn.classList.remove('show'); finished=false; started=true; gameTime=0; shake=0; hitFlashTimer=0; hideReviveOverlay(); hideOutOverlay();
  spectating=false; if(spectateBadge) spectateBadge.classList.remove('show');
  if(typeof netMode!=='undefined' && netMode==='online' && !isPractice()){
    for(const c of cars){ if(!c.isPlayer) c.mesh.visible=false; }
    if(typeof remoteGhosts!=='undefined') for(const g of remoteGhosts){ g.car.progress=0; g.car.lap=0; }
  }
  // Phase 12: declare loadout (vehicle + mounts + fuel) — server owns ammo/fuel bounds
  if(isOnline() && typeof net!=='undefined' && net){
    try{
      net.sendLoadout({
        vehicle: profile.equippedVehicle || 'falcon_s',
        mounts: (player.cstate.mounts || []).map((m)=>({ type: m.type, ammo: m.raceAmmo || m.ammo || 0 })),
        fuel: Math.round(player.fuelMax || 70),
      });
    }catch{}
  }
  centerMsg.style.display='none'; pauseTitle.textContent='PAUSED'; pauseSub.textContent='Press RESUME to continue'; document.getElementById('restartBtn').textContent='RESTART RACE';
  killFeedEl.innerHTML='';
}

function nearestTrackIdx(pos){
  let best=0, bestD=Infinity;
  for(let i=0;i<TRACK_SAMPLES;i+=4){ const d=sampled[i].distanceToSquared(pos); if(d<bestD){bestD=d; best=i;} }
  let b=best; for(let o=-6;o<=6;o++){ const idx=(best+o+TRACK_SAMPLES)%TRACK_SAMPLES; const d=sampled[idx].distanceToSquared(pos); if(d<bestD){bestD=d; b=idx;} }
  return {idx:b, dist:Math.sqrt(bestD)};
}

// ---------- PHYSICS + COMBAT INTEGRATION ----------
function updateCar(c, dt, isPlayerCar){
  const cs=c.cstate;
  if(c.out) return; // Phase 8: out of race (dry or wrecked-out) — parked
  // if wrecked, freeze physics except gravity drift and handle respawn outside
  if(cs.wrecked){
    c.vel.multiplyScalar(1 - 2.2*dt);
    c.pos.addScaledVector(c.vel, dt*0.35);
    c.mesh.position.set(c.pos.x, 0.15, c.pos.z);
    return;
  }
  let steerInput=0, accelInput=0, wantBoost=false;
  if(isPlayerCar){
    const left=keys['a']||keys['arrowleft'], right=keys['d']||keys['arrowright'], up=keys['w']||keys['arrowup'], down=keys['s']||keys['arrowdown'];
    steerInput=(right?1:0)-(left?1:0)+touchSteer+(padState.steer||0);
    accelInput=(up?1:0)-(down?0.6:0)+touchAccel+(padState.accel||0);
    if(!up && !down && touchAccel===0 && started && !paused) accelInput=0.35;
    if(touchAccel!==0) accelInput=touchAccel;
    steerInput=Math.max(-1,Math.min(1,steerInput));
    wantBoost=boostHeld||keys['shift']||padState.boost;
    accelInput=Math.max(-1,Math.min(1,accelInput));
    if(!started) accelInput=0;
    // auto fire mg-type guns (pickup or mounted) when holding
    {
      const g = activeGun(cs);
      const firingType = (g==='weapon' && cs.weapon) ? cs.weapon.type : (cs.mounted ? cs.mounted.type : null);
      if(fireHeld && firingType==='mg' && canFire(cs)){
        spawnShots(c, fireWeapon(cs, c.pos, c.yaw, c.speed));
      }
    }
    // dodge input: bots handle dodge via AI, player can manually feel but we also auto nudge if projectile incoming
    if(c.dodgeDir!==0){ steerInput+=c.dodgeDir*0.9; c.dodgeDir*= (1 - dt*3); if(Math.abs(c.dodgeDir)<0.05) c.dodgeDir=0; }
  } else {
    if(!started){ accelInput=0; steerInput=0; }
    else {
      // waypoint
      const tgt=sampled[c.targetIdx % TRACK_SAMPLES];
      const toTgt=new THREE.Vector3().subVectors(tgt, c.pos);
      const dist=Math.hypot(toTgt.x,toTgt.z);
      if(dist<12) c.targetIdx=(c.targetIdx+1)%TRACK_SAMPLES;
      const desiredYaw=Math.atan2(toTgt.x,toTgt.z);
      let yawDiff=Math.atan2(Math.sin(desiredYaw - c.yaw), Math.cos(desiredYaw - c.yaw));
      steerInput=Math.max(-1,Math.min(1,yawDiff*1.9));
      let aheadIdx=(c.trackIdx+18)%TRACK_SAMPLES;
      const curv=sampledTangents[c.trackIdx].dot(sampledTangents[aheadIdx]);
      let targetSpeed=c.maxSpeed;
      if(curv<0.92) targetSpeed*=0.68; else if(curv<0.97) targetSpeed*=0.85;
      const behind=player.progress - c.progress;
      if(behind>0.08) targetSpeed*=1.18; if(behind<-0.12) targetSpeed*=0.92;
      // weapon seek: if no weapon, bias toward nearest pickup
      if(!cs.weapon){
        let bestP=null, bestD=Infinity;
        for(const p of pickups){ if(!p.alive) continue; const d=Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z); if(d<28 && d<bestD){bestD=d; bestP=p;} }
        if(bestP){ const toP=new THREE.Vector3(bestP.pos.x - c.pos.x,0,bestP.pos.z - c.pos.z); const ayaw=Math.atan2(toP.x,toP.z); let dYaw=Math.atan2(Math.sin(ayaw - c.yaw), Math.cos(ayaw - c.yaw)); if(Math.abs(dYaw)<0.9) steerInput += dYaw*0.9; }
      }
      // dodge incoming projectiles
      let dodge=0;
      for(let i=0;i<projectiles.length;i++){ const pr=projectiles[i]; if(pr.ownerId===c.idx) continue; if(!pr.alive) continue; const dx=pr.pos.x - c.pos.x, dz=pr.pos.z - c.pos.z; const d=Math.hypot(dx,dz); if(d<18){ const velToward = pr.vel.x*dx + pr.vel.z*dz; if(velToward<0){
            // projectile heading toward us? approximate
            const toProjAng=Math.atan2(dx,dz); const projYaw=Math.atan2(pr.vel.x,pr.vel.z); let diff=Math.atan2(Math.sin(toProjAng-projYaw),Math.cos(toProjAng-projYaw)); if(Math.abs(diff)>Math.PI*0.65){ dodge = (Math.random()>0.5?1:-1)*0.85; break; }
      }}}
      if(dodge!==0){ steerInput += dodge; if(c.cstate.weapon && c.cstate.weapon.type==='mg'){ /* strafe while dodging */ targetSpeed*=0.9; } }
      // avoid other cars
      for(const other of cars){ if(other===c) continue; if(other.out) continue; if(other.cstate.wrecked) continue; const d=c.pos.distanceTo(other.pos); if(d<7 && d>0.1){ const toOther=new THREE.Vector3().subVectors(other.pos,c.pos); const ang=Math.atan2(toOther.x,toOther.z)-c.yaw; const normAng=Math.atan2(Math.sin(ang),Math.cos(ang)); if(Math.abs(normAng)<0.8) steerInput += (normAng>0?-0.7:0.7); } }
      // Phase 8: steer around roadblocks ahead (Phase 10: also hazards)
      for(let bi=0; bi<blocks.length; bi++){
        const b=blocks[bi]; if(!b.alive) continue;
        const dx=b.pos.x-c.pos.x, dz=b.pos.z-c.pos.z;
        const dist=Math.hypot(dx,dz);
        if(dist>16) continue;
        const ang=Math.atan2(dx,dz)-c.yaw;
        const na=Math.abs(Math.atan2(Math.sin(ang),Math.cos(ang)));
        if(na<0.5){ // straight ahead — veer to the freer side
          const side = (b.pos.x - c.pos.x) * Math.cos(c.yaw) - (b.pos.z - c.pos.z) * Math.sin(c.yaw) > 0 ? -0.8 : 0.8;
          steerInput += side;
          break;
        }
      }
      for(const h of hazards){
        const dx=h.x-c.pos.x, dz=h.z-c.pos.z;
        const dist=Math.hypot(dx,dz);
        if(dist>h.r+10) continue;
        const ang=Math.atan2(dx,dz)-c.yaw;
        const na=Math.abs(Math.atan2(Math.sin(ang),Math.cos(ang)));
        if(na<0.4){
          const side = (h.x - c.pos.x) * Math.cos(c.yaw) - (h.z - c.pos.z) * Math.sin(c.yaw) > 0 ? -0.4 : 0.4;
          steerInput += side;
          break;
        }
      }
      steerInput=Math.max(-1,Math.min(1,steerInput));
      if(c.speed < targetSpeed) accelInput=1; else if(c.speed>targetSpeed+4) accelInput=-0.4; else accelInput=0.3;
      if(Math.random()<0.004 && c.speed>18) c.boostTime=0.9;
      wantBoost=c.boostTime>0;
      if(c.speed<2) c.stuckTime+=dt; else c.stuckTime=0;
      if(c.stuckTime>1.2){ accelInput=-0.8; steerInput=(Math.random()>0.5?1:-1)*0.8; if(c.stuckTime>2) c.stuckTime=0; }
      steerInput+=(Math.random()-0.5)*0.08;
      // COMBAT AI: firing
      // find best target
      let bestT=null, bestDA=Infinity, bestD2=Infinity;
      for(const t of cars){ if(t===c) continue; if(t.out) continue; if(t.cstate.wrecked) continue; if(t.cstate.invuln>0) continue; const dx=t.pos.x - c.pos.x, dz=t.pos.z - c.pos.z; const d2=dx*dx+dz*dz; if(d2>58*58) continue; const ang=Math.atan2(dx,dz) - c.yaw; const na=Math.abs(Math.atan2(Math.sin(ang),Math.cos(ang))); if(na>0.62) continue; // ~35deg cone
        if(na < bestDA){ bestDA=na; bestD2=d2; bestT=t; }
      }
      if(bestT && canFire(cs) && !bestT.out){
        const dist=Math.sqrt(bestD2);
        const g = activeGun(cs);
        const wtype=(g==='weapon' && cs.weapon) ? cs.weapon.type : (cs.mounted ? cs.mounted.type : 'mg');
        if(wtype==='mine'){
          // drop mine if enemy behind close
          const toT=new THREE.Vector3().subVectors(bestT.pos, c.pos); const dotFwd = Math.sin(c.yaw)*toT.x + Math.cos(c.yaw)*toT.z;
          if(dotFwd < -2 && dist<12){
            spawnShots(c, fireWeapon(cs, c.pos, c.yaw+Math.PI, 0));
          }
        } else {
          // lead target: simple prediction
          const lead = 0.18 + dist*0.004;
          const predX = bestT.pos.x + bestT.vel.x*lead;
          const predZ = bestT.pos.z + bestT.vel.z*lead;
          const aimYaw = Math.atan2(predX - c.pos.x, predZ - c.pos.z);
          let aimDiff=Math.atan2(Math.sin(aimYaw - c.yaw), Math.cos(aimYaw - c.yaw));
          if(Math.abs(aimDiff)<0.35 || dist<14){
            spawnShots(c, fireWeapon(cs, c.pos, aimYaw, c.speed));
          } else {
            // turn toward target a bit
            steerInput = Math.max(-1,Math.min(1, steerInput + aimDiff*0.6));
          }
        }
      }
    }
  }
  // boost
  if(cs.disabled>0) wantBoost=false; // Phase 9 EMP fries boost
  if(wantBoost && c.boostTime>=0){
    if(c.boostTime<=0 && isPlayerCar){ if(boostHeld) c.boostTime=2.4; }
    if(c.boostTime>0){ c.boostTime-=dt; if(c.boostTime<0) c.boostTime=0; }
  } else if(!wantBoost && !isPlayerCar){ if(c.boostTime>0) c.boostTime-=dt; }
  const boosting=c.boostTime>0;
  // Phase 8: fuel drain + gradual degradation (never sudden; crawl floor while fuel lasts)
  if(!cs.wrecked && started && !paused){
    const throttle = Math.max(0, Math.min(1, typeof accelInput !== 'undefined' ? accelInput : 0.5));
    c.fuel = Math.max(0, c.fuel - fuelDrain(dt, { throttle, boosting }) * (c.fuelUse || 1));
    if(c.fuel<=0){ goOutOfFuel(c); return; }
  }
  const perf = perfFactor(c.fuel, cs.health);
  const curMax=(boosting? c.maxSpeed*BOOST_MULT : c.maxSpeed) * perf.speed;
  const accel=58*(c.accelMult||1)*perf.accel, brakeDecel=78, drag=0.35;
  const fwdX=Math.sin(c.yaw), fwdZ=Math.cos(c.yaw);
  const rightX=Math.sin(c.yaw+Math.PI/2), rightZ=Math.cos(c.yaw+Math.PI/2);
  if(accelInput>0){ const eff=boosting?1.45:1; c.vel.x+=fwdX*accel*eff*accelInput*dt; c.vel.z+=fwdZ*accel*eff*accelInput*dt; }
  else if(accelInput<0){ c.vel.x+=fwdX*brakeDecel*accelInput*dt; c.vel.z+=fwdZ*brakeDecel*accelInput*dt; }
  c.vel.x*=(1-drag*dt); c.vel.z*=(1-drag*dt);
  const velDotFwd=c.vel.x*fwdX + c.vel.z*fwdZ;
  const velDotRight=c.vel.x*rightX + c.vel.z*rightZ;
  const latDamp=Math.max(0,1-6.0*dt*(c.oilT>0?HAZARD_TUNING.oil.lateralGrip:0.9));
  const newRight=velDotRight*latDamp;
  c.vel.x=fwdX*velDotFwd + rightX*newRight;
  c.vel.z=fwdZ*velDotFwd + rightZ*newRight;
  const speedAbs=Math.hypot(c.vel.x,c.vel.z); c.speed=speedAbs;
  if(speedAbs>curMax){ const s=curMax/speedAbs; c.vel.x*=s; c.vel.z*=s; c.speed=curMax; }
  if(velDotFwd < -curMax*0.45){ const rs=(-curMax*0.45)/velDotFwd; c.vel.x*=rs; c.vel.z*=rs; }
  const steerEff=Math.min(1,speedAbs/8)*(1-Math.min(0.45,speedAbs/curMax*0.35))*perf.handling*(c.handlingMult||1)*(c.oilT>0?HAZARD_TUNING.oil.handlingMult:1);
  c.yaw+= steerInput*2.05*steerEff*dt*(velDotFwd<0?-1:1);
  c.pos.x+=c.vel.x*dt; c.pos.z+=c.vel.z*dt; c.pos.y=0;
  // wall collision with damage (Phase 10: secret-cut corridors are exempt)
  const near=nearestTrackIdx(c.pos); c.trackIdx=near.idx; const distFromCenter=near.dist; const half=ROAD_WIDTH/2;
  const cut=inShortcut(c.pos.x, c.pos.z, 0);
  if(cut && isPlayerCar && !cut.claimed){
    cut.claimed=true;
    if(!isOnline()){ addCoins(profile, SHORTCUT_BONUS); refreshEconHUD(); }
    popCoins(`SECRET CUT! +$${SHORTCUT_BONUS}`,'xp'); sfx('pickup');
  }
  if(distFromCenter>half-1.1 && !cut){
    const centerPt=sampled[near.idx], toCar=new THREE.Vector3().subVectors(c.pos, centerPt);
    const tg=sampledTangents[near.idx], nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
    const dot=toCar.x*nnx + toCar.z*nnz;
    const clamp=Math.sign(dot)*(half-1.2);
    c.pos.x=centerPt.x+nnx*clamp; c.pos.z=centerPt.z+nnz*clamp;
    const vDotN=c.vel.x*nnx + c.vel.z*nnz;
    c.vel.x -= vDotN*1.35*nnx; c.vel.z -= vDotN*1.35*nnz; c.vel.multiplyScalar(0.78);
    // damage from wall hit: scaled by speed
    const wallDmg=Math.min(18, Math.max(4, speedAbs*0.42));
    if(speedAbs>9){
      const res=applyDamage(cs, wallDmg, null, gameTime);
      if(res.killed) onCarWrecked(c);
      else if(!res.blocked){ spawnHitSpark(c.pos); c.cstate.damageFlash=0.18; if(isPlayerCar) triggerHitFlash(false); }
    }
    shake=Math.min(1.2, shake+0.18);
  }
  // Phase 8: roadblock collisions (jump clears low ones when airborne)
  for(let bi=0; bi<blocks.length; bi++){
    const b=blocks[bi]; if(!b.alive) continue;
    const def=BLOCK_TYPES[b.type];
    const dx=c.pos.x-b.pos.x, dz=c.pos.z-b.pos.z;
    const rr=def.r+2.0, d2=dx*dx+dz*dz;
    if(d2>rr*rr) continue;
    if(def.jumpable && (c.jumpY||0)>1.2) continue; // cleared it
    const d=Math.sqrt(d2)||0.01;
    // shove out + scrub speed
    c.pos.x=b.pos.x+dx/d*rr; c.pos.z=b.pos.z+dz/d*rr;
    c.vel.multiplyScalar(def.slow);
    const ramDmg=Math.min(def.dmg*1.4, Math.max(4, speedAbs*0.35));
    const res=applyDamage(cs, Math.max(def.dmg*0.6, ramDmg*0.5), null, gameTime);
    if(res.killed) onCarWrecked(c);
    else if(!res.blocked){ spawnHitSpark(c.pos); if(isPlayerCar) triggerHitFlash(false); }
    if(def.destructible) damageBlock(b, bi, Math.max(BLOCK_RAM_DMG*0.7, speedAbs*0.9));
    else if(isPlayerCar) popCoins('STEER AROUND!', '');
    shake=Math.min(1.2, shake+0.3);
    break; // one block per tick max
  }
  // car-car push + damage
  for(const other of cars){ if(other===c || other.out) continue; const dx=c.pos.x-other.pos.x, dz=c.pos.z-other.pos.z; const d2=dx*dx+dz*dz; const minD=4.2; if(d2<minD*minD && d2>0.01){ const d=Math.sqrt(d2); const push=(minD-d)/minD*0.7; c.pos.x+=dx/d*push*2.2; c.pos.z+=dz/d*push*2.2; c.vel.x+=(dx/d)*3*dt*60; c.vel.z+=(dz/d)*3*dt*60; c.vel.multiplyScalar(0.98);
      const relSpeed=Math.hypot(c.vel.x-other.vel.x, c.vel.z-other.vel.z);
      if(relSpeed>11){
        const dmg=Math.min(12, relSpeed*0.45);
        // only one side applies per pair to avoid double: let lower idx handle? we apply both but with cooldown
        if(c.idx < other.idx){
          const r1=applyDamage(cs, dmg*0.7, other.idx, gameTime); if(r1.killed) onCarWrecked(c); const r2=applyDamage(other.cstate, dmg*0.7, c.idx, gameTime); if(r2.killed) onCarWrecked(other);
          if(!r1.blocked || !r2.blocked) spawnHitSpark(new THREE.Vector3((c.pos.x+other.pos.x)/2,0.5,(c.pos.z+other.pos.z)/2));
        }
      }
    }
  }
  const cpIdx=Math.floor(c.trackIdx / (TRACK_SAMPLES/CHECKPOINTS));
  // Phase 10: checkpoints tolerate shortcut skips (up to 4 ahead); wrap = lap
  if(near.dist < ROAD_WIDTH*0.9 || cut){
    const adv=advanceCheckpoint(c.checkpoint, cpIdx, CHECKPOINTS, 4);
    if(adv.checkpoint!==c.checkpoint){
      if(adv.wrapped){
        c.lap++;
        c.fuel=Math.min(c.fuelMax||FUEL_MAX, c.fuel + FUEL_PER_LAP);
        if(c.isPlayer){
          popCoins(`+${FUEL_PER_LAP} FUEL — LAP ${c.lap+1}`,'xp');
          if(c.lap>=TOTAL_LAPS && !finished){ const order=rankCars(); const rank=order.indexOf(c)+1; showFinish(rank); }
        }
      }
      c.checkpoint=adv.checkpoint;
    }
  }
  c.progress=c.lap + c.trackIdx/TRACK_SAMPLES;
  // Phase 7: jump physics (vertical hop, gravity land)
  if (c.airborne) {
    c.vy -= 24 * dt; c.jumpY += c.vy * dt;
    if (c.jumpY <= 0) { c.jumpY = 0; c.vy = 0; c.airborne = false; spawnHitSpark(c.pos); }
  }
  // mesh
  const hoverBob = 0.15 + Math.sin(gameTime*8 + (c.isPlayer?0:c.trackIdx))*0.04;
  c.mesh.position.set(c.pos.x, hoverBob + (c.jumpY || 0), c.pos.z);
  c.mesh.rotation.y=c.yaw;
  c.mesh.rotation.z = -steerInput*Math.min(0.35,speedAbs/30);
  c.mesh.rotation.x = (velDotFwd>0? accelInput: -accelInput)*0.07;
  if(boosting){ c.flame.material.opacity=0.9; c.flame.scale.set(1+Math.random()*0.3,1,1); }
  else c.flame.material.opacity=THREE.MathUtils.lerp(c.flame.material.opacity,0,dt*12);
  // Phase 7: front wheels steer, brake bar glows on brake
  if (c.wheels) for (const w of c.wheels) { if (w.front) w.mesh.rotation.y = steerInput * 0.42; w.mesh.rotation.x += (c.speed * dt * 0.9) % (Math.PI * 2); }
  if (c.brakeMat) c.brakeMat.color.setHex(accelInput < -0.05 ? 0xff2222 : 0x550000);
  if(isPlayerCar){ if(boosting) boostBtn.classList.add('on'); else boostBtn.classList.remove('on'); if(cs.weapon) fireBtn.classList.add('hasWeapon'); else fireBtn.classList.remove('hasWeapon'); }
}

function onCarWrecked(car){
  spawnExplosion(car.pos, car.isPlayer?0xff2222:0xff6a00, 1.35, 18);
  triggerHitFlash(car.isPlayer);
  // drop coins tokens where wrecked
  spawnCoinsTokens(car.pos);
  // kill feed + XP
  const killerId=car.cstate.lastAttacker;
  if(killerId!=null && killerId!==car.idx){
    const killer=cars[killerId] || (typeof remoteGhosts!=='undefined' ? remoteGhosts.map((g)=>g.car).find((c)=>c.idx===killerId) : null);
    if(killer) killer.cstate.kills++;
    const wtype = (killer && killer.cstate.weapon) ? killer.cstate.weapon.type : 'crash';
    if(killer){ pushKillFeed(killerId, car.idx, wtype); }
    if(killer && killer.isPlayer){
      const online = (typeof netMode!=='undefined' && netMode==='online');
      if(!online){
        const r=grantXP(XP_REWARDS.kill); refreshEconHUD(); popCoins(`+${XP_REWARDS.kill} XP`,'xp');
        if(r.levelUp){ popCoins(`LEVEL UP ${r.after}!`,'xp'); spawnExplosion(killer.pos, 0x2de2ff, 0.8, 8); }
      }
      profile.stats.kills=(profile.stats.kills||0)+1; saveProfile(profile);
    }
  } else if(killerId==null){
    if(car.isPlayer) pushKillFeed(car.idx, car.idx, 'wreck');
  }
  if(car.isPlayer){
    damageVignette.style.boxShadow='inset 0 0 120px rgba(255,0,0,.55)';
    showReviveOverlay();
  }
  // permanent wreck hint
  if(car.cstate.revivesUsed>=3) car.cstate.permanentWreck=true;
}

// ---------- PROJECTILE SIM ----------
function tickProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i], mesh=projectileMeshes[i];
    if(!p.alive){ scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1); continue; }
    p.life-=dt;
    if(p.life<=0){
      // mine just expires without explosion
      if(p.type!=='mine'){ spawnExplosion(p.pos, WEAPON_DEFS[p.type].color, 0.7, 8); }
      scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1); continue;
    }
    if(p.type==='mine'){
      p.armed-=dt;
      if(p.armed<0) mesh.getObjectByName('ring').material.opacity=0.28+Math.sin(gameTime*8)*0.18;
      // trigger check
      if(p.armed<0){
        for(const c of cars){ if(c.cstate.wrecked) continue; if(c.idx===p.ownerId) continue; const d=Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z); if(d < (p.triggerRadius||4.2)){
          // explode mine
          spawnExplosion(p.pos, 0x8a2be2, 1.55, 20);
          // radius damage
          for(const t of cars){ if(t.cstate.wrecked) continue; const dd=Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z); if(dd < (WEAPON_DEFS.mine.explosionRadius||11)){ const falloff=1 - dd/11; const dmg=WEAPON_DEFS.mine.damage * falloff; const res=applyDamage(t.cstate, dmg, p.ownerId, gameTime); if(res.killed) onCarWrecked(t); else if(!res.blocked) spawnHitSpark(t.pos); if(t.isPlayer && !res.blocked) triggerHitFlash(dmg>20); }
          }
          scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1); break;
        }}
      }
      // mine doesn't move
      continue;
    }
    // Phase 9: homing steer (swarm) toward nearest rival
    if(p.homing && p.alive){
      let best=null, bestD=45;
      for(const c of cars){
        if(c.idx===p.ownerId || c.cstate.wrecked || c.out) continue;
        const d=Math.hypot(c.pos.x-p.pos.x, c.pos.z-p.pos.z);
        if(d<bestD){ bestD=d; best=c; }
      }
      if(best){
        const want=Math.atan2(best.pos.x-p.pos.x, best.pos.z-p.pos.z);
        const cur=Math.atan2(p.vel.x, p.vel.z);
        let diff=Math.atan2(Math.sin(want-cur), Math.cos(want-cur));
        const turn=Math.max(-p.homing, Math.min(p.homing, diff));
        const sp=Math.hypot(p.vel.x, p.vel.z);
        const ny=cur+turn;
        p.vel.x=Math.sin(ny)*sp; p.vel.z=Math.cos(ny)*sp; p.yaw=ny;
        if(mesh) mesh.rotation.y=ny;
      }
    }
    p.pos.x += p.vel.x*dt; p.pos.z += p.vel.z*dt;
    mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
    // check hit vs cars (sphere)
    let hit=false;
    for(const c of cars){
      if(c.cstate.wrecked || c.out) continue;
      if(c.idx===p.ownerId && p.life > WEAPON_DEFS[p.type].lifetime -0.18) continue; // grace for owner
      const d=Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
      if(d < 2.4 + p.radius){
        const res=applyDamage(c.cstate, p.damage, p.ownerId, gameTime);
        if(res.killed) onCarWrecked(c); else if(!res.blocked) { spawnHitSpark(new THREE.Vector3(p.pos.x,0.6,p.pos.z)); if(c.isPlayer) triggerHitFlash(p.type==='rocket'); }
        else if(res.blocked){ spawnHitSpark(new THREE.Vector3(p.pos.x,0.6,p.pos.z)); }
        // Phase 9: EMP fries boost+fire; plasma splashes
        if(p.empTime && !c.cstate.wrecked){
          c.cstate.disabled=Math.max(c.cstate.disabled, p.empTime);
          const zap=new THREE.Mesh(new THREE.RingGeometry(0.5,1.0,14), new THREE.MeshBasicMaterial({color:0xffe14d, transparent:true, opacity:0.9, side:THREE.DoubleSide})); zap.rotation.x=-Math.PI/2; zap.position.set(c.pos.x,0.1,c.pos.z); scene.add(zap); effects.push({mesh:zap, vel:new THREE.Vector3(), life:0.5, maxLife:0.5, kind:'ring', scale:1.4});
          if(c.isPlayer) popCoins('⚡ EMP ZAPPED!', '');
        }
        if(p.splash){
          for(const t of cars){
            if(t===c || t.cstate.wrecked || t.out) continue;
            const dd=Math.hypot(t.pos.x-p.pos.x, t.pos.z-p.pos.z);
            if(dd < p.splash){
              const r2=applyDamage(t.cstate, p.damage*0.5*(1-dd/p.splash), p.ownerId, gameTime);
              if(r2.killed) onCarWrecked(t); else if(!r2.blocked) spawnHitSpark(t.pos);
            }
          }
        }
        // rocket always explodes, mg spark
        if(p.type==='rocket') spawnExplosion(p.pos, WEAPON_DEFS.rocket.color, 1.0, 12);
        else spawnHitSpark(new THREE.Vector3(p.pos.x,0.5,p.pos.z));
        hit=true; break;
      }
    }
    // Phase 4: local projectiles vs online ghosts — visuals locally, damage via server relay.
    if(!hit && typeof netMode!=='undefined' && netMode==='online' && typeof remoteGhosts!=='undefined' && typeof net!=='undefined' && net){
      for(const g of remoteGhosts){
        if(!g.active) continue;
        const c=g.car;
        if(c.cstate.wrecked) continue;
        const d=Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
        if(d < 2.4 + p.radius){
          if(p.ownerId===player.idx){
            const res=applyDamage(c.cstate, p.damage, p.ownerId, gameTime);
            if(res.killed) onCarWrecked(c);
            try{ net.sendHit(g.netId, p.damage, p.type); }catch{}
          }
          spawnHitSpark(new THREE.Vector3(p.pos.x,0.5,p.pos.z));
          if(p.type==='rocket') spawnExplosion(p.pos, WEAPON_DEFS.rocket.color, 1.0, 12);
          hit=true; break;
        }
      }
    }
    if(hit){
      scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1); continue;
    }
    // Phase 8: projectiles vs roadblocks (heavy ones cost more ammo)
    if(p.type!=='mine'){
      let blockHit=false;
      for(let bi=0; bi<blocks.length; bi++){
        const b=blocks[bi]; if(!b.alive) continue;
        const def=BLOCK_TYPES[b.type];
        const d=Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
        if(d < def.r + p.radius + 0.6){
          if(def.hp<0){ spawnHitSpark(new THREE.Vector3(p.pos.x,0.6,p.pos.z)); } // tires: sparks, no damage
          else {
            const broke=damageBlock(b, bi, p.damage);
            spawnHitSpark(new THREE.Vector3(p.pos.x,0.6,p.pos.z));
            if(broke && p.ownerId===player.idx) popCoins('CLEARED!', 'xp');
          }
          if(p.type==='rocket') spawnExplosion(p.pos, WEAPON_DEFS.rocket.color, 0.8, 8);
          blockHit=true; break;
        }
      }
      if(blockHit){ scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1); continue; }
    }
    // wall hit? if projectile goes far from center, remove
    const near=nearestTrackIdx(new THREE.Vector3(p.pos.x,0,p.pos.z));
    if(near.dist > ROAD_WIDTH/2 + 6){
      if(p.type==='rocket') spawnExplosion(p.pos, 0xff4422, 0.8, 10);
      scene.remove(mesh); projectiles.splice(i,1); projectileMeshes.splice(i,1);
    }
  }
}

// ---------- PICKUP SIM ----------
function tickPickups(dt){
  pickups.forEach((p, i)=>{
    const mesh=pickupMeshes[i];
    if(!p.alive){
      p.respawnIn-=dt; mesh.visible=false;
      if(p.respawnIn<=0){
        p.type=p.cache || rollPhase8Pickup(); p.alive=true; mesh.visible=true;
        // recreate mesh color? just swap material color and keep geometry
        // simpler: remove old mesh and create new
        scene.remove(mesh);
        const nm=createPickupMesh(p.type); nm.position.set(p.pos.x,0.55,p.pos.z); scene.add(nm); pickupMeshes[i]=nm;
      }
      return;
    }
    // spin + bob
    mesh.rotation.y += dt*1.6;
    mesh.position.y = 0.55 + Math.sin(gameTime*2 + i)*0.22;
    // check pickup
    for(const c of cars){
      if(c.cstate.wrecked || c.out) continue;
      const d=Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
      if(d<3.3){
        if(p.type==='fuel'){
          c.fuel=Math.min(c.fuelMax || FUEL_MAX, c.fuel + FUEL_PICKUP);
          if(c.isPlayer){ spawnHitSpark(c.pos); popCoins(`+${FUEL_PICKUP} FUEL`); sfx('pickup'); }
        } else if(p.type==='ammo'){
          refillMountsPickup(c.cstate);
          if(c.isPlayer){ spawnHitSpark(c.pos); popCoins(`+AMMO`,'xp'); sfx('pickup'); }
        } else {
          giveWeapon(c.cstate, p.type);
          if(c.isPlayer){ spawnHitSpark(c.pos); sfx('pickup'); }
        }
        p.alive=false; p.respawnIn=8 + Math.random()*2; mesh.visible=false;
        // effect
        const pop=new THREE.Mesh(new THREE.RingGeometry(0.2,0.45,12), new THREE.MeshBasicMaterial({color:pickupColor(p.type), transparent:true, opacity:0.9, side:THREE.DoubleSide})); pop.rotation.x=-Math.PI/2; pop.position.set(p.pos.x,0.12,p.pos.z); scene.add(pop); effects.push({mesh:pop, vel:new THREE.Vector3(), life:0.4, maxLife:0.4, kind:'ring', scale:0.9});
        break;
      }
    }
  });
}

function showReviveOverlay(){
  const cs=player.cstate;
  if(!reviveOverlay) return;
  const cost=getReviveCostForState(cs);
  if(cost==null){
    // Phase 8: third wreck = out. Spectate or exit.
    player.out=true; player.outReason='wrecks';
    showOutOverlay('wrecks');
    return;
  } else {
    reviveTitleEl.textContent='WRECKED!';
    reviveCostEl.innerHTML=`💎 ${cost} <small>GEMS</small>`;
    const afford = profile.gems >= cost;
    reviveHintEl.textContent = afford ? `You have ${profile.gems} gems.` : `Need ${cost} gems — you have ${profile.gems}.`;
    reviveBtn.disabled=!afford;
    reviveBtn.textContent = afford ? `REVIVE — ${cost} GEM${cost>1?'S':''}` : `NEED ${cost} GEMS`;
  }
  reviveOverlay.classList.add('show');
}
function hideReviveOverlay(){ if(reviveOverlay) reviveOverlay.classList.remove('show'); }
// ---------- PHASE 8 — out of race: dry or wrecked-out → spectate or exit ----------
function goOutOfFuel(c){
  if(c.out) return;
  c.out=true; c.outReason='fuel'; c.vel.set(0,0,0);
  spawnExplosion(c.pos, 0x555555, 0.7, 6);
  if(c.isPlayer){ popCoins('OUT OF FUEL!', ''); showOutOverlay('fuel'); }
}
function showOutOverlay(reason){
  hideReviveOverlay();
  if(outTitle) outTitle.textContent = reason==='fuel' ? 'OUT OF FUEL ⛽' : 'WRECKED OUT 💀';
  if(outSub) outSub.textContent = reason==='fuel'
    ? 'You ran dry. Manage throttle, grab ⛽ cans, bank the +16/lap pit bonus.'
    : 'Three revives used (1 → 5 → 30 gems). The race goes on without you.';
  if(outOverlay) outOverlay.classList.add('show');
  paused=true;
  sfx('out');
}
function hideOutOverlay(){ if(outOverlay) outOverlay.classList.remove('show'); }
function startSpectate(){
  hideOutOverlay();
  spectating=true; paused=false;
  if(spectateBadge) spectateBadge.classList.add('show');
  popCoins('SPECTATING LEADER', 'xp');
}
const spectateBtnEl = document.getElementById('spectateBtn');
if(spectateBtnEl) spectateBtnEl.addEventListener('click', startSpectate);
const outRestartBtnEl = document.getElementById('outRestartBtn');
if(outRestartBtnEl) outRestartBtnEl.addEventListener('click', () => { hideOutOverlay(); restart(); });
let pendingRevive = false; // Phase 12: awaiting server REVIVE_OK
function doPlayerRevive(){
  const cs=player.cstate;
  const cost=getReviveCostForState(cs);
  if(cost==null) return;
  // Phase 12: online revives are server-owned (gems deducted server-side).
  if(isOnline()){
    if(pendingRevive) return;
    pendingRevive = true;
    reviveBtn.textContent = 'WAITING…'; reviveBtn.disabled = true;
    try{ net.sendRevive(); }catch{ pendingRevive = false; }
    setTimeout(()=>{ if(pendingRevive){ pendingRevive=false; showReviveOverlay(); } }, 4000);
    return;
  }
  const res=payRevive(profile, cs.revivesUsed);
  if(!res.ok) return;
  refreshEconHUD(); popCoins(`-${res.cost} 💎`,'gem');
  applyPlayerRevive();
}
function applyPlayerRevive(){
  const cs=player.cstate;
  const ok=doRevive(cs, gameTime);
  if(ok){
    hideReviveOverlay();
    sfx('revive');
    // Phase 8: revive refuels partway (mounted reserve reset in combat doRevive)
    player.fuel=Math.max(player.fuel, FUEL_REVIVE);
    // move to checkpoint
    const cpIdx=(cs.wrecked?0:player.checkpoint+1)%CHECKPOINTS; // just near current
    const base=checkpointPos[(player.checkpoint+1)%CHECKPOINTS];
    const tg=sampledTangents[Math.floor(((player.checkpoint+1)%CHECKPOINTS)/CHECKPOINTS*TRACK_SAMPLES)];
    const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
    const jitter=(Math.random()-0.5)*4;
    player.pos.set(base.x+nnx*jitter,0,base.z+nnz*jitter);
    player.yaw=Math.atan2(tg.x,tg.z);
    player.vel.set(Math.sin(player.yaw)*8,0,Math.cos(player.yaw)*8);
    player.vy=0; player.jumpY=0; player.airborne=false;
    damageVignette.style.boxShadow='inset 0 0 120px rgba(255,0,0,0)';
    spawnExplosion(player.pos, 0x2de2ff, 0.9, 10);
  }
}
if(reviveBtn) reviveBtn.addEventListener('click', doPlayerRevive);
if(stayWreckedBtn) stayWreckedBtn.addEventListener('click', hideReviveOverlay);
// garage
let garageTab = 'rides'; // Phase 9: paint | rides | upgrades | weapons
function setPlayerVehicle(vid){
  const spec = vehicleSpec(vid);
  if(!spec) return false;
  const r = equipVehicle(profile, vid);
  if(!r.ok) return false;
  refreshEconHUD(); persistProfile(true);
  // rebuild chassis in place (rig refs stay valid)
  while(player.chassis.children.length){
    const m = player.chassis.children.pop();
    player.chassis.remove(m);
  }
  const paint = GARAGE_SKINS.find(k=>k.id===profile.equippedSkin);
  const hex = paint ? paint.color : player.color;
  const ch = buildChassis(player.mesh, spec, hex);
  // buildChassis appends a NEW subgroup; drop the emptied old one
  if(player.chassis !== ch.chassis && player.mesh.children.includes(player.chassis)) player.mesh.remove(player.chassis);
  player.chassis = ch.chassis; player.body = ch.body; player.wheels = ch.wheels; player.brakeMat = ch.brakeMat;
  player.vehicleId = spec.id;
  applyVehicleStats(player, true);
  resetMounts(player.cstate, mountsFor(player));
  tryFitModel(player, spec);
  return true;
}
// Unified shop purchase: solo = local check+charge; online = server decides (BUY_OK).
function shopBuy(kind, item, level, vehicle, applyLocal){
  if(pendingBuy){ popCoins('WAIT FOR SHOP…',''); return; }
  if(isOnline()){
    pendingBuy = { kind, item };
    try{ net.sendBuy(kind, item, level | 0, vehicle); popCoins('SHOP: CHECKING…','xp'); }catch{ pendingBuy=null; }
    renderGarage();
    return;
  }
  const r = applyLocal();
  if(r.ok){ refreshEconHUD(); persistProfile(true); sfx('pickup'); popCoins('PURCHASED ✓','xp'); }
  else popCoins(`SHOP: ${r.reason==='funds'?'NEED FUNDS':'UNAVAILABLE'}`,'');
  renderGarage();
}
function statBar(label, val, max){
  const pct=Math.max(4, Math.min(100, val/max*100));
  return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-top:3px"><span style="width:52px;opacity:.7">${label}</span><div style="flex:1;height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#2de2ff,#ffcc00)"></div></div></div>`;
}
function renderGarage(){
  if(!garageGrid) return;
  migrateShop(profile);
  garageGrid.innerHTML='';
  // tab bar
  const tabs=document.createElement('div');
  tabs.style.cssText='display:flex;gap:6px;margin-top:10px';
  for(const t of [['rides','RIDES'],['upgrades','UPGRADES'],['weapons','WEAPONS'],['paint','PAINT']]){
    const b=document.createElement('button');
    b.textContent=t[1];
    b.style.cssText=`flex:1;padding:8px 4px;border-radius:8px;border:1px solid rgba(255,255,255,.2);font-weight:900;font-size:11px;pointer-events:auto;${garageTab===t[0]?'background:#ffcc00;color:#111':'background:rgba(255,255,255,.07);color:#fff'}`;
    b.addEventListener('click',()=>{ garageTab=t[0]; sfx('ui'); renderGarage(); });
    tabs.appendChild(b);
  }
  garageGrid.appendChild(tabs);
  const body=document.createElement('div');
  body.style.marginTop='10px';
  garageGrid.appendChild(body);
  const mk=(html)=>{ const d=document.createElement('div'); d.innerHTML=html; return d; };
  const btn=(parent,label,cls,disabled,fn)=>{
    const b=document.createElement('button'); b.textContent=label; b.className=cls; b.disabled=!!disabled;
    if(fn) b.addEventListener('click',(e)=>{ e.stopPropagation(); sfx('ui'); fn(); });
    parent.appendChild(b); return b;
  };
  if(garageTab==='paint'){
    const lvl=getLevelFromXP(profile.xp);
    void lvl;
    GARAGE_SKINS.forEach(skin=>{
      const owned=profile.unlockedSkins.includes(skin.id);
      const equipped=profile.equippedSkin===skin.id;
      const div=document.createElement('div'); div.className='skin'+(owned?' owned':'')+(equipped?' equipped':'');
      const hex='#'+skin.color.toString(16).padStart(6,'0');
      div.innerHTML=`<div class="sw" style="background:${hex}"></div><b>${skin.name}</b><div style="font-size:10px;opacity:.6">${skin.price===0?'FREE':skin.price+' 💰'}</div>`;
      if(equipped){ btn(div,'EQUIPPED','equip',true); }
      else if(owned){ btn(div,'EQUIP','equip',false,()=>{ const r=equipSkin(profile, skin.id); if(r.ok){ refreshEconHUD(); persistProfile(true); renderGarage(); player.body.material.color.setHex(skin.color); if(player.underglow) player.underglow.material.color.setHex(skin.color); player.color=skin.color; } }); }
      else { btn(div, skin.price>profile.coins? `NEED $${skin.price}` : `BUY $${skin.price}`,'buy',profile.coins<skin.price,()=>{ const r=buySkin(profile, skin.id); if(r.ok){ equipSkin(profile, skin.id); refreshEconHUD(); persistProfile(true); popCoins(`BOUGHT ${skin.name}`); renderGarage(); player.body.material.color.setHex(skin.color); if(player.underglow) player.underglow.material.color.setHex(skin.color); } else { popCoins('NOT ENOUGH CASH'); } }); }
      body.appendChild(div);
    });
    body.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px';
  } else if(garageTab==='rides'){
    for(const cls of CLASSES){
      body.appendChild(mk(`<div style="font-size:11px;font-weight:900;letter-spacing:.08em;opacity:.75;margin:8px 0 2px">${CLASS_NAMES[cls]}</div>`));
      for(const v of SHOP_CONFIG.vehicles.filter((x)=>x.class===cls)){
        const owned=profile.vehicles.includes(v.id);
        const equipped=profile.equippedVehicle===v.id;
        const st=vehicleStats(v.id, upgLevels(profile, v.id));
        const div=document.createElement('div'); div.className='skin'+(owned?' owned':'')+(equipped?' equipped':'');
        div.innerHTML=`<b>${v.name}</b> <span style="font-size:9px;opacity:.6">${v.free?'FREE ITEM':(v.currency==='gems'?'💎 PAID':'💰 PAID')}</span><div style="font-size:10px;opacity:.65">${v.desc||''}</div>`
          + statBar('TOP', st.top, 50) + statBar('ACC', st.accel, 1.4) + statBar('HND', st.handling, 1.5) + statBar('HP', st.hp, 260) + statBar('FUEL', st.fuel, 120)
          + `<div style="font-size:10px;opacity:.7;margin-top:4px">SLOTS ${st.slots} • ${priceText(v)}</div>`;
        if(equipped) btn(div,'EQUIPPED','equip',true);
        else if(owned) btn(div,'SELECT','equip',false,()=>{ if(setPlayerVehicle(v.id)){ popCoins(v.name+' READY','xp'); renderGarage(); } });
        else btn(div, isOnline()&&pendingBuy?'…':priceText(v),'buy',!!pendingBuy,()=>shopBuy('vehicle', v.id, 0, undefined, ()=>{ const r=buyVehicle(profile, v.id); if(r.ok){ equipVehicle(profile, v.id); setPlayerVehicle(v.id);} return r; }));
        body.appendChild(div);
      }
    }
  } else if(garageTab==='upgrades'){
    const vid=profile.equippedVehicle;
    const v=vehicleSpec(vid);
    body.appendChild(mk(`<div style="font-size:12px;font-weight:900">${v?v.name:vid}</div><div style="font-size:10px;opacity:.6">Upgrades stick to this ride.</div>`));
    for(const line of ['engine','armor','tank','suspension']){
      const cur=upgLevels(profile, vid)[line]|0;
      const max=maxUpgradeLevel(line);
      const cost=upgradeCost(line, cur);
      const div=document.createElement('div'); div.className='skin';
      const U=SHOP_CONFIG.upgrades[line];
      div.innerHTML=`<b>${U.name} ${'●'.repeat(cur)}${'○'.repeat(max-cur)}</b><div style="font-size:10px;opacity:.65">${cost?('NEXT: '+priceText(cost)+(cost.free?' (FREE)':'')):'MAXED'}</div>`;
      if(cost) btn(div, isOnline()&&pendingBuy?'…':priceText(cost),'buy',!!pendingBuy,()=>shopBuy('upgrade', line, cost.level, vid, ()=>buyUpgrade(profile, vid, line)));
      else btn(div,'MAX','equip',true);
      body.appendChild(div);
    }
  } else { // weapons
    body.appendChild(mk(`<div style="font-size:10px;opacity:.65">Mounts on ${profile.equippedVehicle}: S1=${profile.mounts.slot1||'—'} S2=${profile.mounts.slot2||'—'} (2-slot rides only). Tap card in race (Q) to switch.</div>`));
    for(const w of mountableWeapons()){
      const owned=profile.weapons.includes(w.id);
      const def=WEAPON_DEFS[w.id];
      const div=document.createElement('div'); div.className='skin'+(owned?' owned':'');
      div.innerHTML=`<b>${def?def.icon+' ':''}${w.name}</b> <span style="font-size:9px;opacity:.6">${w.free?'FREE ITEM':(w.currency==='gems'?'💎 PAID':'💰 PAID')}</span><div style="font-size:10px;opacity:.65">${w.desc||''} • ${w.raceAmmo}/race</div>`;
      if(owned){
        const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;margin-top:8px';
        btn(row,'SLOT 1','equip',profile.mounts.slot1===w.id,()=>{ const r=setMount(profile,1,w.id); if(r.ok){ refreshEconHUD(); persistProfile(true); resetMounts(player.cstate, mountsFor(player)); renderGarage(); } });
        const st=vehicleStats(profile.equippedVehicle, upgLevels(profile, profile.equippedVehicle));
        btn(row,'SLOT 2','equip',(st&&st.slots>1?profile.mounts.slot2===w.id:true),()=>{ const r=setMount(profile,2,w.id); if(r.ok){ refreshEconHUD(); persistProfile(true); resetMounts(player.cstate, mountsFor(player)); renderGarage(); } });
        div.appendChild(row);
      } else {
        btn(div, isOnline()&&pendingBuy?'…':priceText(w),'buy',!!pendingBuy,()=>shopBuy('weapon', w.id, 0, undefined, ()=>buyWeapon(profile, w.id)));
      }
      body.appendChild(div);
    }
  }
}
function openGarage(){ renderGarage(); if(garageOverlay) garageOverlay.classList.add('show'); paused=true; }
function closeGarage(){ if(garageOverlay) garageOverlay.classList.remove('show'); if(!finished) paused=false; }
if(garageBtn) garageBtn.addEventListener('click', openGarage);
if(garageBtn2) garageBtn2.addEventListener('click', ()=>{ pauseOverlay.classList.remove('show'); openGarage(); });
if(garageClose) garageClose.addEventListener('click', closeGarage);
if(garageOverlay) garageOverlay.addEventListener('click', (e)=>{ if(e.target===garageOverlay) closeGarage(); });

function rankCars(){
  if (typeof netMode !== 'undefined' && netMode === 'online' && !isPractice()) {
    const act = remoteGhosts.filter((g) => g.active).map((g) => g.car);
    return [player, ...act].sort((a, b) => b.progress - a.progress);
  }
  return [...cars].sort((a,b)=> b.progress - a.progress);
}
function showFinish(rank){
  paused=true; pauseOverlay.classList.add('show');
  hideReviveOverlay();
  // rewards — Phase 13: server is the only minter (AWARD msg). No local wallet.
  const xpGain = XP_REWARDS.finish[Math.min(rank-1, XP_REWARDS.finish.length-1)] || 10;
  const coinsBonus = rank===1? 48 : rank===2? 28 : rank===3? 14 : 6;
  const playerKills = (player && player.cstate && player.cstate.kills) || profile.stats.kills || 0;
  const coinsBefore = profile.stats.coinsCollected || 0;
  let r = { levelUp: false };
  try { if(net) net.sendFinish(rank); } catch {}
  profile.stats.races=(profile.stats.races||0)+1;
  if(rank===1) profile.stats.wins=(profile.stats.wins||0)+1;
  profile.stats.bestPos=Math.min(profile.stats.bestPos||6, rank);
  saveProfile(profile); refreshEconHUD(); persistProfile(true);
  // Phase 3: match history (IndexedDB) + backend-shaped sync op.
  try {
    recordMatch({ rank, laps: TOTAL_LAPS, kills: playerKills, coinsBonus, xpGain, coinsCollected: (profile.stats.coinsCollected||0) - coinsBefore, durationSec: Math.round(gameTime) });
    settings = saveSettings({ lastPlayedAt: Date.now() });
    renderHistory(); refreshSyncInfo();
  } catch {}
  popCoins(`+${xpGain} XP`,'xp'); popCoins(`+$${coinsBonus}`,'');
  if(r.levelUp) popCoins(`LEVEL ${r.after}!`,'xp');
  // Phase 6 daily challenge: one completion bonus per calendar day.
  try {
    const d = claimDaily();
    if (d.ok) { addCoins(profile, d.coins); refreshEconHUD(); persistProfile(true); popCoins(`DAILY +$${d.coins}`); }
  } catch {}
  try { logEvent('race_finish', { rank }); settings = saveSettings({ lastPlayedAt: Date.now() }); } catch {}
  const suffix=rank===1?'ST':rank===2?'ND':rank===3?'RD':'TH';
  pauseTitle.textContent=rank===1?'YOU WIN!':`P${rank} FINISH`;
  pauseSub.textContent=(rank===1?`Champion — ${TOTAL_LAPS} laps`:`You finished ${rank}${suffix} of 6`)+`  +$${coinsBonus} +${xpGain}XP`;
  document.getElementById('restartBtn').textContent='RACE AGAIN';
}

// ---------- HUD ----------
function updateHUD(){
  const kmh=Math.round(player.speed*3.6*2.1);
  speedEl.innerHTML=`${kmh} <small>KM/H</small>`;
  lapEl.textContent=`LAP ${Math.min(player.lap+1,TOTAL_LAPS)} / ${TOTAL_LAPS}`;
  const order=rankCars(), rank=order.indexOf(player)+1;
  posEl.textContent=`P${rank} / 6`;
  const hp=Math.max(0, player.cstate.health);
  healthFill.style.width=hp+'%';
  healthFill.className=hp<30?'low':hp<60?'mid':'';
  if(player.cstate.invuln>0) healthFill.style.opacity=0.55+Math.sin(gameTime*14)*0.25;
  else healthFill.style.opacity=1;
  // damage vignette fade
  if(player.cstate.wrecked || hp<30) damageVignette.style.boxShadow='inset 0 0 90px rgba(255,0,0,.45)';
  else if(hitFlashTimer<=0 && hp>=30) damageVignette.style.boxShadow='inset 0 0 120px rgba(255,0,0,0)';
  let html=''; order.forEach((c,idx)=>{
    const isMe=c.isPlayer; const hp2=Math.round(c.cstate.health);
    const icon=c.out?'🏁':c.cstate.wrecked?'💀': (c.cstate.weapon? WEAPON_DEFS[c.cstate.weapon.type].icon : '🔫');
    // Phase 13: humans = server tags, bots = 🤖 in their own color. YOU = your tag.
    let label;
    if(isMe) label = 'YOU ' + (profile.tag || '');
    else if(c.netRemote) label = '👤 ' + (c.netName || c.netId || 'Rival');
    else { const hex='#'+(c.color||0xffffff).toString(16).padStart(6,'0'); label = `<span style="color:${hex}">🤖 BOT-${c.idx}</span>`; }
    const stat=c.out?'OUT':(c.cstate.wrecked?'WRECKED':`${c.lap+1}/${TOTAL_LAPS} ${hp2}% ⛽${Math.round(c.fuel)}`);
    html+=`<div style="${isMe?'color:#ffcc00;font-weight:900':''}">${idx+1}. ${label} ${stat} ${icon}</div>`;
  });
  positionsEl.innerHTML=`<b>RACE</b><br>`+html;
  // weapon HUD — Phase 8: pickup weapon first, else mounted reserve
  const w=player.cstate.weapon;
  const gun=activeGun(player.cstate);
  if(!gun || player.cstate.wrecked || player.out){
    weaponHUD.classList.add('empty'); weaponIcon.textContent='—';
    weaponName.textContent = player.out ? 'OUT OF RACE' : (player.cstate.mounted && player.cstate.mounted.ammo<=0 ? 'NO AMMO' : 'NO WEAPON');
    weaponAmmo.textContent=''; weaponTimerFill.style.width='0%'; weaponTimerFill.style.background='#555';
  }
  else if(gun==='mounted'){
    weaponHUD.classList.remove('empty');
    const mdef=WEAPON_DEFS[player.cstate.mounted.type] || WEAPON_DEFS.mg;
    const n=player.cstate.mounts.length;
    weaponIcon.textContent=mdef.icon; weaponName.textContent=(player.cstate.disabled>0?'⚡ ':'')+mdef.label+(n>1?` [${player.cstate.mountIdx+1}/${n}]`:'');
    weaponAmmo.textContent=`${player.cstate.mounted.ammo} reserve`;
    weaponTimerFill.style.width='100%'; weaponTimerFill.style.background= player.cstate.disabled>0 ? 'linear-gradient(90deg,#ffe14d,#ff9a00)' : 'linear-gradient(90deg,#2de2ff,#2d7dff)';
  }
  else { weaponHUD.classList.remove('empty'); const def=WEAPON_DEFS[w.type]; weaponIcon.textContent=def.icon; weaponName.textContent=def.label; weaponAmmo.textContent=w.ammo>0? `${w.ammo} • ${w.ttl.toFixed(1)}s` : `— • ${w.ttl.toFixed(1)}s`; const pct=Math.max(0, w.ttl/def.ttl*100); weaponTimerFill.style.width=pct+'%'; weaponTimerFill.style.background= pct<30?'linear-gradient(90deg,#ff3344,#ff6a00)':'linear-gradient(90deg,#ffcc00,#ff6a00)'; }
  fireBtn.textContent = gun==='mounted' ? 'FIRE 🔫' : (w ? `FIRE ${WEAPON_DEFS[w.type].icon}` : 'FIRE');
  // Phase 8: fuel bar + low-fuel warning (Phase 9: per-vehicle tank size)
  if(fuelFill){
    const fp=Math.max(0, player.fuel/(player.fuelMax||FUEL_MAX)*100);
    fuelFill.style.width=fp+'%';
    fuelFill.className=fp<22?'low':'';
  }
  if(!player.out && started && player.fuel<22 && !lowFuelWarned){ lowFuelWarned=true; popCoins('LOW FUEL — FIND ⛽',''); }
}

function drawMinimap(){
  const w=140,h=140; miniCtx.clearRect(0,0,w,h); miniCtx.fillStyle='#0a0f18'; miniCtx.fillRect(0,0,w,h);
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity; sampled.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);});
  const pad=12; const sx=(w-pad*2)/(maxX-minX), sz=(h-pad*2)/(maxZ-minZ); const s=Math.min(sx,sz); const ox=(w-(maxX-minX)*s)/2 - minX*s, oz=(h-(maxZ-minZ)*s)/2 - minZ*s; const tx=x=>x*s+ox, tz=z=>z*s+oz;
  miniCtx.strokeStyle='#2a3a4a'; miniCtx.lineWidth=10; miniCtx.lineCap='round'; miniCtx.lineJoin='round'; miniCtx.beginPath(); sampled.forEach((p,i)=>{const x=tx(p.x), y=tz(p.z); if(i===0) miniCtx.moveTo(x,y); else miniCtx.lineTo(x,y);}); miniCtx.closePath(); miniCtx.stroke();
  miniCtx.strokeStyle='#3a4a5a'; miniCtx.lineWidth=6; miniCtx.stroke();
  checkpointPos.forEach((p,i)=>{ if(i===0){miniCtx.fillStyle='#ffcc00'; miniCtx.fillRect(tx(p.x)-3,tz(p.z)-3,6,6); } else {miniCtx.fillStyle='rgba(255,255,255,0.6)'; miniCtx.beginPath(); miniCtx.arc(tx(p.x),tz(p.z),1.8,0,Math.PI*2); miniCtx.fill(); }});
  pickups.forEach(p=>{ if(!p.alive) return; const x=tx(p.pos.x), y=tz(p.pos.z); miniCtx.beginPath(); miniCtx.arc(x,y,2.2,0,Math.PI*2); const col=pickupColor(p.type); miniCtx.fillStyle='#'+col.toString(16).padStart(6,'0'); miniCtx.fill(); });
  // Phase 8: roadblocks (red destructible, gray heavy/tires)
  blocks.forEach(b=>{ if(!b.alive) return; const x=tx(b.pos.x), y=tz(b.pos.z); const def=BLOCK_TYPES[b.type]; miniCtx.fillStyle=def.destructible&&!def.heavy?'#ff6a00':'#888'; miniCtx.fillRect(x-2,y-2,4,4); });
  // Phase 10: shortcuts (dashed gray), hazards (purple oil/orange debris), ramps (cyan)
  miniCtx.strokeStyle='rgba(160,160,170,.8)'; miniCtx.lineWidth=2; miniCtx.setLineDash([3,3]);
  miniCtx.beginPath();
  for(const s of shortcutSegs){ miniCtx.moveTo(tx(s.ax),tz(s.az)); miniCtx.lineTo(tx(s.bx),tz(s.bz)); }
  miniCtx.stroke(); miniCtx.setLineDash([]);
  hazards.forEach(h=>{ const x=tx(h.x), y=tz(h.z); miniCtx.beginPath(); miniCtx.arc(x,y,3,0,Math.PI*2); miniCtx.fillStyle=h.type==='oil'?'#7a2be2':'#ff8a3d'; miniCtx.fill(); });
  ramps.forEach(r=>{ const x=tx(r.x), y=tz(r.z); miniCtx.fillStyle='#2de2ff'; miniCtx.fillRect(x-2,y-2,4,4); });
  // Phase 11: brands (blue squares) + people (pink dots)
  brandBoards.forEach(b=>{ const x=tx(b.x), y=tz(b.z); miniCtx.fillStyle='#2d7dff'; miniCtx.fillRect(x-2.5,y-2.5,5,5); });
  peopleBoards.forEach(p=>{ const x=tx(p.x), y=tz(p.z); miniCtx.beginPath(); miniCtx.arc(x,y,2.5,0,Math.PI*2); miniCtx.fillStyle='#ff6ab0'; miniCtx.fill(); });
  coinsTokens.forEach(t=>{ if(!t.alive) return; const x=tx(t.pos.x), y=tz(t.pos.z); miniCtx.beginPath(); miniCtx.arc(x,y,3,0,Math.PI*2); miniCtx.fillStyle='#ffd700'; miniCtx.fill(); miniCtx.strokeStyle='rgba(0,0,0,.6)'; miniCtx.lineWidth=1; miniCtx.stroke(); });
  projectiles.forEach(pr=>{ if(!pr.alive) return; const x=tx(pr.pos.x), y=tz(pr.pos.z); miniCtx.beginPath(); miniCtx.arc(x,y, pr.type==='mine'?2.6:1.8,0,Math.PI*2); miniCtx.fillStyle=pr.type==='mine'?'#8a2be2': pr.type==='rocket'?'#ff3b30':'#ffcc00'; miniCtx.fill(); });
  cars.forEach(c=>{
    if(typeof netMode!=='undefined' && netMode==='online' && !isPractice() && !c.isPlayer) return; // bots hidden online (shown in practice)
    const x=tx(c.pos.x), y=tz(c.pos.z); miniCtx.beginPath(); miniCtx.arc(x,y,c.isPlayer?4.2:3,0,Math.PI*2);
    if(c.cstate.wrecked){ miniCtx.fillStyle='#000'; } else miniCtx.fillStyle=c.isPlayer?'#ff2d2d':'#'+c.color.toString(16).padStart(6,'0');
    miniCtx.fill(); miniCtx.strokeStyle='rgba(0,0,0,0.6)'; miniCtx.lineWidth=1; miniCtx.stroke();
    if(c.isPlayer){ miniCtx.beginPath(); miniCtx.moveTo(x,y); miniCtx.lineTo(x+Math.sin(c.yaw)*7, y+Math.cos(c.yaw)*7); miniCtx.strokeStyle='#fff'; miniCtx.lineWidth=1.2; miniCtx.stroke(); }
  });
  if(typeof netMode!=='undefined' && netMode==='online' && typeof remoteGhosts!=='undefined'){
    remoteGhosts.forEach(g=>{ if(!g.active) return; const c=g.car;
      const x=tx(c.pos.x), y=tz(c.pos.z); miniCtx.beginPath(); miniCtx.arc(x,y,3,0,Math.PI*2);
      miniCtx.fillStyle=c.cstate.wrecked?'#000':'#2ecc71'; miniCtx.fill(); miniCtx.strokeStyle='rgba(0,0,0,0.6)'; miniCtx.lineWidth=1; miniCtx.stroke();
    });
  }
}

function updateCamera(dt){
  // Phase 8: spectate the leader when out
  const focus = (spectating && player.out)
    ? (rankCars().find(c => !c.out && !c.cstate.wrecked) || player)
    : player;
  const target=focus.pos.clone(); const yaw=focus.yaw;
  const jumpLift = ((focus.jumpY || 0)) * 0.4;
  let camX, camY, camZ, lookY = 0.8;
  if (camMode === 1) {
    // HOOD: low over the nose
    const d = 1.2;
    camX = target.x + Math.sin(yaw) * d; camZ = target.z + Math.cos(yaw) * d; camY = 2.6 + jumpLift;
    lookY = 1.2;
    camera.position.set(camX, camY, camZ);
    camera.lookAt(target.x + Math.sin(yaw) * 30, lookY, target.z + Math.cos(yaw) * 30);
    if (shake > 0) { camera.position.x += (Math.random()-0.5)*shake; camera.position.y += (Math.random()-0.5)*shake*0.6; shake=Math.max(0, shake - dt*3.2); }
  } else if (camMode === 2) {
    // FAR: high chase for junctions/overview
    const dist = 34, height = 22;
    camX = target.x - Math.sin(yaw)*dist; camZ = target.z - Math.cos(yaw)*dist; camY = height + jumpLift;
    if(shake>0){ camX+=(Math.random()-0.5)*shake; camY+=(Math.random()-0.5)*shake*0.6; camZ+=(Math.random()-0.5)*shake; shake=Math.max(0, shake - dt*3.2); }
    camera.position.lerp(new THREE.Vector3(camX,camY,camZ), 1-Math.pow(1-0.085,dt*60));
    camera.lookAt(target.x,0.8,target.z);
  } else {
    const dist=18+Math.min(8,focus.speed*0.12); const height=9+Math.min(4,focus.speed*0.06);
    camX=target.x - Math.sin(yaw)*dist; camZ=target.z - Math.cos(yaw)*dist; camY=height + jumpLift;
    if(shake>0){ camX+=(Math.random()-0.5)*shake; camY+=(Math.random()-0.5)*shake*0.6; camZ+=(Math.random()-0.5)*shake; shake=Math.max(0, shake - dt*3.2); }
    camera.position.lerp(new THREE.Vector3(camX,camY,camZ), 1-Math.pow(1-0.085,dt*60));
    camera.lookAt(target.x,0.8,target.z);
  }
  // Phase 7: sun shadow frustum + headlight follow the focus car
  if (IS_HIGH()) {
    dir.position.set(focus.pos.x + 60 - todPhase * 140, 90 - todPhase * 55, focus.pos.z + 40);
    dir.target.position.set(focus.pos.x, 0, focus.pos.z);
    dir.target.updateMatrixWorld();
  }
  const lampOn = todPhase > 0.45;
  playerHead.intensity = lampOn ? (IS_HIGH() ? 60 : 25) : 0;
  if (lampOn) {
    playerHead.position.set(focus.pos.x + Math.sin(yaw) * 1, 2.2 + (focus.jumpY || 0), focus.pos.z + Math.cos(yaw) * 1);
    playerHead.target.position.set(focus.pos.x + Math.sin(yaw) * 30, 0, focus.pos.z + Math.cos(yaw) * 30);
    playerHead.target.updateMatrixWorld();
  }
}

let last=performance.now(), acc=0; const FIXED=1/60;
let fpsEMA=60, frameCount=0, perfTimer=0;
function updatePerfHUD(dt){
  if (dt > 0) fpsEMA += ((1 / Math.max(dt, 1e-4)) - fpsEMA) * 0.05;
  frameCount++; perfTimer += dt;
  if (perfTimer >= 0.5 && perfHUD) {
    const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
    perfHUD.innerHTML = `<b>${Math.round(fpsEMA)}</b> FPS • ${calls} calls • ${(tris/1000).toFixed(0)}k tris • ${IS_HIGH()?'HIGH':'SIMPLE'}`;
    perfTimer = 0;
  }
}
function frame(now){
  requestAnimationFrame(frame);
  // PHASE 16: global frame counters (debug panel + headless layout tests)
  window.__rkFrames = (window.__rkFrames || 0) + 1;
  window.__rkFrameNow = now;
  if (!window.__rkFpsT0) { window.__rkFpsT0 = now; window.__rkFpsN = 0; }
  window.__rkFpsN++;
  if (now - window.__rkFpsT0 >= 1000) { window.__rkFps = Math.round(window.__rkFpsN * 1000 / (now - window.__rkFpsT0)); window.__rkFpsT0 = now; window.__rkFpsN = 0; }
  const dtMs=Math.min(50, now-last); last=now; const dt=dtMs/1000; acc+=dt;
  pollGamepad();
  if (skyTime === 'auto') applyTimeOfDay((gameTime * 0.008) % 1);
  if(hitFlashTimer>0){ hitFlashTimer-=dt; if(hitFlashTimer<=0) hitFlash.classList.remove('show'); }
  if(paused){ renderer.render(scene,camera); drawMinimap(); updatePerfHUD(dt); return; }
  if(!started){
    gameTime+=dt; cars.forEach(c=>{ c.mesh.position.y=0.15+Math.sin(gameTime*2+c.trackIdx*0.1)*0.05; pickupMeshes.forEach((m,i)=>{ m.rotation.y+=dt*1.6; m.position.y=0.55+Math.sin(gameTime*2+i)*0.22; }); });
    renderer.render(scene,camera); drawMinimap(); updateHUD(); updatePerfHUD(dt); return;
  }
  while(acc>=FIXED){
    gameTime+=FIXED;
    tickCombatStates(combatStates, FIXED, gameTime);
    // respawn handles: bots auto after 2.2s, player waits for gem
    for(const c of cars){
      if(!c.cstate.wrecked) continue;
      if(c.isPlayer) continue; // player must pay
      const tSince=c.cstate.wreckTime? (gameTime - c.cstate.wreckTime): 999;
      if(tSince>2.2){
        // bot revive (free, counts toward its revivesUsed but no gems)
        if(c.cstate.revivesUsed < 3){
          doRevive(c.cstate, gameTime);
          c.fuel=Math.max(c.fuel, FUEL_REVIVE);
          const cpIdx=(c.checkpoint+1)%CHECKPOINTS; const base=checkpointPos[cpIdx];
          const tg=sampledTangents[Math.floor(cpIdx/CHECKPOINTS*TRACK_SAMPLES)];
          const nx=-tg.z, nz=tg.x; const len=Math.hypot(nx,nz)||1; const nnx=nx/len, nnz=nz/len;
          const jitter=(Math.random()-0.5)*6;
          c.pos.set(base.x+nnx*jitter,0,base.z+nnz*jitter);
          c.yaw=Math.atan2(tg.x,tg.z);
          c.vel.set(Math.sin(c.yaw)*6,0,Math.cos(c.yaw)*6);
          c.vy=0; c.jumpY=0; c.airborne=false;
          spawnExplosion(c.pos, 0x2de2ff, 0.9, 10);
        } else {
          c.cstate.permanentWreck=true;
          c.out=true; c.outReason='wrecks'; // Phase 8: bot done for this race
        }
      }
    }
    for(const c of cars){ if(netMode==='online' && !isPractice() && !c.isPlayer) continue; updateCar(c, FIXED, c.isPlayer); }
    // lap counting moved into updateCar (Phase 10 wrap-aware checkpoints)
    tickProjectiles(FIXED);
    tickPickups(FIXED);
    tickCoinsTokens(FIXED);
    tickBlocks(FIXED);
    tickHazards(FIXED);
    tickBanners(FIXED);
    if(netMode==='online'){ reconcilePlayer(); }
    acc-=FIXED;
  }
  if(netMode==='online') updateRemoteGhosts();
  updateCamera(dt); updateEffects(dt); updateHUD(); drawMinimap(); updatePerfHUD(dt);
  // check incoming projectile for player dodge hint (auto steer)
  // compute if projectile heading at player within 16, set dodgeDir
  let dodgeNeeded=0;
  for(const pr of projectiles){ if(pr.ownerId===player.idx) continue; const dx=pr.pos.x - player.pos.x, dz=pr.pos.z - player.pos.z; const d=Math.hypot(dx,dz); if(d<16 && pr.type!=='mine'){ const toAng=Math.atan2(dx,dz), prYaw=Math.atan2(pr.vel.x,pr.vel.z); let diff=Math.atan2(Math.sin(toAng-prYaw),Math.cos(toAng-prYaw)); if(Math.abs(diff)>2.2){ dodgeNeeded = (Math.random()>0.5?1:-1); break; } }}
  if(dodgeNeeded!==0) player.dodgeDir=dodgeNeeded*0.7;
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
addEventListener('resize',()=>{ updateHudScale(); updateOrientation(); });
addEventListener('orientationchange',()=> setTimeout(()=>{ updateHudScale(); updateOrientation(); }, 250));
if (window.visualViewport) visualViewport.addEventListener('resize', ()=>{ updateHudScale(); updateOrientation(); });
document.addEventListener('fullscreenchange', ()=> setTimeout(updateHudScale, 120));
// Phase 7 init: quality select, time-of-day, orientation prompt
if (setQuality) {
  setQuality.value = qualityMode;
  setQuality.addEventListener('change', () => {
    qualityMode = setQuality.value;
    try { settings = saveSettings({ quality: qualityMode }); } catch {}
    location.reload(); // material/shadow pipeline is build-time; reload applies cleanly
  });
}
if (setTOD) {
  setTOD.value = skyTime;
  setTOD.addEventListener('change', () => setTODMode(setTOD.value));
}
setTODMode(skyTime);
updateOrientation();
updateHudScale();
setTimeout(()=>{ if(!started) centerMsg.innerHTML='<h1>ROAD KILL</h1><p>TAP TO CONNECT — ONLINE ONLY</p><p style="font-size:11px;opacity:.6;margin-top:4px">Quick match, private rooms & practice — all on the server.</p>'; },500);

// ---------- PHASE 16 boot: build the world AFTER all declarations ----------
// (was: buildTrack/placeCars/spawnPickups/spawnRoadblocks called mid-file before
// their state existed -> dead static page on phones; see Phase 16 notes in ROADMAP)
function bootWorld(){
  try {
    buildTrack(currentTrackIdx);
    placeCars();
    spawnPickups();
    spawnRoadblocks();
    window.__rkBooted = true;
  } catch (e) {
    window.__rkBootError = String(e && e.stack || e);
    console.error('[ROADKILL] boot failed:', e);
  }
}
bootWorld();

// ---------- PHASE 16 hidden debug panel: tap top-left corner 3x ----------
const debugPanel = document.getElementById('debugPanel');
let cornerTaps = 0, cornerTapTimer = null;
addEventListener('pointerdown', (e) => {
  const w = innerWidth, h = innerHeight;
  if (e.clientX < w * 0.18 && e.clientY < h * 0.18) {
    cornerTaps++;
    clearTimeout(cornerTapTimer);
    cornerTapTimer = setTimeout(() => (cornerTaps = 0), 1200);
    if (cornerTaps >= 3) { cornerTaps = 0; if (debugPanel) debugPanel.classList.toggle('show'); }
  }
}, { passive: true });
let dbgWebgl = 'unknown';
try { const t = document.createElement('canvas'); dbgWebgl = (t.getContext('webgl2') ? 'WebGL2' : t.getContext('webgl') ? 'WebGL1' : 'NONE'); } catch (e) { dbgWebgl = 'error'; }
setInterval(() => {
  if (!debugPanel || !debugPanel.classList.contains('show')) return;
  let renderer_ = 'n/a';
  try { renderer_ = dbgWebgl; } catch {}
  const lines = [
    `SCREEN    ${innerWidth} x ${innerHeight} @${devicePixelRatio.toFixed(2)}x`,
    `ORIENT    ${innerWidth >= innerHeight ? 'landscape' : 'PORTRAIT (blocked)'}`,
    `VIEWPORT  vis ${Math.round((visualViewport && visualViewport.width) || innerWidth)} x ${Math.round((visualViewport && visualViewport.height) || innerHeight)}`,
    `FULLSCR   ${document.fullscreenElement ? 'yes' : 'no'}`,
    `WEBGL     ${dbgWebgl} (${renderer.info ? 'three ok' : 'three?'})`,
    `FPS       ${Math.round(fpsEMA)} · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`,
    `QUALITY   ${qualityMode.toUpperCase()}`,
    `SERVER    ${net && net.connected ? 'connected' : 'offline'} ${net && net.roomCode ? 'room ' + net.roomCode : ''} ${net && net.lastRtt ? 'rtt ' + Math.round(net.lastRtt) + 'ms' : ''}`,
    `BOOT      ${window.__rkBooted ? 'ok' : window.__rkBootError ? 'FAILED' : '…'}`,
    `SCALE     hud ${getComputedStyle(document.documentElement).getPropertyValue('--hudscale').trim()} · rotate ${portraitBlocked ? 'blocked' : 'free'}`,
  ];
  debugPanel.textContent = lines.join('\n');
}, 500);
