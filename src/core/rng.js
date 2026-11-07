// Deterministic PRNG (mulberry32). Simulation randomness draws from state.rngState so a
// saved game resumes with the same random sequence.
export function mulberry32Step(s) {
  const next = (s + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { const r = mulberry32Step(this.s); this.s = r.next; return r.value; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

/** Draw from the game state's RNG stream. */
export function rand(state) {
  const r = mulberry32Step(state.rngState >>> 0);
  state.rngState = r.next;
  return r.value;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
