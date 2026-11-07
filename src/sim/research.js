import { BUILDINGS } from '../data/buildings.js';
import { RESEARCH_BY_ID } from '../data/research.js';
import {
  has, isInactive, canAfford, pay, addResource, log, emit,
} from '../core/state.js';

export function labs(state) {
  return state.structures.filter((s) => s.type === 'research_node');
}

export function researchStatus(state, id) {
  if (has(state, id)) return 'unlocked';
  if (state.research.current === id) return 'current';
  const tech = RESEARCH_BY_ID[id];
  return tech.requires.every((r) => has(state, r)) ? 'available' : 'locked';
}

export function canStartResearch(state, id) {
  const tech = RESEARCH_BY_ID[id];
  if (!tech) return { ok: false, reason: 'Unknown technology' };
  const st = researchStatus(state, id);
  if (st === 'unlocked') return { ok: false, reason: 'Already researched' };
  if (st === 'current') return { ok: false, reason: 'In progress' };
  if (st === 'locked') return { ok: false, reason: 'Prerequisites missing' };
  if (state.research.current) return { ok: false, reason: 'Another project is running' };
  if (!labs(state).length) return { ok: false, reason: 'Build a Research Node' };
  if (!canAfford(state, tech.cost)) return { ok: false, reason: 'Not enough resources' };
  return { ok: true };
}

export function startResearch(state, id) {
  const check = canStartResearch(state, id);
  if (!check.ok) return check;
  pay(state, RESEARCH_BY_ID[id].cost);
  state.research.current = id;
  state.research.progress = 0;
  log(state, `Research started: ${RESEARCH_BY_ID[id].name}`);
  return { ok: true };
}

export function cancelResearch(state) {
  const id = state.research.current;
  if (!id) return { ok: false };
  for (const [r, v] of Object.entries(RESEARCH_BY_ID[id].cost)) addResource(state, r, v);
  state.research.current = null;
  state.research.progress = 0;
  return { ok: true };
}

export function researchSpeed(state) {
  const paused = has(state, 't_threat_response') && state.threat.waveActive;
  if (paused) return 0;
  let speed = 0;
  for (const s of labs(state)) if (!isInactive(s)) speed += BUILDINGS.research_node.researchSpeed;
  return speed * state.power.ratio;
}

export function updateResearch(state, dt) {
  const id = state.research.current;
  if (!id) return;
  state.research.progress += researchSpeed(state) * dt;
  const tech = RESEARCH_BY_ID[id];
  if (state.research.progress >= tech.time) {
    state.research.unlocked.push(id);
    state.research.current = null;
    state.research.progress = 0;
    log(state, `TECHNOLOGY ONLINE: ${tech.name}`, 'good');
    emit(state, 'researched', { id });
  }
}
