# HARVEST//ZERO

> Explore a hostile machine world, build increasingly sophisticated resource networks, defend them against the consequences of your own expansion, and automate every problem you once had to solve manually.

Automation strategy / tower defense / idle RPG for **mobile web and Android** (landscape), published under the **LegitLoot** brand. This repository contains the **v0.1 MVP** described in GDD §39: one biome (Scrapyard), one procedural sector, four resources, the core building set, four enemy archetypes, research, saving and offline simulation. Monetization runs only through a mock provider.

Visual identity: neon synthwave, using the palette and fonts shared with the studio's other games (Gauntlet's Survival / Demonanic): `#0a0b10` base, cyan `#00F3FF`, magenta `#F02DCA`, neon green `#39FF14`, yellow `#FFE600`, orange `#FF6600`, purple `#A855F7`, hot red `#FF2A5F`. Fonts are Unbounded, JetBrains Mono and Chivo.

## Run it

```bash
npm start        # http://localhost:5173  (zero dependencies, Node 18+)
npm test         # simulation, save and reward-gateway tests (node:test)
npm run build    # copies the game into dist/ (Capacitor webDir)
```

Android packaging uses the same Capacitor setup as Gauntlet's Survival (`capacitor.config.json`, appId `com.buzzfuzz.harvestzero`). Installing Capacitor and generating the `android/` project are left as an explicit step, so no new tooling or accounts get pulled in without approval:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npm run build && npx cap add android && npx cap sync android
```

## Controls

| | Touch | Keyboard / mouse |
|---|---|---|
| Move | drag left half | WASD / arrows |
| Aim & fire | drag right half | mouse aim, hold click or Space |
| Mine / repair | hold **MINE** button | hold E |
| Build | **BUILD** → card → tap tile | B, 1–9, click tile |
| Select building | tap it | click it |
| Network / research | NET / R&D | N / R |

## What's in the MVP

- **Core loop:** scout (fog of war) → claim deposits → extract → power → transport → process → defend → research → expand.
- **Resources:** Scrap, Energy (a flow with a reserve, not a hoard), Components (Scrap + Energy at a Refinery), Data (from ruins and enemy kills).
- **Buildings (10):** Core, Extractor, Generator, Storage, Refinery, Research Node, Pulse Turret, Scatter Turret, Drone Hub, Repair Station. Most can be upgraded, recycled, or paused to redirect power.
- **Logistics:** resources physically travel. Extractors fill local buffers; you or drones carry them to the Core/Storage. Capacity ≠ output. The building panel and the **NET** screen diagnose bottlenecks: full buffers without drone coverage, drones that can't keep up, power deficits, full storage, depleted deposits.
- **Automation progression:** Tier 0 manual mining and carrying → extractors → drones → processing → maintenance → policies (Threat Response, Surplus Policy).
- **Threat:** no wave timer. Threat rises with extraction and network footprint, falls with Signal Dampening. Attack size scales with what you've built.
- **Enemies:** Crawler, Swarm, Saboteur (targets infrastructure), Bruiser (armored, targets defenses).
- **Research (11 techs):** mostly rule changes, e.g. Emergency Routing, Smart Throttling, Threat Response, Surplus Policy.
- **Failure creates problems, not punishment:** destroyed structures refund salvage; an overwhelmed Core triggers emergency recovery, never a save wipe.
- **Offline progression:** deterministic 60-second aggregated steps, capped at 8 hours. Transport limits, power, storage, defense strength and repairs all apply. The report explains causes, e.g. "GEN-02 DISRUPTED — attack breached defenses", "EXT-01 stalled — no drone coverage".
- **Systemic soundtrack:** synthesized synthwave/industrial layers (pad → kick → bass arpeggio → snare + distortion) build with threat.
- **Saving:** atomic write via a temp key with read-back verification and checksum, three rotating backups, automatic fallback to a backup when a slot is corrupt. Saves every 30 s, on backgrounding, and on exit.
- **Objectives:** an 11-step onboarding chain plus strategic contracts.

## Architecture

```
src/
  data/       all balance + content as config (buildings, enemies, research, missions, rewards, theme)
  core/       state model, deterministic RNG, save manager
  world/      procedural sector generator
  sim/        economy/power, logistics, player, combat, threat, research, missions,
              analysis (bottleneck diagnosis), offline simulation, step()
  revenue/    RewardGateway, append-only ledger, MockRewardProvider, benefit application
  ui/         canvas renderer, input (twin-stick + keyboard), HUD/panels, audio
tests/        node:test suites
```

The simulation is pure data plus functions, with no DOM access, so it runs headless in tests and offline catch-up. Rebalancing means editing `src/data/*`, not system code.

See [`docs/BUSINESS_ALIGNMENT.md`](docs/BUSINESS_ALIGNMENT.md) for how the game maps onto the LegitLoot business model.

## Not built yet (by design, GDD §38)

Multiplayer, accounts, cloud saves, server economy, real ad/IAP SDKs, additional biomes, sector map / multiple sectors, prestige, factions, daily Operations, expeditions. These follow the version plan in GDD §41 once the MVP loop is validated as fun.
