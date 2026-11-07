import { addResource, revealCircle } from '../core/state.js';

// Game-side application of reward benefits. Benefits are in-game only and non-transferable.
export function applyBenefit(state, benefit, ctx = {}) {
  switch (benefit.type) {
    case 'offline_bonus': {
      const report = ctx.report;
      if (!report) return null;
      const got = {};
      for (const r of ['scrap', 'components', 'data']) {
        const g = Math.max(0, report.gains[r] || 0) * benefit.fraction;
        got[r] = Math.floor(addResource(state, r, Math.ceil(g)));
      }
      return got;
    }
    case 'wave_salvage': {
      const wave = ctx.wave || state.threat.wave || 1;
      return {
        scrap: Math.floor(addResource(state, 'scrap', benefit.scrapPerWave * wave)),
        data: Math.floor(addResource(state, 'data', benefit.dataPerWave * wave)),
      };
    }
    case 'recover_lost': {
      const em = state.emergency;
      if (!em || em.recovered) return null;
      const got = {};
      for (const [r, v] of Object.entries(em.lost)) got[r] = Math.floor(addResource(state, r, Math.floor(v * benefit.fraction)));
      em.recovered = true;
      return got;
    }
    case 'reveal': {
      revealCircle(state, state.player.x, state.player.y, benefit.radius);
      return { revealed: benefit.radius };
    }
    default:
      return null;
  }
}
