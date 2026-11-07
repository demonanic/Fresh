import { BUILDINGS } from '../data/buildings.js';
import { BALANCE } from '../data/balance.js';
import { generateSector } from '../world/generator.js';

export const SAVE_VERSION = 1;
export const RESOURCES = ['scrap', 'components', 'data'];

export function newStats() {
  return {
    manualDeposited: 0,
    droneDelivered: 0,
    componentsProduced: 0,
    enemiesKilled: 0,
    wavesSurvived: 0,
    structuresBuilt: 0,
    structuresLost: 0,
    powerOkStreak: 0,
    overflowLost: 0,
    playTime: 0,
    // Rolling per-minute rates (exponential moving averages).
    rates: { extractionPotential: 0, extractionActual: 0, delivered: 0, components: 0 },
  };
}

export function newMonetization() {
  return {
    ledger: [],
    lastAt: {},
    daily: { day: '', counts: {} },
    analytics: { sessions: 0, offersShown: 0, accepted: 0, refused: 0, unavailable: 0, exitsAfterOffer: 0, lastOfferAt: 0 },
  };
}

export function createNewGame(seed = ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0), now = Date.now()) {
  const sector = generateSector(seed);
  const state = {
    version: SAVE_VERSION,
    seed,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    time: 0,
    createdAt: now,
    lastActiveAt: now,
    sector,
    fog: new Array(sector.w * sector.h).fill(0),
    player: {
      x: sector.core.x + 0.5, y: sector.core.y + 2.6, hp: BALANCE.player.hp,
      carry: { type: null, amount: 0 }, fireCd: 0, respawn: 0, aim: 0, action: null,
    },
    resources: { scrap: 120, components: 0, data: 0 },
    energyReserve: 50,
    power: { production: 0, consumption: 0, ratio: 1, net: 0 },
    structures: [],
    drones: [],
    enemies: [],
    projectiles: [],
    threat: { meter: 0, wave: 0, rate: 0, waveActive: false, waveEnemies: 0 },
    research: { unlocked: [], current: null, progress: 0 },
    missions: { index: 0, completed: [] },
    stats: newStats(),
    monetization: newMonetization(),
    emergency: null,
    labelCounters: {},
    nextId: 1,
    log: [],
    events: [],
  };
  addStructure(state, 'core', sector.core.x, sector.core.y);
  revealCircle(state, sector.core.x + 0.5, sector.core.y + 0.5, BUILDINGS.core.reveal);
  revealCircle(state, state.player.x, state.player.y, BALANCE.player.revealRadius);
  return state;
}

export function nextId(state) { return state.nextId++; }

export function emit(state, type, payload = {}) {
  state.events.push({ type, ...payload });
}

export function log(state, text, kind = 'info') {
  state.log.push({ t: state.time, text, kind });
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  emit(state, 'log', { text, kind });
}

export function has(state, techId) { return state.research.unlocked.includes(techId); }

export function center(s) { return { x: s.x + 0.5, y: s.y + 0.5 }; }

export function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

export function levelMult(s) {
  const up = BUILDINGS[s.type].upgrade;
  return 1 + (up && up.statMult ? up.statMult * (s.level - 1) : 0);
}

export function isDisrupted(s) {
  return s.hp < BUILDINGS[s.type].hp * BALANCE.disruptedBelow;
}

export function maxHp(s) { return BUILDINGS[s.type].hp; }

/** Not operating: disrupted by damage, or paused by the player. */
export function isInactive(s) { return !!s.paused || isDisrupted(s); }

/** Structures the player may pause to redirect power. */
export function isPausable(s) { return s.type !== 'core' && (BUILDINGS[s.type].power || 0) < 0; }

export function storageCap(state) {
  let cap = BALANCE.core.storageCap;
  for (const s of state.structures) if (s.type === 'storage') cap += BUILDINGS.storage.storageCap;
  return cap;
}

/** Add to the shared inventory, respecting capacity. Returns the amount actually added. */
export function addResource(state, res, amount) {
  if (amount <= 0) return 0;
  const cap = storageCap(state);
  const space = Math.max(0, cap - state.resources[res]);
  const added = Math.min(space, amount);
  state.resources[res] += added;
  return added;
}

export function canAfford(state, cost) {
  return Object.entries(cost).every(([r, v]) => state.resources[r] >= v - 1e-9);
}

export function pay(state, cost) {
  if (!canAfford(state, cost)) return false;
  for (const [r, v] of Object.entries(cost)) state.resources[r] -= v;
  return true;
}

export function scaleCost(cost, mult) {
  return Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, Math.ceil(v * mult)]));
}

export function nodeAt(state, x, y) {
  return state.sector.nodes.find((n) => n.x === x && n.y === y) || null;
}

export function structureAt(state, x, y) {
  return state.structures.find((s) => {
    if (s.type === 'core') return Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1;
    return s.x === x && s.y === y;
  }) || null;
}

export function isRevealed(state, x, y) {
  const { w, h } = state.sector;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return state.fog[y * w + x] === 1;
}

export function revealCircle(state, cx, cy, r) {
  const { w, h } = state.sector;
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) state.fog[y * w + x] = 1;
    }
  }
}

export function canPlace(state, type, x, y) {
  const def = BUILDINGS[type];
  if (!def || def.buildable === false) return { ok: false, reason: 'Not buildable' };
  if (def.requires && !has(state, def.requires)) return { ok: false, reason: 'Requires research' };
  const { w, h } = state.sector;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return { ok: false, reason: 'Out of bounds' };
  if (!isRevealed(state, x, y)) return { ok: false, reason: 'Unexplored' };
  if (structureAt(state, x, y)) return { ok: false, reason: 'Occupied' };
  const node = nodeAt(state, x, y);
  if (def.needsNode) {
    if (!node) return { ok: false, reason: 'Must be built on a deposit' };
    if (node.amount <= 0) return { ok: false, reason: 'Deposit depleted' };
  } else if (node) {
    return { ok: false, reason: 'Deposit tiles are for Extractors' };
  }
  if (!canAfford(state, def.cost)) return { ok: false, reason: 'Not enough resources' };
  return { ok: true };
}

function nextLabel(state, type) {
  const prefix = BUILDINGS[type].prefix;
  const n = (state.labelCounters[prefix] || 0) + 1;
  state.labelCounters[prefix] = n;
  return type === 'core' ? 'CORE' : `${prefix}-${String(n).padStart(2, '0')}`;
}

export function addStructure(state, type, x, y) {
  const def = BUILDINGS[type];
  const s = {
    id: nextId(state), type, x, y, hp: def.hp, level: 1, label: nextLabel(state, type),
    buffer: def.buffer ? { type: null, amount: 0 } : null,
    nodeId: null, craft: null, cd: 0, status: '',
  };
  if (def.needsNode) {
    const node = nodeAt(state, x, y);
    s.nodeId = node ? node.id : null;
    s.buffer.type = node ? node.type : null;
  }
  state.structures.push(s);
  return s;
}

export function build(state, type, x, y) {
  const check = canPlace(state, type, x, y);
  if (!check.ok) return check;
  pay(state, BUILDINGS[type].cost);
  const s = addStructure(state, type, x, y);
  revealCircle(state, x + 0.5, y + 0.5, BUILDINGS[type].reveal || 3);
  state.stats.structuresBuilt++;
  emit(state, 'built', { id: s.id, structureType: type });
  return { ok: true, structure: s };
}

export function upgradeCost(s) {
  const up = BUILDINGS[s.type].upgrade;
  if (!up || s.level >= up.maxLevel) return null;
  return scaleCost(up.cost, Math.pow(up.costScale, s.level - 1));
}

export function upgrade(state, s) {
  const cost = upgradeCost(s);
  if (!cost) return { ok: false, reason: 'Max level' };
  if (!pay(state, cost)) return { ok: false, reason: 'Not enough resources' };
  const frac = s.hp / maxHp(s);
  s.level++;
  s.hp = maxHp(s) * frac;
  emit(state, 'upgraded', { id: s.id });
  return { ok: true };
}

/** Player-initiated deconstruction: partial refund, buffer contents returned. */
export function deconstruct(state, s) {
  if (s.type === 'core') return { ok: false, reason: 'The Core cannot be removed' };
  const refund = scaleCost(BUILDINGS[s.type].cost, BALANCE.deconstructRefund);
  for (const [r, v] of Object.entries(refund)) addResource(state, r, Math.floor(v));
  if (s.buffer && s.buffer.amount > 0) addResource(state, s.buffer.type, s.buffer.amount);
  removeStructure(state, s);
  return { ok: true };
}

export function removeStructure(state, s) {
  const i = state.structures.indexOf(s);
  if (i >= 0) state.structures.splice(i, 1);
  emit(state, 'removed', { id: s.id });
}

export function getCore(state) { return state.structures.find((s) => s.type === 'core'); }

export function depots(state) { return state.structures.filter((s) => BUILDINGS[s.type].depot); }

export function nearestDepot(state, x, y) {
  let best = null;
  let bd = Infinity;
  for (const s of depots(state)) {
    const d = dist(x, y, s.x + 0.5, s.y + 0.5);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
