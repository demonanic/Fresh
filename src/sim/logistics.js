import { BUILDINGS } from '../data/buildings.js';
import { BALANCE } from '../data/balance.js';
import { has, isInactive, nearestDepot, addResource, dist, nextId } from '../core/state.js';
import { recordDelivery } from './economy.js';

export function droneCap(state) {
  return BALANCE.drone.cap * (has(state, 't_cargo') ? 1.6 : 1);
}

export function hubDroneCount(hub) {
  const def = BUILDINGS.drone_hub;
  return def.drones + (hub.level - 1) * def.upgrade.addDrones;
}

function moveToward(o, tx, ty, step) {
  const d = Math.hypot(tx - o.x, ty - o.y);
  if (d <= step) { o.x = tx; o.y = ty; return true; }
  o.x += ((tx - o.x) / d) * step;
  o.y += ((ty - o.y) / d) * step;
  return false;
}

/** Extractors a hub can service. */
export function coveredExtractors(state, hub) {
  const range = BUILDINGS.drone_hub.range;
  return state.structures.filter((s) => s.type === 'extractor' && dist(s.x, s.y, hub.x, hub.y) <= range);
}

function findJob(state, drone, hub, reserved) {
  const cap = droneCap(state);
  let best = null;
  let bestScore = -Infinity;
  for (const s of coveredExtractors(state, hub)) {
    const free = s.buffer.amount - (reserved.get(s.id) || 0);
    if (free < Math.min(BALANCE.drone.pickupMin, cap)) continue;
    const score = free - dist(drone.x, drone.y, s.x + 0.5, s.y + 0.5) * 0.1;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/** Reassign or remove drones whose hub is gone. Called when a hub is destroyed. */
export function handleHubLost(state, hub) {
  const orphans = state.drones.filter((d) => d.hubId === hub.id);
  const others = state.structures.filter((s) => s.type === 'drone_hub' && s.id !== hub.id);
  if (has(state, 't_routing') && others.length) {
    for (const d of orphans) {
      let best = others[0];
      for (const o of others) if (dist(hub.x, hub.y, o.x, o.y) < dist(hub.x, hub.y, best.x, best.y)) best = o;
      d.hubId = best.id;
      d.bonus = true; // transferred drones persist on top of the hub's own complement
    }
    return { transferred: orphans.length, lost: 0 };
  }
  state.drones = state.drones.filter((d) => d.hubId !== hub.id);
  return { transferred: 0, lost: orphans.length };
}

export function updateLogistics(state, dt) {
  const hubs = new Map(state.structures.filter((s) => s.type === 'drone_hub').map((h) => [h.id, h]));
  state.drones = state.drones.filter((d) => hubs.has(d.hubId));

  // Keep each hub's drone complement in sync with its level.
  for (const hub of hubs.values()) {
    const own = state.drones.filter((d) => d.hubId === hub.id && !d.bonus);
    for (let i = own.length; i < hubDroneCount(hub); i++) {
      state.drones.push({
        id: nextId(state), hubId: hub.id, x: hub.x + 0.5, y: hub.y + 0.5,
        state: 'idle', targetId: null, cargo: { type: null, amount: 0 }, wait: 0,
      });
    }
  }

  const reserved = new Map();
  for (const d of state.drones) {
    if (d.state === 'toPickup' && d.targetId != null) reserved.set(d.targetId, (reserved.get(d.targetId) || 0) + droneCap(state));
  }

  const step = BALANCE.drone.speed * dt;
  const byId = new Map(state.structures.map((s) => [s.id, s]));
  state.logisticsBlocked = false;

  for (const d of state.drones) {
    const hub = hubs.get(d.hubId);
    if (d.wait > 0) { d.wait -= dt; continue; }
    if (isInactive(hub) && d.cargo.amount <= 0) {
      d.state = 'grounded';
      moveToward(d, hub.x + 0.5, hub.y + 0.5, step);
      continue;
    }
    if (d.state === 'grounded') d.state = 'idle';

    if (d.state === 'idle') {
      if (d.cargo.amount > 0) { d.state = 'toDeposit'; continue; }
      const job = findJob(state, d, hub, reserved);
      if (job) {
        d.state = 'toPickup';
        d.targetId = job.id;
        reserved.set(job.id, (reserved.get(job.id) || 0) + droneCap(state));
      } else {
        moveToward(d, hub.x + 0.5, hub.y + 0.5, step);
      }
    } else if (d.state === 'toPickup') {
      const t = byId.get(d.targetId);
      if (!t) { d.state = 'idle'; d.targetId = null; continue; }
      if (moveToward(d, t.x + 0.5, t.y + 0.5, step)) {
        const take = Math.min(droneCap(state), t.buffer.amount);
        t.buffer.amount -= take;
        d.cargo = { type: t.buffer.type, amount: take };
        d.targetId = null;
        d.state = take > 0 ? 'toDeposit' : 'idle';
        d.wait = BALANCE.drone.handlingSec;
      }
    } else if (d.state === 'toDeposit' || d.state === 'blocked') {
      const depot = nearestDepot(state, d.x, d.y);
      if (!depot) continue;
      if (moveToward(d, depot.x + 0.5, depot.y + 0.5, step)) {
        const added = addResource(state, d.cargo.type, d.cargo.amount);
        if (added > 0) {
          state.stats.droneDelivered += added;
          recordDelivery(state, added, dt);
        }
        d.cargo.amount -= added;
        if (d.cargo.amount <= 1e-6) {
          d.cargo = { type: null, amount: 0 };
          d.state = 'idle';
          d.wait = BALANCE.drone.handlingSec;
        } else {
          d.state = 'blocked';
          state.logisticsBlocked = true;
        }
      }
    }
  }
}
