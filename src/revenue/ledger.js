// Append-only reward ledger (Business Model §10).
// - Every provider event has a unique id; duplicates never grant twice.
// - Entries are never edited or deleted; a reversal is a new entry.
// - Reversals never create player debt (§8): benefits already applied are absorbed by the platform.
export class RewardLedger {
  constructor(entries = []) {
    this.entries = entries; // shared by reference with the save state
    this.ids = new Set(entries.map((e) => e.id));
  }

  has(id) { return this.ids.has(id); }

  /** @returns {{ok:boolean, duplicate?:boolean, entry?:object, reason?:string}} */
  append(entry) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) return { ok: false, reason: 'Missing event id' };
    if (this.ids.has(entry.id)) return { ok: false, duplicate: true, reason: 'Duplicate event' };
    const e = Object.freeze({ ...entry });
    this.entries.push(e);
    this.ids.add(e.id);
    return { ok: true, entry: e };
  }

  grant({ eventId, placementId, providerId, at, benefit }) {
    return this.append({ id: eventId, kind: 'grant', placementId, providerId, at, benefit, wallet: 'game', cashValue: 0 });
  }

  reverse(eventId, at, reason = 'provider_reversal') {
    const original = this.entries.find((e) => e.id === eventId && e.kind === 'grant');
    if (!original) return { ok: false, reason: 'Unknown grant' };
    return this.append({
      id: `rev:${eventId}`, kind: 'reversal', of: eventId, at, reason,
      // Policy: no clawback from the player; loss recorded against the platform.
      playerDebt: 0, absorbedBy: 'platform',
    });
  }

  isReversed(eventId) { return this.ids.has(`rev:${eventId}`); }

  grants(placementId) {
    return this.entries.filter((e) => e.kind === 'grant' && (!placementId || e.placementId === placementId));
  }
}
