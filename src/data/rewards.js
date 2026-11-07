// Optional reward placements (GDD §28). Data-driven so placements can be tuned or disabled
// without touching gameplay code.
//
// LegitLoot policy constraints (Business Model §5, §6, §14.7) are encoded in REWARD_POLICY and
// enforced by RewardGateway: rewards are non-transferable in-game benefits only — never cash,
// never convertible, never required, and never shown as interruptions during combat.
export const REWARD_POLICY = {
  cashRewardsAllowed: false,
  transferable: false,
  convertibleToCash: false,
  interstitialsAllowed: false,
  allowDuringCombat: false,
};

export const REWARD_PLACEMENTS = {
  offline_recovery: {
    label: 'Recover damaged shipment',
    description: 'Send a retrieval drone for extra salvage from while you were away. Your base offline earnings are already yours.',
    benefit: { type: 'offline_bonus', fraction: 0.25 },
    cooldownSec: 0,
    maxPerDay: 5,
    enabled: true,
  },
  wave_salvage: {
    label: 'Extra wave salvage',
    description: 'Dispatch a salvage drone over the battlefield for additional Scrap and Data.',
    benefit: { type: 'wave_salvage', scrapPerWave: 6, dataPerWave: 1 },
    cooldownSec: 300,
    maxPerDay: 10,
    enabled: true,
  },
  emergency_recovery: {
    label: 'Emergency assistance',
    description: 'Recover half of the materials lost when the Core was overwhelmed.',
    benefit: { type: 'recover_lost', fraction: 0.5 },
    cooldownSec: 0,
    maxPerDay: 3,
    enabled: true,
  },
  scanner_boost: {
    label: 'Scanner boost',
    description: 'Reveal a wide area of the sector around your Operator.',
    benefit: { type: 'reveal', radius: 16 },
    cooldownSec: 600,
    maxPerDay: 6,
    enabled: true,
  },
};
