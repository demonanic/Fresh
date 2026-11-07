import { createNewGame, build, revealCircle } from '../src/core/state.js';
import { stepGame } from '../src/sim/step.js';

export function newGame(seed = 1234) {
  const s = createNewGame(seed, 0);
  revealCircle(s, s.sector.core.x, s.sector.core.y, 60);
  return s;
}

export function run(state, seconds, input, dt = 1 / 30) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { stepGame(state, dt, input); state.events.length = 0; }
}

export function nearestNodes(state, type, count) {
  const c = state.sector.core;
  return state.sector.nodes
    .filter((n) => n.type === type)
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
    .slice(0, count);
}

/** Find a free, non-node tile near (x, y). */
export function freeTile(state, x, y) {
  for (let r = 1; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (state.sector.nodes.some((n) => n.x === tx && n.y === ty)) continue;
        if (state.structures.some((s) => (s.type === 'core' ? Math.abs(s.x - tx) <= 1 && Math.abs(s.y - ty) <= 1 : s.x === tx && s.y === ty))) continue;
        if (tx < 1 || ty < 1 || tx >= state.sector.w - 1 || ty >= state.sector.h - 1) continue;
        return { x: tx, y: ty };
      }
    }
  }
  return null;
}

export function buildNear(state, type, x, y) {
  const t = freeTile(state, x, y);
  return build(state, type, t.x, t.y);
}
