import { BALANCE } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import { RESEARCH_BY_ID } from '../data/research.js';
import { rand } from '../core/rng.js';
import {
  has, isDisrupted, isInactive, levelMult, storageCap, dist, maxHp, addResource, depots,
} from '../core/state.js';
import { updatePower, bufferCap, extractorPotential } from './economy.js';
import { coveredExtractors, droneCap, hubDroneCount } from './logistics.js';
import { threatRate, waveThreshold, waveBudget } from './threat.js';
import { INFRASTRUCTURE_TYPES } from '../data/enemies.js';

// Offline progression (GDD §20): aggregated intervals, deterministic, and explainable.
// The network's design matters — transport limits, power, storage and defenses all apply —
// but individual bullets are not simulated.

function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Per-extractor drone transport capacity in units/sec. */
function transportCapacity(state) {
  const cap = new Map();
  const dc = droneCap(state);
  const deps = depots(state);
  for (const hub of state.structures) {
    if (hub.type !== 'drone_hub' || isInactive(hub)) continue;
    const covered = coveredExtractors(state, hub).filter((e) => !isInactive(e) && extractorPotential(state, e) > 0);
    if (!covered.length) continue;
    const drones = state.drones.filter((d) => d.hubId === hub.id).length || hubDroneCount(hub);
    const weights = covered.map((e) => extractorPotential(state, e));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    covered.forEach((e, i) => {
      let dd = Infinity;
      for (const d of deps) dd = Math.min(dd, dist(e.x, e.y, d.x, d.y));
      const cycle = (2 * dd) / BALANCE.drone.speed + 2 * BALANCE.drone.handlingSec;
      const share = drones * (weights[i] / wsum);
      cap.set(e.id, (cap.get(e.id) || 0) + (share * dc) / Math.max(1, cycle));
    });
  }
  return cap;
}

function defensePower(state) {
  const O = BALANCE.offline;
  let dps = 0;
  for (const s of state.structures) {
    const def = BUILDINGS[s.type];
    if (!def.damage || isInactive(s)) continue;
    const ratio = s.type === 'core' ? 1 : state.power.ratio;
    const splashFactor = def.splash ? 2 : 1;
    dps += def.damage * (s.type === 'core' ? 1 : levelMult(s)) * def.fireRate * ratio * splashFactor;
  }
  return dps * O.engageSec;
}

function resolveWave(state, report, elapsed) {
  const O = BALANCE.offline;
  state.threat.wave++;
  report.waves++;
  const attack = waveBudget(state) * O.hpPerBudget;
  const defense = defensePower(state);
  const healthy = state.structures.filter((s) => s.type !== 'core' && !isDisrupted(s));
  if (defense >= attack) {
    report.held++;
    state.stats.wavesSurvived++;
    if (healthy.length) {
      const s = healthy[Math.floor(rand(state) * healthy.length)];
      s.hp = Math.max(maxHp(s) * 0.3, s.hp - maxHp(s) * (0.1 + 0.1 * rand(state)));
    }
    return;
  }
  // Breach: saboteurs go for infrastructure first.
  const infra = healthy.filter((s) => INFRASTRUCTURE_TYPES.includes(s.type));
  const pool = infra.length ? infra : healthy;
  if (!pool.length) return;
  const hits = attack > defense * 2 ? 2 : 1;
  for (let i = 0; i < hits && pool.length; i++) {
    const idx = Math.floor(rand(state) * pool.length);
    const s = pool.splice(idx, 1)[0];
    s.hp = maxHp(s) * 0.2;
    report.disrupted.push({ label: s.label, type: s.type, at: elapsed, cause: `Attack ${state.threat.wave} breached defenses` });
  }
}

/**
 * Simulate `elapsedSec` of absence. Mutates state and returns an explainable report,
 * or null if the absence was too short to matter.
 */
export function simulateOffline(state, elapsedSec) {
  const O = BALANCE.offline;
  if (!(elapsedSec >= O.minSec)) return null;
  const total = Math.min(elapsedSec, O.maxSec);
  const startRes = { ...state.resources };

  // Live entities do not persist across absence; carried drone cargo is delivered.
  state.enemies = [];
  state.projectiles = [];
  state.threat.waveActive = false;
  for (const d of state.drones) {
    if (d.cargo.amount > 0) addResource(state, d.cargo.type, d.cargo.amount);
    d.cargo = { type: null, amount: 0 };
    d.state = 'idle';
    d.targetId = null;
  }

  const report = {
    away: elapsedSec, simulated: total, gains: {}, waves: 0, held: 0, disrupted: [], repaired: [],
    overflow: { scrap: 0, components: 0, data: 0 }, overflowSec: 0, stalledSec: {}, powerShortSec: 0,
    minPowerRatio: 1, researchCompleted: [], idealExtracted: 0, extracted: 0, notes: [],
  };

  let t = 0;
  while (t < total - 1e-6) {
    const dt = Math.min(O.stepSec, total - t);
    const power = updatePower(state, dt);
    if (power.ratio < 0.999) { report.powerShortSec += dt; report.minPowerRatio = Math.min(report.minPowerRatio, power.ratio); }
    const ratio = power.ratio;
    const transport = transportCapacity(state);
    const cap = storageCap(state);
    let extractionRate = 0;
    let overflowedThisStep = false;

    for (const s of state.structures) {
      if (s.type !== 'extractor') continue;
      const node = state.sector.nodes.find((n) => n.id === s.nodeId);
      const potential = extractorPotential(state, s);
      if (!node || potential <= 0) continue;
      if (s.paused) continue;
      report.idealExtracted += Math.min(potential * dt, node.amount);
      if (isDisrupted(s)) continue;
      // Drones move what they can, then the extractor refills its buffer.
      const moveCap = (transport.get(s.id) || 0) * dt;
      const space = bufferCap(s) - s.buffer.amount + moveCap;
      const produced = Math.max(0, Math.min(potential * ratio * dt, space, node.amount));
      node.amount -= produced;
      const available = s.buffer.amount + produced;
      const move = Math.min(available, moveCap);
      s.buffer.amount = Math.min(bufferCap(s), available - move);
      report.extracted += produced;
      extractionRate += produced / dt;
      if (produced < potential * ratio * dt * 0.99) report.stalledSec[s.label] = (report.stalledSec[s.label] || 0) + dt;
      const added = addResource(state, s.buffer.type, move);
      state.stats.droneDelivered += added;
      if (move - added > 1e-6) { report.overflow[s.buffer.type] += move - added; overflowedThisStep = true; }
    }
    state.threat.extraction = extractionRate;
    if (overflowedThisStep) report.overflowSec += dt;

    // Refineries (fractional cycles)
    const scrapFull = state.resources.scrap >= cap * 0.9;
    for (const s of state.structures) {
      if (s.type !== 'refinery' || isInactive(s)) continue;
      const r = BUILDINGS.refinery.recipe;
      const speed = levelMult(s) * (has(state, 't_autonomy') && scrapFull ? 2 : 1);
      const cycles = Math.min(
        (dt * ratio * speed) / r.time,
        Math.max(0, state.resources.scrap - BALANCE.refineryReserveScrap) / r.in.scrap,
        (cap - state.resources.components) / r.out.components,
      );
      if (cycles <= 0) continue;
      state.resources.scrap -= cycles * r.in.scrap;
      state.resources.components += cycles * r.out.components;
      state.stats.componentsProduced += cycles * r.out.components;
    }

    // Repair stations
    for (const s of state.structures) {
      if (s.type !== 'repair_station' || isInactive(s)) continue;
      const def = BUILDINGS.repair_station;
      for (const o of state.structures) {
        if (o.hp >= maxHp(o) || dist(s.x, s.y, o.x, o.y) > def.range) continue;
        const was = isDisrupted(o);
        o.hp = Math.min(maxHp(o), o.hp + def.heal * ratio * dt);
        if (was && !isDisrupted(o)) report.repaired.push({ label: o.label, by: s.label, at: t + dt });
      }
    }

    // Research
    if (state.research.current) {
      const labs = state.structures.filter((s) => s.type === 'research_node' && !isInactive(s)).length;
      state.research.progress += labs * ratio * dt;
      const tech = RESEARCH_BY_ID[state.research.current];
      if (state.research.progress >= tech.time) {
        state.research.unlocked.push(tech.id);
        report.researchCompleted.push(tech.name);
        state.research.current = null;
        state.research.progress = 0;
      }
    }

    // Threat
    state.threat.meter += threatRate(state) * O.threatMult * dt;
    let guard = 0;
    while (state.threat.meter >= waveThreshold(state) && guard++ < 10) {
      state.threat.meter -= waveThreshold(state);
      resolveWave(state, report, t + dt);
    }

    state.time += dt;
    t += dt;
  }

  for (const r of Object.keys(state.resources)) report.gains[r] = state.resources[r] - startRes[r];
  report.lostProductionPct = report.idealExtracted > 0 ? Math.max(0, 1 - report.extracted / report.idealExtracted) : 0;
  report.notes = explain(state, report);
  state.stats.overflowLost += Object.values(report.overflow).reduce((a, b) => a + b, 0);
  return report;
}

function explain(state, report) {
  const notes = [];
  for (const d of report.disrupted) {
    const fix = report.repaired.find((r) => r.label === d.label && r.at >= d.at);
    notes.push({
      level: fix ? 'warn' : 'bad',
      text: `${d.label} DISRUPTED at +${fmtDur(d.at)} — ${d.cause}${fix ? `; restored by ${fix.by} at +${fmtDur(fix.at)}` : ''}`,
    });
    if (d.type === 'generator') notes.push({ level: 'bad', text: `Cause chain: ${d.label} failure reduced network power` });
  }
  if (report.powerShortSec > 0) {
    notes.push({ level: 'warn', text: `Power shortage for ${fmtDur(report.powerShortSec)} (lowest ${Math.round(report.minPowerRatio * 100)}%)` });
  }
  const overflowTotal = Object.values(report.overflow).reduce((a, b) => a + b, 0);
  if (overflowTotal > 0.5) notes.push({ level: 'warn', text: `Storage full for ${fmtDur(report.overflowSec)} — ${Math.round(overflowTotal)} resources could not be stored` });
  const stalled = Object.entries(report.stalledSec).filter(([, s]) => s >= 300).sort((a, b) => b[1] - a[1]);
  for (const [label, sec] of stalled.slice(0, 4)) {
    const s = state.structures.find((x) => x.label === label);
    const covered = s && state.structures.some((h) => h.type === 'drone_hub' && dist(h.x, h.y, s.x, s.y) <= BUILDINGS.drone_hub.range);
    notes.push({ level: 'warn', text: `${label} stalled ${fmtDur(sec)} — ${covered ? 'drones could not keep up' : 'buffer full, no drone coverage'}` });
  }
  if (report.waves) notes.push({ level: report.held === report.waves ? 'good' : 'warn', text: `${report.waves} attack(s): ${report.held} held` });
  for (const name of report.researchCompleted) notes.push({ level: 'good', text: `Research completed: ${name}` });
  if (report.away > report.simulated) notes.push({ level: 'info', text: `Offline progress is capped at ${fmtDur(report.simulated)}` });
  return notes;
}

export { fmtDur };
