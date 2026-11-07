import { MISSIONS } from '../data/missions.js';
import { has, addResource, log, emit } from '../core/state.js';

export function currentMission(state) {
  return MISSIONS[state.missions.index] || null;
}

export function missionProgress(state, m) {
  switch (m.kind) {
    case 'stat': return { value: state.stats[m.key] || 0, target: m.target };
    case 'build': return { value: state.structures.filter((s) => s.type === m.type).length, target: m.count };
    case 'research': return { value: has(state, m.tech) ? 1 : 0, target: 1 };
    case 'waves': return { value: state.stats.wavesSurvived, target: m.target };
    case 'activeExtractors': return { value: state.threat.activeExtractors || 0, target: m.target };
    default: return { value: 0, target: 1 };
  }
}

export function updateMissions(state) {
  const m = currentMission(state);
  if (!m) return;
  const p = missionProgress(state, m);
  if (p.value >= p.target) {
    for (const [r, v] of Object.entries(m.reward || {})) addResource(state, r, v);
    state.missions.completed.push(m.id);
    state.missions.index++;
    const rewardText = Object.entries(m.reward || {}).map(([r, v]) => `+${v} ${r}`).join(' ');
    log(state, `OBJECTIVE COMPLETE: ${m.text} ${rewardText}`, 'good');
    emit(state, 'mission', { id: m.id });
  }
}
