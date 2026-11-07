# HARVEST//ZERO ↔ LegitLoot Business Model (v1.3)

This maps each relevant rule in the LegitLoot Master Business Model to how the game enforces it. Section numbers refer to the Business Model (BM) and the Game Design Document (GDD).

## Status

| Item | State |
|---|---|
| Game MVP (GDD §39) | Implemented, local only |
| Real ad / IAP / offerwall SDK | **Not integrated.** Needs explicit approval (BM §14.8) |
| Revenue validation gates (BM §14.4) | Not started. No provider is approved, so revenue status is `EARNINGS_NOT_VERIFIABLE` |
| Cash wallet | **Not in the game.** Cash lives on the LegitLoot platform, not in HARVEST//ZERO |
| Paid services / subscriptions | None used |

## Rule → enforcement

| Business Model rule | Where it is enforced |
|---|---|
| Cash must not be promised for ad views, clicks, or rewarded-ad engagement (BM §5) | `REWARD_POLICY.cashRewardsAllowed = false`; `RewardGateway` throws if any placement declares a cash benefit; every ledger grant records `wallet: 'game'`, `cashValue: 0`. Test: `policy forbids cash…` |
| Game wallet is non-transferable, non-withdrawable, not convertible (BM §6) | Rewards apply only as in-game effects (`revenue/benefits.js`): resources, reveal, recovery. No currency leaves the save. `REWARD_POLICY.transferable/convertibleToCash = false` |
| Every provider event has a unique id; duplicates never grant twice (BM §10) | `RewardLedger.append` rejects duplicate ids. Test: `duplicate provider event ids never grant twice` |
| Append-only ledger (BM §10) | Ledger entries are frozen and never edited. Reversals are new entries (`rev:<id>`). Test: `ledger is append-only…` |
| Ordinary reversals do not create player debt (BM §8) | `RewardLedger.reverse` records `playerDebt: 0, absorbedBy: 'platform'`; game state is never clawed back |
| Circuit breaker pauses reward commitments on serious problems (BM §9) | `RewardGateway.pause()`; trips automatically after 3 consecutive provider errors. Test: `…trip the circuit breaker` |
| Never trust client balances for financial transactions (BM §10) | The game holds no financial balances. Any future cash-bearing flow must go through the LegitLoot backend, not this client |
| Each revenue channel separately attributable (BM §5, §14.6) | Every grant records `placementId` + `providerId`. Providers plug in behind one adapter interface (`isReady`, `show`) |
| One provider's failure must not corrupt unrelated records (BM §14.6) | Provider errors return before any state mutation; `apply()` runs only after a verified, non-duplicate completion |
| No new integration without approval (BM §14.8) | Only `MockRewardProvider` exists. It is labelled "TEST MODE · SIMULATED SPONSOR — no real ad, no revenue" in the UI |
| Player understands what a reward gives before acting (BM §12) | Each offer states the benefit, that it is optional, and that it is in-game only. The menu includes a plain-language rewards policy |
| Measure with real data, not assumed CPMs (BM §15) | Only interaction analytics are kept locally: sessions, offers shown, accepted, declined, unavailable, exits within 15 s of an offer. No revenue estimates exist in code |

## Design guardrails (GDD §27–31)

- **Game is complete without any provider.** With no provider, every placement reports `no_provider` and nothing else changes. Test: `game works with no provider`.
- **Never monetized:** building, saving, crafting, speed controls (1×/2×/3× are free), progression, required defenses, base offline earnings, inventory.
- **No interstitials, nothing during combat.** `allowDuringCombat: false`. The wave-salvage offer appears only after an attack is cleared, as a dismissible chip that auto-hides after 20 s.
- **Placements (data-driven, `src/data/rewards.js`):** offline recovery (+25% of the gains already awarded), wave salvage, emergency assistance (recover 50% of losses), scanner boost. Each has a cooldown and a daily cap.
- **Anti-"made for ads" metric (GDD §31):** declines and exits-after-offer are recorded so a later review can tell whether refusing offers makes the game worse.

## Next steps that need explicit approval

1. Choose a rewarded-ad provider and confirm its terms allow these placements (non-cash, optional, in-game only).
2. Implement its adapter behind `RewardGateway` (no gameplay changes required).
3. Android packaging via Capacitor and Play Console listing, checking Play policy on rewarded products (GDD note: the old rewarded-products billing flow is no longer supported).
4. Any link between game credits and LegitLoot platform wallets needs legal and provider review first (BM §13) and is **out of scope for this client**.
