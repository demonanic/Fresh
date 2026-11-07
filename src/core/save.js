import { SAVE_VERSION, newStats, newMonetization } from './state.js';
import { hashString } from './rng.js';

// Transient runtime fields that are never persisted.
const TRANSIENT = ['events', 'projectiles'];

export function serialize(state, now = Date.now()) {
  const data = {};
  for (const [k, v] of Object.entries(state)) if (!TRANSIENT.includes(k)) data[k] = v;
  data.lastActiveAt = now;
  const json = JSON.stringify(data);
  return JSON.stringify({ v: SAVE_VERSION, savedAt: now, checksum: hashString(json), data: json });
}

export function deserialize(blob) {
  const wrapper = JSON.parse(blob);
  if (!wrapper || typeof wrapper.data !== 'string') throw new Error('Malformed save');
  if (hashString(wrapper.data) !== wrapper.checksum) throw new Error('Checksum mismatch');
  const state = migrate(JSON.parse(wrapper.data));
  validate(state);
  return state;
}

function migrate(state) {
  // Future save versions upgrade here, step by step.
  state.events = [];
  state.projectiles = [];
  state.stats = { ...newStats(), ...(state.stats || {}) };
  state.monetization = { ...newMonetization(), ...(state.monetization || {}) };
  return state;
}

function validate(state) {
  const ok = state && state.sector && Array.isArray(state.structures)
    && state.structures.some((s) => s.type === 'core')
    && state.resources && Number.isFinite(state.resources.scrap)
    && Array.isArray(state.fog) && state.fog.length === state.sector.w * state.sector.h;
  if (!ok) throw new Error('Save failed validation');
}

/**
 * Atomic-ish save with backup rotation on top of a Storage-like object
 * (localStorage in the browser, an in-memory map in tests).
 * Write goes to a temp key, is read back and verified, then slots rotate.
 */
export class SaveManager {
  constructor(storage, key = 'harvestzero', slots = 3) {
    this.storage = storage;
    this.key = key;
    this.slots = slots;
  }

  slotKey(i) { return `${this.key}_save_${i}`; }

  save(state, now = Date.now()) {
    const blob = serialize(state, now);
    const tmp = `${this.key}_save_tmp`;
    try {
      this.storage.setItem(tmp, blob);
      if (this.storage.getItem(tmp) !== blob) throw new Error('Verification failed');
      deserialize(blob);
      for (let i = this.slots - 1; i > 0; i--) {
        const prev = this.storage.getItem(this.slotKey(i - 1));
        if (prev != null) this.storage.setItem(this.slotKey(i), prev);
      }
      this.storage.setItem(this.slotKey(0), blob);
      this.storage.removeItem(tmp);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  /** Load the newest valid slot, falling back to older backups if one is corrupt. */
  load() {
    for (let i = 0; i < this.slots; i++) {
      const blob = this.storage.getItem(this.slotKey(i));
      if (blob == null) continue;
      try {
        return { state: deserialize(blob), slot: i };
      } catch {
        // try the next backup
      }
    }
    return null;
  }

  clear() {
    for (let i = 0; i < this.slots; i++) this.storage.removeItem(this.slotKey(i));
    this.storage.removeItem(`${this.key}_save_tmp`);
  }
}

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
