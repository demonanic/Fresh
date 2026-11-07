// Global balance configuration. Tune numbers here, not in system code.
// Units: positions in tiles, time in seconds, rates per second.
export const BALANCE = {
  sector: { w: 56, h: 36 },
  core: { storageCap: 200, energyCap: 150 },
  player: {
    speed: 4.2,
    hp: 100,
    regen: 3,
    carryCap: 12,
    mineRate: { scrap: 3, data: 0.6 },
    gunDamage: 6,
    fireRate: 4,
    gunRange: 7,
    projectileSpeed: 14,
    repairRate: 14, // hp per second
    repairCostPerHp: 0.08, // scrap per hp repaired
    pickupRange: 1.5,
    depositRange: 2.0,
    interactRange: 1.6,
    respawnSec: 3,
    revealRadius: 6,
  },
  threat: {
    base: 0.12,
    perExtraction: 0.35, // per unit/sec actually being extracted
    perStructure: 0.015,
    waveAtBase: 150,
    waveAtPerWave: 20,
    waveAtMaxWaves: 20,
    budgetBase: 4,
    budgetPerWave: 1.5,
    budgetMaxWaves: 25,
    budgetPerStructure: 0.3,
    budgetPerExtraction: 1.5,
  },
  disruptedBelow: 0.25, // structure stops working below this hp fraction
  refineryReserveScrap: 40, // refineries leave this much Scrap for construction
  salvageOnDestroy: 0.5,
  deconstructRefund: 0.75,
  emergencyLoss: 0.3, // fraction of scrap/components lost when the Core is overwhelmed
  drone: { speed: 3.2, cap: 10, pickupMin: 4, handlingSec: 0.4 },
  offline: {
    stepSec: 60,
    maxSec: 8 * 3600,
    minSec: 60,
    engageSec: 15, // seconds of defensive fire assumed per resolved wave
    hpPerBudget: 15,
    threatMult: 0.5, // unattended networks run a lower signature
  },
  sim: { tickSec: 1 / 30 },
  autosaveSec: 30,
  rateWindowSec: 60, // smoothing window for production rates
};
