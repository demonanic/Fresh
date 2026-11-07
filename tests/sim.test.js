import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSector } from '../src/world/generator.js';
import { build, canPlace, storageCap, getCore } from '../src/core/state.js';
import { updatePower } from '../src/sim/economy.js';
import { startResearch } from '../src/sim/research.js';
import { diagnose, networkReport } from '../src/sim/analysis.js';
import { simulateOffline } from '../src/sim/offline.js';
import { triggerEmergency } from '../src/sim/combat.js';
import { newGame, run, nearestNodes, buildNear } from './helpers.js';

test('sector generation is deterministic per seed', () => {
  assert.deepEqual(generateSector(42), generateSector(42));
  assert.notDeepEqual(generateSector(42).nodes, generateSector(43).nodes);
  const s = generateSector(7);
  assert.ok(s.nodes.some((n) => n.type === 'scrap'));
  assert.ok(s.nodes.some((n) => n.type === 'data'));
});

test('extractors must sit on deposits; other buildings cannot', () => {
  const s = newGame();
  const [node] = nearestNodes(s, 'scrap', 1);
  assert.equal(canPlace(s, 'generator', node.x, node.y).ok, false);
  assert.equal(canPlace(s, 'extractor', node.x, node.y).ok, true);
  assert.equal(canPlace(s, 'drone_hub', node.x + 5, node.y).reason, 'Requires research');
});

test('energy is a flow: deficit drains the reserve, then throttles', () => {
  const s = newGame();
  s.resources.scrap = 1000;
  for (const n of nearestNodes(s, 'scrap', 6)) build(s, 'extractor', n.x, n.y);
  s.energyReserve = 1;
  const p = updatePower(s, 1);
  assert.ok(p.consumption > p.production);
  assert.ok(p.ratio < 1);
  assert.equal(s.energyReserve, 0);
});

test('extractor buffer fills and stalls without logistics — the bottleneck is diagnosed', () => {
  const s = newGame();
  const [node] = nearestNodes(s, 'scrap', 1);
  const ext = build(s, 'extractor', node.x, node.y).structure;
  run(s, 60, { move: { x: 0, y: 0 }, interact: false, fire: false, aim: null });
  // player stands near the Core; extractor may be within pickup range — move player away
  s.player.x = 1; s.player.y = 1;
  run(s, 60);
  assert.equal(ext.status, 'FULL');
  const d = diagnose(s, ext);
  assert.ok(d.some((x) => x.text.includes('no Drone Hub')));
  assert.ok(networkReport(s).issues.length > 0);
});

test('drones carry resources from extractors to the Core', () => {
  const s = newGame();
  s.resources.scrap = 1000;
  s.research.unlocked.push('t_drones');
  for (const n of nearestNodes(s, 'scrap', 2)) build(s, 'extractor', n.x, n.y);
  buildNear(s, 'generator', s.sector.core.x + 3, s.sector.core.y + 3);
  buildNear(s, 'drone_hub', s.sector.core.x - 3, s.sector.core.y);
  s.resources.scrap = 0;
  s.player.x = 1; s.player.y = 1;
  const before = s.stats.droneDelivered;
  run(s, 90);
  assert.ok(s.drones.length >= 2);
  assert.ok(s.stats.droneDelivered > before + 20, `delivered ${s.stats.droneDelivered}`);
});

test('extraction raises threat until an attack spawns, and defenses repel it', () => {
  const s = newGame();
  s.resources.scrap = 1000;
  for (const n of nearestNodes(s, 'scrap', 3)) build(s, 'extractor', n.x, n.y);
  buildNear(s, 'generator', s.sector.core.x + 3, s.sector.core.y + 3);
  for (let i = 0; i < 4; i++) buildNear(s, 'turret', s.sector.core.x + (i % 2 ? 3 : -3), s.sector.core.y + (i < 2 ? 3 : -3));
  const r0 = s.threat.rate;
  run(s, 5);
  assert.ok(s.threat.rate > r0);
  s.threat.meter = 149.9;
  run(s, 1);
  assert.equal(s.threat.wave, 1);
  assert.ok(s.enemies.length > 0);
  run(s, 120);
  assert.equal(s.stats.wavesSurvived, 1);
});

test('research consumes data and unlocks buildings', () => {
  const s = newGame();
  s.resources.scrap = 500;
  s.resources.data = 50;
  buildNear(s, 'research_node', s.sector.core.x + 3, s.sector.core.y);
  buildNear(s, 'generator', s.sector.core.x - 3, s.sector.core.y);
  assert.equal(startResearch(s, 't_cargo').ok, false); // prerequisites
  assert.equal(startResearch(s, 't_drones').ok, true);
  assert.equal(s.resources.data, 42);
  run(s, 25);
  assert.ok(s.research.unlocked.includes('t_drones'));
});

test('core loss triggers emergency recovery instead of game over', () => {
  const s = newGame();
  s.resources.scrap = 100;
  triggerEmergency(s);
  assert.ok(s.emergency);
  assert.equal(s.emergency.lost.scrap, 30);
  assert.ok(getCore(s).hp > 0);
});

test('offline simulation is deterministic and explains bottlenecks', () => {
  const make = () => {
    const s = newGame(99);
    s.resources.scrap = 1000;
    for (const n of nearestNodes(s, 'scrap', 3)) build(s, 'extractor', n.x, n.y);
    buildNear(s, 'generator', s.sector.core.x + 3, s.sector.core.y + 3);
    buildNear(s, 'turret', s.sector.core.x - 3, s.sector.core.y + 3);
    s.resources.scrap = 50;
    return s;
  };
  const a = make();
  const b = make();
  const ra = simulateOffline(a, 3 * 3600);
  const rb = simulateOffline(b, 3 * 3600);
  assert.deepEqual(ra, rb);
  assert.deepEqual(a.resources, b.resources);
  // No drones: extractors fill and stall; report must say why.
  assert.ok(ra.lostProductionPct > 0.5);
  assert.ok(ra.notes.some((n) => n.text.includes('no drone coverage')));
  assert.ok(ra.waves > 0);
});

test('offline drones move resources and respect storage capacity', () => {
  const s = newGame(5);
  s.resources.scrap = 1000;
  s.research.unlocked.push('t_drones');
  for (const n of nearestNodes(s, 'scrap', 3)) build(s, 'extractor', n.x, n.y);
  buildNear(s, 'generator', s.sector.core.x + 3, s.sector.core.y + 3);
  buildNear(s, 'drone_hub', s.sector.core.x - 3, s.sector.core.y);
  s.resources.scrap = 0;
  const r = simulateOffline(s, 2 * 3600);
  assert.ok(r.gains.scrap > 50, `gained ${r.gains.scrap}`);
  assert.ok(s.resources.scrap <= storageCap(s));
});

test('short absences produce no offline report', () => {
  assert.equal(simulateOffline(newGame(), 10), null);
});
