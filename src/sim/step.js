import { updatePower, updateEconomy, updateDeliveryRate } from './economy.js';
import { updateLogistics } from './logistics.js';
import { updatePlayer, NO_INPUT } from './player.js';
import { updateEnemies, updateTurrets, updateProjectiles } from './combat.js';
import { updateThreat } from './threat.js';
import { updateResearch } from './research.js';
import { updateMissions } from './missions.js';

/** Advance the active simulation by dt seconds. */
export function stepGame(state, dt, input = NO_INPUT) {
  updatePower(state, dt);
  updateEconomy(state, dt);
  updateLogistics(state, dt);
  updatePlayer(state, dt, input);
  updateTurrets(state, dt);
  updateEnemies(state, dt);
  updateProjectiles(state, dt);
  updateThreat(state, dt);
  updateResearch(state, dt);
  updateMissions(state);
  updateDeliveryRate(state, dt);
  state.stats.playTime += dt;
  state.time += dt;
}
