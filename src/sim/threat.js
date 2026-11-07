import { BALANCE } from '../data/balance.js';
import { has, log, emit } from '../core/state.js';
import { spawnWave } from './combat.js';

// Threat emerges from activity: extraction, network footprint, and mitigation.
export function footprint(state) {
  return state.structures.filter((s) => s.type !== 'core').length;
}

export function threatRate(state) {
  const T = BALANCE.threat;
  const extraction = state.threat.extraction || 0;
  const dampen = has(state, 't_dampening') ? 0.7 : 1;
  return T.base + T.perExtraction * extraction * dampen + T.perStructure * footprint(state);
}

export function waveThreshold(state) {
  const T = BALANCE.threat;
  return T.waveAtBase + T.waveAtPerWave * Math.min(state.threat.wave, T.waveAtMaxWaves);
}

export function waveBudget(state) {
  const T = BALANCE.threat;
  return T.budgetBase
    + T.budgetPerWave * Math.min(state.threat.wave, T.budgetMaxWaves)
    + T.budgetPerStructure * footprint(state)
    + T.budgetPerExtraction * (state.threat.extraction || 0);
}

/** Seconds until the next attack at the current rate (Infinity during an attack). */
export function etaNextWave(state) {
  if (state.threat.waveActive) return Infinity;
  const rate = threatRate(state);
  return Math.max(0, (waveThreshold(state) - state.threat.meter) / rate);
}

export function updateThreat(state, dt) {
  const t = state.threat;
  t.rate = threatRate(state);
  if (t.waveActive) {
    if (state.enemies.length === 0) {
      t.waveActive = false;
      state.stats.wavesSurvived++;
      log(state, `Attack ${t.wave} repelled`, 'good');
      emit(state, 'waveCleared', { wave: t.wave });
    }
    return;
  }
  t.meter += t.rate * dt;
  if (t.meter >= waveThreshold(state)) {
    t.meter = 0;
    t.wave++;
    const n = spawnWave(state);
    t.waveActive = n > 0;
    log(state, `ATTACK ${t.wave} INCOMING — ${n} hostiles`, 'bad');
    emit(state, 'waveStarted', { wave: t.wave, count: n });
  }
}
