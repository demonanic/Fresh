import { BALANCE } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import {
  has, dist, getCore, nearestDepot, addResource, revealCircle, maxHp, structureAt, nodeAt,
} from '../core/state.js';

export const NO_INPUT = Object.freeze({ move: { x: 0, y: 0 }, aim: null, fire: false, interact: false });

/** What the context (Interact) button would do right now. */
export function contextAction(state) {
  const p = state.player;
  const P = BALANCE.player;
  if (p.respawn > 0) return null;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  let bestNode = null;
  let bd = P.interactRange;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const n = nodeAt(state, tx + dx, ty + dy);
      if (!n || n.amount <= 0 || structureAt(state, n.x, n.y)) continue;
      const d = dist(p.x, p.y, n.x + 0.5, n.y + 0.5);
      if (d <= bd) { bd = d; bestNode = n; }
    }
  }
  const carryOk = bestNode && (p.carry.type === null || p.carry.type === bestNode.type) && p.carry.amount < P.carryCap;
  if (bestNode && carryOk) return { kind: 'mine', node: bestNode };
  let bestS = null;
  let bs = Infinity;
  for (const s of state.structures) {
    if (s.hp >= maxHp(s) - 0.01) continue;
    const d = dist(p.x, p.y, s.x + 0.5, s.y + 0.5) - BUILDINGS[s.type].radius;
    if (d <= P.interactRange && d < bs) { bs = d; bestS = s; }
  }
  if (bestS) return { kind: 'repair', structure: bestS };
  if (bestNode) return { kind: 'full', node: bestNode };
  return null;
}

export function updatePlayer(state, dt, input = NO_INPUT) {
  const p = state.player;
  const P = BALANCE.player;
  const { w, h } = state.sector;
  p.action = null;

  if (p.respawn > 0) {
    p.respawn -= dt;
    if (p.respawn <= 0) {
      const core = getCore(state);
      p.x = core.x + 0.5;
      p.y = core.y + 2.6;
      p.hp = P.hp;
      p.respawn = 0;
    }
    return;
  }

  const mx = input.move ? input.move.x : 0;
  const my = input.move ? input.move.y : 0;
  const mag = Math.hypot(mx, my);
  if (mag > 0.05) {
    const k = Math.min(1, mag) / mag;
    p.x = Math.max(0.5, Math.min(w - 0.5, p.x + mx * k * P.speed * dt));
    p.y = Math.max(0.5, Math.min(h - 0.5, p.y + my * k * P.speed * dt));
    if (!input.aim) p.aim = Math.atan2(my, mx);
  }
  if (input.aim) p.aim = Math.atan2(input.aim.y, input.aim.x);

  // Weapon
  p.fireCd -= dt;
  if (input.fire && p.fireCd <= 0) {
    p.fireCd = 1 / P.fireRate;
    const speed = P.projectileSpeed;
    state.projectiles.push({
      x: p.x, y: p.y, vx: Math.cos(p.aim) * speed, vy: Math.sin(p.aim) * speed,
      damage: P.gunDamage, life: P.gunRange / speed, color: '#39FF14', fromPlayer: true,
    });
  }

  // Automatic pickup from extractor buffers
  for (const s of state.structures) {
    if (s.type !== 'extractor' || s.buffer.amount < 0.01) continue;
    if (dist(p.x, p.y, s.x + 0.5, s.y + 0.5) > P.pickupRange) continue;
    if (p.carry.type !== null && p.carry.type !== s.buffer.type) continue;
    const take = Math.min(P.carryCap - p.carry.amount, s.buffer.amount);
    if (take <= 0) continue;
    p.carry.type = s.buffer.type;
    p.carry.amount += take;
    s.buffer.amount -= take;
  }

  // Automatic deposit at Core / Storage
  if (p.carry.amount > 0) {
    const depot = nearestDepot(state, p.x, p.y);
    if (depot && dist(p.x, p.y, depot.x + 0.5, depot.y + 0.5) <= P.depositRange + BUILDINGS[depot.type].radius) {
      const added = addResource(state, p.carry.type, p.carry.amount);
      state.stats.manualDeposited += added;
      state._deliveredThisTick = (state._deliveredThisTick || 0) + added;
      p.carry.amount -= added;
      if (p.carry.amount <= 1e-6) p.carry = { type: null, amount: 0 };
    }
  }

  // Context action: mine a deposit or repair a structure
  if (input.interact) {
    const act = contextAction(state);
    if (act && act.kind === 'mine') {
      const n = act.node;
      const amt = Math.min(P.mineRate[n.type] * dt, n.amount, P.carryCap - p.carry.amount);
      n.amount -= amt;
      p.carry.type = n.type;
      p.carry.amount += amt;
      p.action = 'mining';
    } else if (act && act.kind === 'repair') {
      const s = act.structure;
      const gain = Math.min(P.repairRate * (has(state, 't_repair') ? 2 : 1) * dt, maxHp(s) - s.hp);
      const cost = gain * P.repairCostPerHp;
      if (state.resources.scrap >= cost) {
        state.resources.scrap -= cost;
        s.hp += gain;
        p.action = 'repairing';
      }
    }
  }

  // Regenerate out of combat
  const threatened = state.enemies.some((e) => dist(e.x, e.y, p.x, p.y) < 5);
  if (!threatened) p.hp = Math.min(P.hp, p.hp + P.regen * dt);

  revealCircle(state, p.x, p.y, P.revealRadius);
}
