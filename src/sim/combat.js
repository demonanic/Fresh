import { BUILDINGS } from '../data/buildings.js';
import { ENEMIES, INFRASTRUCTURE_TYPES, DEFENSE_TYPES } from '../data/enemies.js';
import { BALANCE } from '../data/balance.js';
import { rand } from '../core/rng.js';
import {
  has, isInactive, levelMult, dist, nextId, addResource, scaleCost, removeStructure,
  log, emit, getCore, maxHp,
} from '../core/state.js';
import { handleHubLost } from './logistics.js';
import { waveBudget } from './threat.js';

export function spawnEnemy(state, type, x, y) {
  const def = ENEMIES[type];
  const e = { id: nextId(state), type, x, y, hp: def.hp, atkCd: 0, targetId: null, retarget: 0 };
  state.enemies.push(e);
  return e;
}

export function spawnWave(state) {
  const wave = state.threat.wave;
  let budget = waveBudget(state);
  const spawns = state.sector.spawns;
  const points = [];
  const nPoints = Math.min(spawns.length, 1 + Math.floor(wave / 4));
  const start = Math.floor(rand(state) * spawns.length);
  for (let i = 0; i < nPoints; i++) points.push(spawns[(start + i) % spawns.length]);
  let count = 0;
  let guard = 0;
  while (budget > 0 && guard++ < 200) {
    const types = Object.entries(ENEMIES).filter(([, d]) => d.minWave <= wave && d.cost <= budget);
    if (!types.length) break;
    const [type, def] = types[Math.floor(rand(state) * types.length)];
    const p = points[Math.floor(rand(state) * points.length)];
    for (let g = 0; g < def.group; g++) {
      spawnEnemy(state, type, p.x + 0.5 + (rand(state) - 0.5) * 2, p.y + 0.5 + (rand(state) - 0.5) * 2);
      count++;
    }
    budget -= def.cost;
  }
  state.threat.waveEnemies = count;
  return count;
}

function findTarget(state, e) {
  const def = ENEMIES[e.type];
  let pool = state.structures;
  if (def.target === 'infrastructure') {
    const infra = pool.filter((s) => INFRASTRUCTURE_TYPES.includes(s.type));
    if (infra.length) pool = infra;
  } else if (def.target === 'defense') {
    pool = pool.filter((s) => DEFENSE_TYPES.includes(s.type));
  }
  let best = null;
  let bd = Infinity;
  for (const s of pool) {
    const d = dist(e.x, e.y, s.x + 0.5, s.y + 0.5);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export function damagePlayer(state, amount) {
  const p = state.player;
  if (p.respawn > 0) return;
  p.hp -= amount;
  if (p.hp <= 0) {
    p.hp = 0;
    p.respawn = BALANCE.player.respawnSec;
    p.carry = { type: null, amount: 0 };
    log(state, 'Operator unit offline — rebuilding at the Core', 'bad');
    emit(state, 'playerDown', {});
  }
}

export function updateEnemies(state, dt) {
  const p = state.player;
  const byId = new Map(state.structures.map((s) => [s.id, s]));
  for (const e of state.enemies) {
    const def = ENEMIES[e.type];
    e.retarget -= dt;
    let target = e.targetId != null ? byId.get(e.targetId) : null;
    if (!target || e.retarget <= 0) {
      target = findTarget(state, e);
      e.targetId = target ? target.id : null;
      e.retarget = 1;
    }
    // Enemies brawl with the Operator if it gets too close.
    const playerNear = p.respawn <= 0 && dist(e.x, e.y, p.x, p.y) < 1.6;
    let tx; let ty; let reach;
    if (playerNear) { tx = p.x; ty = p.y; reach = def.range + 0.3; } else if (target) {
      if (target.destroyed) { e.targetId = null; e.retarget = 0; continue; }
      tx = target.x + 0.5; ty = target.y + 0.5; reach = def.range + BUILDINGS[target.type].radius;
    } else continue;
    const d = dist(e.x, e.y, tx, ty);
    if (d > reach) {
      const step = def.speed * dt;
      e.x += ((tx - e.x) / d) * Math.min(step, d);
      e.y += ((ty - e.y) / d) * Math.min(step, d);
    } else {
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = 1 / def.attackRate;
        if (playerNear) damagePlayer(state, def.damage);
        else {
          target.hp -= def.damage;
          emit(state, 'hit', { x: tx, y: ty });
          if (target.hp <= 0 && !target.destroyed) destroyStructure(state, target);
        }
      }
    }
  }
}

export function turretStats(state, s) {
  const def = BUILDINGS[s.type];
  let rate = def.fireRate;
  if (s.type !== 'core') {
    rate *= state.power.ratio;
    if (has(state, 't_threat_response') && state.threat.waveActive) rate *= 1.35;
  }
  const damage = def.damage * (s.type === 'core' ? 1 : levelMult(s));
  return { range: def.range, rate, damage, splash: def.splash || 0 };
}

export function updateTurrets(state, dt) {
  for (const s of state.structures) {
    const def = BUILDINGS[s.type];
    if (!def.damage || isInactive(s)) continue;
    const st = turretStats(state, s);
    s.cd -= dt;
    if (s.cd > 0 || st.rate <= 0) continue;
    const cx = s.x + 0.5;
    const cy = s.y + 0.5;
    let best = null;
    let bd = st.range;
    for (const e of state.enemies) {
      const d = dist(cx, cy, e.x, e.y);
      if (d <= bd) { bd = d; best = e; }
    }
    if (!best) continue;
    s.cd = 1 / st.rate;
    s.aim = Math.atan2(best.y - cy, best.x - cx);
    state.projectiles.push({
      x: cx, y: cy, targetId: best.id, damage: st.damage, splash: st.splash, speed: 12, life: 2, color: def.color,
    });
  }
}

export function damageEnemy(state, e, amount) {
  const def = ENEMIES[e.type];
  e.hp -= Math.max(1, amount - def.armor);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    for (const [r, v] of Object.entries(def.drops)) addResource(state, r, v);
    state.stats.enemiesKilled++;
    emit(state, 'kill', { x: e.x, y: e.y, color: def.color });
  }
}

export function updateProjectiles(state, dt) {
  const enemies = new Map(state.enemies.map((e) => [e.id, e]));
  for (const pr of state.projectiles) {
    pr.life -= dt;
    if (pr.targetId != null) {
      const t = enemies.get(pr.targetId);
      if (!t || t.dead) { pr.life = 0; continue; }
      const d = dist(pr.x, pr.y, t.x, t.y);
      const step = pr.speed * dt;
      if (d <= step + ENEMIES[t.type].radius) {
        damageEnemy(state, t, pr.damage);
        if (pr.splash) {
          for (const o of state.enemies) if (o !== t && !o.dead && dist(o.x, o.y, t.x, t.y) <= pr.splash) damageEnemy(state, o, pr.damage * 0.6);
        }
        emit(state, 'impact', { x: t.x, y: t.y, color: pr.color });
        pr.life = 0;
      } else {
        pr.x += ((t.x - pr.x) / d) * step;
        pr.y += ((t.y - pr.y) / d) * step;
      }
    } else {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      for (const e of state.enemies) {
        if (e.dead) continue;
        if (dist(pr.x, pr.y, e.x, e.y) <= ENEMIES[e.type].radius + 0.12) {
          damageEnemy(state, e, pr.damage);
          emit(state, 'impact', { x: e.x, y: e.y, color: pr.color });
          pr.life = 0;
          break;
        }
      }
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
  state.enemies = state.enemies.filter((e) => !e.dead);
}

export function destroyStructure(state, s) {
  if (s.type === 'core') { triggerEmergency(state); return; }
  s.destroyed = true;
  const salvage = scaleCost(BUILDINGS[s.type].cost, BALANCE.salvageOnDestroy);
  const got = [];
  for (const [r, v] of Object.entries(salvage)) {
    const a = addResource(state, r, Math.floor(v));
    if (a > 0) got.push(`${Math.floor(a)} ${r}`);
  }
  let extra = '';
  if (s.type === 'drone_hub') {
    const res = handleHubLost(state, s);
    extra = res.transferred ? ` — ${res.transferred} drones rerouted` : (res.lost ? ` — ${res.lost} drones lost` : '');
  }
  removeStructure(state, s);
  state.stats.structuresLost++;
  log(state, `${s.label} DESTROYED${got.length ? ` — salvaged ${got.join(', ')}` : ''}${extra}`, 'bad');
  emit(state, 'destroyed', { x: s.x + 0.5, y: s.y + 0.5, label: s.label });
}

/** Core overwhelmed: the save survives; the network enters emergency recovery. */
export function triggerEmergency(state) {
  const core = getCore(state);
  const lost = {};
  for (const r of ['scrap', 'components']) {
    lost[r] = Math.floor(state.resources[r] * BALANCE.emergencyLoss);
    state.resources[r] -= lost[r];
  }
  state.enemies = [];
  state.projectiles = [];
  core.hp = maxHp(core) * 0.5;
  state.threat.waveActive = false;
  state.threat.meter = 0;
  state.emergency = { lost, at: state.time, recovered: false };
  log(state, 'CORE OVERWHELMED — emergency recovery engaged', 'bad');
  emit(state, 'emergency', { lost });
}
