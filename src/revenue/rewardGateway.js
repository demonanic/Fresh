import { REWARD_POLICY } from '../data/rewards.js';
import { RewardLedger } from './ledger.js';

// GDD §27: gameplay talks only to the Reward Gateway, never to an ad/IAP SDK directly.
//
//   GAME -> RewardGateway -> { MockRewardProvider | future ad provider | platform reward | ... }
//
// Provider interface:
//   id: string
//   isReady(placementId): boolean
//   show({ placementId }): Promise<{ completed: boolean, eventId?: string, error?: string }>
//
// Guarantees:
// - The game is complete without any provider (requests resolve as 'unavailable').
// - Provider failures never mutate game state.
// - Event ids are deduplicated through the append-only ledger.
// - Circuit breaker pauses all placements after repeated provider errors or on demand.
// - Rewards are non-transferable in-game benefits only; cash is never offered.

const DAY = (ms) => new Date(ms).toISOString().slice(0, 10);

export class RewardGateway {
  constructor({ placements, providers = [], clock = () => Date.now(), maxConsecutiveErrors = 3 } = {}) {
    this.placements = placements;
    this.providers = providers;
    this.clock = clock;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
    this.consecutiveErrors = 0;
    this.paused = null;
    this.inFlight = false;
    this.listeners = new Set();
    for (const [id, p] of Object.entries(placements)) {
      if (p.benefit && (p.benefit.cash || p.benefit.type === 'cash')) {
        throw new Error(`Placement ${id} offers cash, which REWARD_POLICY forbids`);
      }
    }
    if (REWARD_POLICY.cashRewardsAllowed) throw new Error('Cash rewards must stay disabled in-game');
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  /** Circuit breaker (Business Model §9). */
  pause(reason) { this.paused = reason || 'paused'; this.emit({ type: 'paused', reason: this.paused }); }
  resume() { this.paused = null; this.consecutiveErrors = 0; }

  provider(placementId) {
    return this.providers.find((p) => p.isReady(placementId)) || null;
  }

  /** Whether a placement can be offered right now. Pure check; no side effects. */
  availability(placementId, mstate, ctx = {}) {
    const p = this.placements[placementId];
    if (!p) return { ok: false, reason: 'unknown_placement' };
    if (!p.enabled) return { ok: false, reason: 'disabled' };
    if (this.paused) return { ok: false, reason: 'paused' };
    if (ctx.inCombat && !REWARD_POLICY.allowDuringCombat) return { ok: false, reason: 'in_combat' };
    const now = this.clock();
    const last = mstate.lastAt[placementId] || 0;
    if (p.cooldownSec && now - last < p.cooldownSec * 1000) {
      return { ok: false, reason: 'cooldown', remainingSec: Math.ceil((p.cooldownSec * 1000 - (now - last)) / 1000) };
    }
    const day = DAY(now);
    const count = mstate.daily.day === day ? (mstate.daily.counts[placementId] || 0) : 0;
    if (p.maxPerDay && count >= p.maxPerDay) return { ok: false, reason: 'daily_cap' };
    if (!this.provider(placementId)) return { ok: false, reason: 'no_provider' };
    return { ok: true };
  }

  /** Record that an offer was displayed (for the anti-"made for ads" metrics, GDD §31). */
  noteOfferShown(mstate) {
    mstate.analytics.offersShown++;
    mstate.analytics.lastOfferAt = this.clock();
  }

  noteRefused(mstate) { mstate.analytics.refused++; }

  /**
   * Run the reward flow. `apply(benefit)` mutates game state and is called at most once,
   * only after a verified, non-duplicate completion.
   */
  async request(placementId, mstate, apply, ctx = {}) {
    const avail = this.availability(placementId, mstate, ctx);
    if (!avail.ok) {
      mstate.analytics.unavailable++;
      return { status: 'unavailable', reason: avail.reason, remainingSec: avail.remainingSec };
    }
    if (this.inFlight) return { status: 'unavailable', reason: 'busy' };
    const placement = this.placements[placementId];
    const provider = this.provider(placementId);
    this.inFlight = true;
    let result;
    try {
      result = await provider.show({ placementId, label: placement.label, description: placement.description });
    } catch (err) {
      result = { completed: false, error: String((err && err.message) || err) };
    } finally {
      this.inFlight = false;
    }

    if (result && result.error) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) this.pause('provider_errors');
      return { status: 'error', reason: result.error };
    }
    this.consecutiveErrors = 0;
    if (!result || !result.completed) {
      mstate.analytics.refused++;
      return { status: 'cancelled' };
    }

    const ledger = new RewardLedger(mstate.ledger);
    const now = this.clock();
    const rec = ledger.grant({ eventId: result.eventId, placementId, providerId: provider.id, at: now, benefit: placement.benefit });
    if (!rec.ok) return { status: rec.duplicate ? 'duplicate' : 'error', reason: rec.reason };

    const day = DAY(now);
    if (mstate.daily.day !== day) mstate.daily = { day, counts: {} };
    mstate.daily.counts[placementId] = (mstate.daily.counts[placementId] || 0) + 1;
    mstate.lastAt[placementId] = now;
    mstate.analytics.accepted++;
    const applied = apply ? apply(placement.benefit) : null;
    this.emit({ type: 'granted', placementId, eventId: result.eventId });
    return { status: 'granted', eventId: result.eventId, applied };
  }
}
