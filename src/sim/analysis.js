import { BUILDINGS } from '../data/buildings.js';
import { isDisrupted, storageCap, dist, maxHp } from '../core/state.js';
import { bufferCap, extractorPotential } from './economy.js';
import { coveredExtractors, droneCap } from './logistics.js';
import { BALANCE } from '../data/balance.js';

// Diagnostics that teach optimization: "why is my production slow?"

export function hubsCovering(state, s) {
  return state.structures.filter((h) => h.type === 'drone_hub' && dist(h.x, h.y, s.x, s.y) <= BUILDINGS.drone_hub.range);
}

export function diagnose(state, s) {
  const out = [];
  if (s.paused) out.push({ level: 'info', text: 'PAUSED by operator — drawing no power' });
  if (isDisrupted(s)) out.push({ level: 'bad', text: 'DISRUPTED — repair above 25% integrity to restore operation' });
  else if (s.hp < maxHp(s) * 0.6) out.push({ level: 'warn', text: 'Damaged' });
  const def = BUILDINGS[s.type];
  if (def.power < 0 && state.power.ratio < 0.999 && s.status === 'LOW POWER') {
    out.push({ level: 'warn', text: `POWER SHORTAGE — running at ${Math.round(state.power.ratio * 100)}%` });
  }
  if (s.type === 'extractor') {
    if (s.status === 'DEPLETED') out.push({ level: 'bad', text: 'Deposit depleted — deconstruct and relocate' });
    if (s.status === 'FULL') {
      const hubs = hubsCovering(state, s);
      if (!hubs.length) out.push({ level: 'bad', text: 'LOGISTICS BOTTLENECK — buffer full, no Drone Hub in range' });
      else out.push({ level: 'bad', text: 'LOGISTICS BOTTLENECK — drones cannot keep up (upgrade hub or add one)' });
    }
  }
  if (s.type === 'refinery') {
    if (s.status === 'RESERVE HOLD') out.push({ level: 'warn', text: 'Holding — keeps 40 Scrap in reserve for construction' });
    if (s.status === 'NO INPUT') out.push({ level: 'warn', text: 'INPUT STARVED — needs 5 Scrap per cycle' });
    if (s.status === 'OUTPUT FULL') out.push({ level: 'bad', text: 'OUTPUT BLOCKED — Component storage full' });
  }
  if (s.type === 'drone_hub') {
    const covered = coveredExtractors(state, s);
    if (!covered.length) out.push({ level: 'warn', text: 'No extractors in range' });
  }
  if (state.logisticsBlocked && (s.type === 'drone_hub' || def.depot)) {
    out.push({ level: 'bad', text: 'STORAGE FULL — drones are waiting to unload' });
  }
  return out;
}

/** Estimated transport capacity (units/min) of one hub, given its current routes. */
export function hubThroughput(state, hub) {
  const covered = coveredExtractors(state, hub);
  if (!covered.length) return 0;
  const drones = state.drones.filter((d) => d.hubId === hub.id).length;
  let avgCycle = 0;
  for (const e of covered) {
    const depot = nearestDepotTo(state, e);
    const d = depot ? dist(e.x, e.y, depot.x, depot.y) : 10;
    avgCycle += (2 * d) / BALANCE.drone.speed + 2 * BALANCE.drone.handlingSec;
  }
  avgCycle /= covered.length;
  return (drones * droneCap(state) * 60) / Math.max(1, avgCycle);
}

function nearestDepotTo(state, s) {
  let best = null;
  let bd = Infinity;
  for (const d of state.structures) {
    if (!BUILDINGS[d.type].depot) continue;
    const dd = dist(s.x, s.y, d.x, d.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

export function networkReport(state) {
  const r = state.stats.rates;
  const cap = storageCap(state);
  const issues = [];
  const extractors = state.structures.filter((s) => s.type === 'extractor');
  const full = extractors.filter((s) => s.status === 'FULL');
  const uncovered = full.filter((s) => !hubsCovering(state, s).length);
  if (uncovered.length) issues.push(`${uncovered.length} extractor(s) full with no drone coverage: ${uncovered.map((s) => s.label).join(', ')}`);
  if (full.length - uncovered.length > 0) issues.push(`${full.length - uncovered.length} extractor(s) full — drones too slow`);
  if (state.power.ratio < 0.999) issues.push(`Power deficit: ${state.power.production.toFixed(1)} produced vs ${state.power.consumption.toFixed(1)} demand`);
  for (const res of ['scrap', 'components', 'data']) if (state.resources[res] >= cap - 0.5) issues.push(`${res} storage FULL (${cap}) — build Storage`);
  const disrupted = state.structures.filter(isDisrupted);
  if (disrupted.length) issues.push(`Disrupted: ${disrupted.map((s) => s.label).join(', ')}`);
  const depleted = extractors.filter((s) => s.status === 'DEPLETED');
  if (depleted.length) issues.push(`Depleted deposits: ${depleted.map((s) => s.label).join(', ')}`);
  const potential = extractors.reduce((a, s) => a + extractorPotential(state, s) * 60, 0);
  const buffered = extractors.reduce((a, s) => a + s.buffer.amount, 0);
  const bufferMax = extractors.reduce((a, s) => a + bufferCap(s), 0);
  const throughput = state.structures.filter((s) => s.type === 'drone_hub').reduce((a, h) => a + hubThroughput(state, h), 0);
  return {
    potential, actual: r.extractionActual, delivered: r.delivered, components: r.components,
    throughput, buffered, bufferMax, cap, issues,
    drones: state.drones.length,
  };
}
