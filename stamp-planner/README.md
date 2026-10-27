# IdleOn Stamp Upgrade Planner

A single-page tool for [Legends of IdleOn](https://www.legendsofidleon.com/) that shows which stamp upgrades you can actually do: the material cost of each stamp's next max-level upgrade, checked against the most any one of your characters can carry of that material.

**Live page:** https://rokadrol-haufi.github.io/IdleOn-Blunder-Bench/stamp-planner/

## What it shows

- **Carry capacity alert** – the carry capacity stamps (Lil' Mining Baggy, Choppin' Bag, Matty Bag, Bag o Heads, Bugsack, Mason Jar) whose next upgrade still fits in a character's inventory with a Gilded Stamp and Hydrogen at 90%. Out-of-reach ones are hidden; the alert disappears once all six are out of reach.
- **Upgrade planner** – every stamp, sorted by how much of the carrier's capacity the upgrade uses ("% to Max"). Switch between Hydrogen today / daily (70%) / every 2 days (90%), with or without a Gilded Stamp.
- Material type, amount in storage and shortfall, best carrier, tiers still in reach, coins to the next tier and coins until out of reach (shown as in-game coins).
- Exalted stamps, priority flags (★) pinned to the top, filters and sorting.

## Using it

1. Export your account from [IdleonToolbox](https://idleontoolbox.com/) as JSON.
2. Import it once on the site's [Account page](../account/); the planner reads it from there.

Everything runs in your browser. The save is never uploaded; the save, the calculated result and your priority flags are kept in your browser's storage.

## How it works

`engine.js` is [IdleonToolbox](https://github.com/Morta1/IdleonToolbox)'s own save parser and stamp/carry-capacity code, bundled for the browser, plus a small entry point (`src/engine-entry.js`) that evaluates every stamp for each Hydrogen/Gilded scenario. Costs therefore match the Toolbox stamps page.

- Material cost: `baseMatCost × powMatBase^((round(level / step) − 1)^0.8)`, × 0.05 with a Gilded Stamp, × (1 − Hydrogen %), with sigil, Meritocracy and vial discounts.
- Hydrogen: atom level × bonus per day since the last material upgrade, capped at 90%.
- Carry capacity: inventory slots × per-slot capacity for the material type (hard cap 2.05B per slot), best character.

## Building

Requires Node 20+, Python 3 and git.

```bash
stamp-planner/scripts/build.sh            # uses the pinned IdleonToolbox commit
stamp-planner/scripts/build.sh <commit>   # or build against another Toolbox commit
```

This clones IdleonToolbox into `.build/`, bundles `engine.js` with esbuild and assembles `index.html` from `src/page-head.html` and `src/page-body.html`, inlining the stamp, material and coin icons. Rebuild after a game update once the Toolbox has caught up.

## Credits and licence

- Game data, formulas and parser: [IdleonToolbox](https://github.com/Morta1/IdleonToolbox) by Morta1 (GPL-3.0).
- Game icons belong to Lavaflame2 / Legends of IdleOn.

Because `engine.js` bundles IdleonToolbox code, this project is licensed under the GNU GPL v3.0 as well (see `LICENSE` in the repo root).
