import test from 'node:test';
import assert from 'node:assert/strict';
import { RewardGateway } from '../src/revenue/rewardGateway.js';
import { RewardLedger } from '../src/revenue/ledger.js';
import { MockRewardProvider } from '../src/revenue/mockProvider.js';
import { REWARD_PLACEMENTS, REWARD_POLICY } from '../src/data/rewards.js';
import { newMonetization } from '../src/core/state.js';

const clockAt = (t) => { const c = { t }; c.fn = () => c.t; return c; };

test('policy forbids cash, transfer, conversion, interstitials', () => {
  assert.equal(REWARD_POLICY.cashRewardsAllowed, false);
  assert.equal(REWARD_POLICY.transferable, false);
  assert.equal(REWARD_POLICY.convertibleToCash, false);
  assert.equal(REWARD_POLICY.interstitialsAllowed, false);
  assert.throws(() => new RewardGateway({ placements: { bad: { enabled: true, benefit: { type: 'cash' } } } }));
});

test('game works with no provider: requests are unavailable and state untouched', async () => {
  const gw = new RewardGateway({ placements: REWARD_PLACEMENTS });
  const m = newMonetization();
  let applied = 0;
  const r = await gw.request('scanner_boost', m, () => applied++);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'no_provider');
  assert.equal(applied, 0);
  assert.equal(m.ledger.length, 0);
});

test('completed mock reward is granted exactly once and recorded', async () => {
  const c = clockAt(Date.UTC(2026, 10, 7));
  const gw = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [new MockRewardProvider({ mode: 'auto-complete' })], clock: c.fn });
  const m = newMonetization();
  let applied = 0;
  const r = await gw.request('scanner_boost', m, () => applied++);
  assert.equal(r.status, 'granted');
  assert.equal(applied, 1);
  assert.equal(m.ledger.length, 1);
  assert.equal(m.ledger[0].wallet, 'game');
  assert.equal(m.ledger[0].cashValue, 0);
  // cooldown
  const again = await gw.request('scanner_boost', m, () => applied++);
  assert.equal(again.status, 'unavailable');
  assert.equal(again.reason, 'cooldown');
  c.t += 601 * 1000;
  assert.equal((await gw.request('scanner_boost', m, () => applied++)).status, 'granted');
});

test('duplicate provider event ids never grant twice', async () => {
  const provider = { id: 'dup', isReady: () => true, show: async () => ({ completed: true, eventId: 'evt-1' }) };
  const gw = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [provider] });
  const m = newMonetization();
  let applied = 0;
  assert.equal((await gw.request('offline_recovery', m, () => applied++)).status, 'granted');
  assert.equal((await gw.request('offline_recovery', m, () => applied++)).status, 'duplicate');
  assert.equal(applied, 1);
});

test('cancel and errors do not grant; repeated errors trip the circuit breaker', async () => {
  const m = newMonetization();
  const cancel = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [new MockRewardProvider({ mode: 'auto-cancel' })] });
  assert.equal((await cancel.request('offline_recovery', m, () => assert.fail())).status, 'cancelled');
  const err = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [new MockRewardProvider({ mode: 'auto-error' })] });
  for (let i = 0; i < 3; i++) assert.equal((await err.request('offline_recovery', m, () => assert.fail())).status, 'error');
  assert.equal(err.paused, 'provider_errors');
  assert.equal((await err.request('offline_recovery', m)).reason, 'paused');
  assert.equal(m.ledger.length, 0);
});

test('no reward offers during combat', () => {
  const gw = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [new MockRewardProvider({ mode: 'auto-complete' })] });
  assert.equal(gw.availability('wave_salvage', newMonetization(), { inCombat: true }).reason, 'in_combat');
});

test('daily cap enforced', async () => {
  const c = clockAt(Date.UTC(2026, 10, 7));
  const gw = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [new MockRewardProvider({ mode: 'auto-complete' })], clock: c.fn });
  const m = newMonetization();
  for (let i = 0; i < REWARD_PLACEMENTS.emergency_recovery.maxPerDay; i++) assert.equal((await gw.request('emergency_recovery', m)).status, 'granted');
  assert.equal((await gw.request('emergency_recovery', m)).reason, 'daily_cap');
  c.t += 24 * 3600 * 1000;
  assert.equal((await gw.request('emergency_recovery', m)).status, 'granted');
});

test('ledger is append-only and reversals create no player debt', () => {
  const entries = [];
  const l = new RewardLedger(entries);
  assert.equal(l.grant({ eventId: 'a', placementId: 'p', providerId: 'x', at: 1, benefit: {} }).ok, true);
  assert.equal(l.grant({ eventId: 'a', placementId: 'p', providerId: 'x', at: 2, benefit: {} }).duplicate, true);
  const rev = l.reverse('a', 3);
  assert.equal(rev.ok, true);
  assert.equal(rev.entry.playerDebt, 0);
  assert.equal(l.reverse('a', 4).duplicate, true);
  assert.equal(entries.length, 2);
  assert.throws(() => { entries[0].id = 'z'; });
});
