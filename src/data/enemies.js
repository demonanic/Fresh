// Enemy archetypes. `target` selects targeting behaviour:
//   nearest        -> closest structure
//   defense        -> closest turret or the Core
//   infrastructure -> closest extractor / generator / drone hub / refinery
export const ENEMIES = {
  crawler: {
    name: 'Crawler', hp: 30, armor: 0, speed: 1.25, damage: 6, attackRate: 1, range: 0.7,
    cost: 2, minWave: 1, group: 1, target: 'nearest', radius: 0.32,
    drops: { data: 1, scrap: 2 }, color: '#FF2A5F',
  },
  swarm: {
    name: 'Swarm Unit', hp: 10, armor: 0, speed: 2.3, damage: 2.5, attackRate: 1.5, range: 0.6,
    cost: 2, minWave: 1, group: 3, target: 'nearest', radius: 0.2,
    drops: { data: 0.3 }, color: '#E879F9',
  },
  saboteur: {
    name: 'Saboteur', hp: 24, armor: 0, speed: 1.7, damage: 12, attackRate: 1, range: 0.7,
    cost: 3, minWave: 2, group: 1, target: 'infrastructure', radius: 0.28,
    drops: { data: 2 }, color: '#FFE600',
  },
  bruiser: {
    name: 'Bruiser', hp: 160, armor: 3, speed: 0.6, damage: 22, attackRate: 0.7, range: 0.9,
    cost: 7, minWave: 3, group: 1, target: 'defense', radius: 0.5,
    drops: { data: 4, scrap: 8 }, color: '#FF6600',
  },
};

export const INFRASTRUCTURE_TYPES = ['extractor', 'generator', 'drone_hub', 'refinery'];
export const DEFENSE_TYPES = ['turret', 'scatter_turret', 'core'];
