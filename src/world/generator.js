import { Rng } from '../core/rng.js';
import { BALANCE } from '../data/balance.js';

// Biome definitions. MVP ships only the Scrapyard; the rest are listed for the sector map.
export const BIOMES = {
  scrapyard: {
    name: 'Scrapyard',
    nearClusters: { scrap: 3, data: 1 },
    farClusters: { scrap: 7, data: 4 },
    clusterSize: { scrap: [3, 6], data: [2, 4] },
    amount: { scrap: [400, 700], data: [120, 200] },
    richness: { scrap: 1, data: 0.25 },
    debris: 70,
  },
};

/**
 * Procedurally generate a sector. Pure function of (seed, biome).
 * Nodes are single deposit tiles; an Extractor is built on top of one.
 */
export function generateSector(seed, biomeId = 'scrapyard') {
  const biome = BIOMES[biomeId];
  const rng = new Rng(seed);
  const { w, h } = BALANCE.sector;
  const core = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const nodes = [];
  const occupied = new Set();
  const key = (x, y) => `${x},${y}`;
  // Keep the Core's 5x5 area clear.
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) occupied.add(key(core.x + dx, core.y + dy));

  let nodeId = 1;
  const placeCluster = (type, minD, maxD) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const d = rng.range(minD, maxD);
      const cx = Math.round(core.x + Math.cos(ang) * d);
      const cy = Math.round(core.y + Math.sin(ang) * d * 0.8);
      if (cx < 2 || cy < 2 || cx >= w - 2 || cy >= h - 2) continue;
      if (occupied.has(key(cx, cy))) continue;
      const [smin, smax] = biome.clusterSize[type];
      const size = rng.int(smin, smax);
      const tiles = [[cx, cy]];
      let guard = 0;
      while (tiles.length < size && guard++ < 50) {
        const [bx, by] = rng.pick(tiles);
        const nx = bx + rng.int(-1, 1);
        const ny = by + rng.int(-1, 1);
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (occupied.has(key(nx, ny)) || tiles.some(([tx, ty]) => tx === nx && ty === ny)) continue;
        tiles.push([nx, ny]);
      }
      const [amin, amax] = biome.amount[type];
      for (const [x, y] of tiles) {
        occupied.add(key(x, y));
        const amount = Math.round(rng.range(amin, amax));
        nodes.push({ id: nodeId++, type, x, y, amount, max: amount, richness: biome.richness[type] });
      }
      return true;
    }
    return false;
  };

  for (let i = 0; i < biome.nearClusters.scrap; i++) placeCluster('scrap', 4, 8);
  for (let i = 0; i < biome.nearClusters.data; i++) placeCluster('data', 7, 10);
  for (let i = 0; i < biome.farClusters.scrap; i++) placeCluster('scrap', 9, 24);
  for (let i = 0; i < biome.farClusters.data; i++) placeCluster('data', 11, 25);

  // Decorative debris (non-blocking) for visual texture.
  const debris = [];
  for (let i = 0; i < biome.debris; i++) {
    const x = rng.int(0, w - 1);
    const y = rng.int(0, h - 1);
    if (occupied.has(key(x, y))) continue;
    debris.push({ x: x + rng.next(), y: y + rng.next(), s: rng.range(0.15, 0.45), r: rng.next() * Math.PI });
  }

  // Enemy spawn points on the sector edges.
  const spawns = [
    { x: 1, y: rng.int(4, h - 5) },
    { x: w - 2, y: rng.int(4, h - 5) },
    { x: rng.int(4, w - 5), y: 1 },
    { x: rng.int(4, w - 5), y: h - 2 },
  ];

  return { id: 'S-01', biome: biomeId, seed, w, h, core, nodes, debris, spawns };
}
