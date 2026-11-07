import { BUILDINGS } from '../data/buildings.js';
import { BALANCE } from '../data/balance.js';
import {
  has, isDisrupted, isInactive, levelMult, canAfford, pay, storageCap, dist, maxHp, emit,
} from '../core/state.js';

export function bufferCap(s) {
  return BUILDINGS[s.type].buffer * levelMult(s);
}

export function extractorPotential(state, s) {
  const node = state.sector.nodes.find((n) => n.id === s.nodeId);
  if (!node || node.amount <= 0) return 0;
  return BUILDINGS.extractor.rate * levelMult(s) * node.richness;
}

function pausedByPolicy(state, s) {
  return has(state, 't_threat_response') && state.threat.waveActive
    && (s.type === 'refinery' || s.type === 'research_node');
}

export function powerOf(state, s) {
  const def = BUILDINGS[s.type];
  if (!def.power || isInactive(s)) return { prod: 0, cons: 0 };
  if (def.power > 0) {
    let p = def.power * (s.type === 'core' ? 1 : levelMult(s));
    if (s.type === 'generator' && has(state, 't_overclock')) p *= 1.4;
    return { prod: p, cons: 0 };
  }
  if (s.type === 'extractor') {
    const full = s.buffer.amount >= bufferCap(s) - 1e-6;
    const depleted = extractorPotential(state, s) <= 0;
    if ((full && has(state, 't_throttle')) || depleted) return { prod: 0, cons: 0 };
  }
  if (pausedByPolicy(state, s)) return { prod: 0, cons: 0 };
  return { prod: 0, cons: -def.power };
}

/** Energy is a flow: production minus consumption, buffered by the Core's reserve. */
export function updatePower(state, dt) {
  let production = 0;
  let consumption = 0;
  for (const s of state.structures) {
    const p = powerOf(state, s);
    production += p.prod;
    consumption += p.cons;
  }
  const net = production - consumption;
  let ratio = 1;
  if (net >= 0) {
    state.energyReserve = Math.min(BALANCE.core.energyCap, state.energyReserve + net * dt);
  } else {
    const need = -net * dt;
    if (state.energyReserve >= need) {
      state.energyReserve -= need;
    } else {
      const covered = state.energyReserve;
      state.energyReserve = 0;
      ratio = consumption > 0 ? Math.min(1, (production + covered / Math.max(dt, 1e-6)) / consumption) : 1;
    }
  }
  state.power = { production, consumption, net, ratio };
  return state.power;
}

function ema(prev, value, dt) {
  return prev + (value - prev) * Math.min(1, dt / BALANCE.rateWindowSec);
}

export function updateEconomy(state, dt) {
  const ratio = state.power.ratio;
  let potentialSum = 0;
  let actualSum = 0;
  let active = 0;
  let componentsMade = 0;
  const scrapFull = state.resources.scrap >= storageCap(state) * 0.9;

  for (const s of state.structures) {
    const def = BUILDINGS[s.type];
    if (s.type === 'extractor') {
      const node = state.sector.nodes.find((n) => n.id === s.nodeId);
      if (!node || node.amount <= 0) { s.status = 'DEPLETED'; continue; }
      const potential = extractorPotential(state, s);
      potentialSum += potential;
      if (isDisrupted(s)) { s.status = 'DISRUPTED'; continue; }
      if (s.paused) { s.status = 'PAUSED'; continue; }
      const space = bufferCap(s) - s.buffer.amount;
      const amt = Math.max(0, Math.min(potential * ratio * dt, space, node.amount));
      s.buffer.amount += amt;
      node.amount -= amt;
      actualSum += amt / dt;
      if (space <= 1e-6) s.status = 'FULL';
      else if (ratio < 0.999) { s.status = 'LOW POWER'; active++; } else { s.status = 'OK'; active++; }
    } else if (s.type === 'refinery') {
      if (isDisrupted(s)) { s.status = 'DISRUPTED'; continue; }
      if (s.paused || pausedByPolicy(state, s)) { s.status = 'PAUSED'; continue; }
      const r = def.recipe;
      if (!s.craft) {
        const reserve = BALANCE.refineryReserveScrap;
        if (state.resources.scrap >= r.in.scrap + reserve && canAfford(state, r.in)) {
          pay(state, r.in); s.craft = { t: 0, done: false };
        } else { s.status = canAfford(state, r.in) ? 'RESERVE HOLD' : 'NO INPUT'; continue; }
      }
      if (s.craft.done) {
        const fits = Object.entries(r.out).every(([res, v]) => storageCap(state) - state.resources[res] >= v);
        if (fits) {
          for (const [res, v] of Object.entries(r.out)) state.resources[res] += v;
          componentsMade += r.out.components || 0;
          s.craft = null;
          s.status = 'OK';
        } else {
          s.status = 'OUTPUT FULL';
        }
        continue;
      }
      const speed = levelMult(s) * (has(state, 't_autonomy') && scrapFull ? 2 : 1);
      s.craft.t += dt * ratio * speed;
      if (s.craft.t >= r.time) s.craft.done = true;
      s.status = ratio < 0.999 ? 'LOW POWER' : (speed > levelMult(s) ? 'SURPLUS MODE' : 'OK');
    } else if (s.type === 'repair_station') {
      if (isDisrupted(s)) { s.status = 'DISRUPTED'; continue; }
      if (s.paused) { s.status = 'PAUSED'; continue; }
      let healing = false;
      for (const t of state.structures) {
        if (t.hp >= maxHp(t)) continue;
        if (dist(s.x, s.y, t.x, t.y) > def.range) continue;
        t.hp = Math.min(maxHp(t), t.hp + def.heal * ratio * dt);
        healing = true;
      }
      s.status = healing ? 'REPAIRING' : 'OK';
    } else if (s.type === 'generator' || s.type === 'storage' || s.type === 'drone_hub' || s.type === 'research_node'
      || s.type === 'turret' || s.type === 'scatter_turret') {
      s.status = isDisrupted(s) ? 'DISRUPTED' : s.paused ? 'PAUSED' : (def.power < 0 && ratio < 0.999 ? 'LOW POWER' : 'OK');
    }
  }

  if (componentsMade) {
    state.stats.componentsProduced += componentsMade;
    emit(state, 'produced', { res: 'components', amount: componentsMade });
  }
  state.threat.extraction = actualSum;
  state.threat.activeExtractors = active;
  const r = state.stats.rates;
  r.extractionPotential = ema(r.extractionPotential, potentialSum * 60, dt);
  r.extractionActual = ema(r.extractionActual, actualSum * 60, dt);
  r.components = ema(r.components, (componentsMade / dt) * 60, dt);
  state.stats.powerOkStreak = state.power.ratio >= 0.999 ? state.stats.powerOkStreak + dt : 0;
}

export function recordDelivery(state, amount, dt) {
  state._deliveredThisTick = (state._deliveredThisTick || 0) + amount;
  return dt;
}

export function updateDeliveryRate(state, dt) {
  const d = state._deliveredThisTick || 0;
  state._deliveredThisTick = 0;
  state.stats.rates.delivered = ema(state.stats.rates.delivered, (d / dt) * 60, dt);
}
