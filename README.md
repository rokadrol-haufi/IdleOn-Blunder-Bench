# IdleOn Blunder Bench

Calculators for [Legends of IdleOn](https://www.legendsofidleon.com/), all in one place. Import your [IdleonToolbox](https://idleontoolbox.com/) save once on the Account page and every tool uses it; everything runs in your browser and the save is never uploaded.

**Live site:** https://rokadrol-haufi.github.io/IdleOn-Tools/

| Page | What it does |
| --- | --- |
| [Account](account/) | Import your save (file, drop or paste) once for every tool, see your characters, and pick the Light / Dark / Auto theme. |
| [Sampling and Gear Companion](sampling-gear-companion/) | 3D Printer samples: compares your Mining, Chopping, Catching and Fishing efficiency with the top public samplers, source by source, with best-in-slot setups. |
| [Stamp Upgrade Planner](stamp-planner/) | Which stamp upgrades fit in a character's inventory, with Gilded Stamps and Hydrogen, sorted by how close to the carry cap they are. |

## Layout

```
index.html              landing page
account/                the Account page: the one place to import a save, plus the theme switch
assets/theme.css        shared "Arcade" theme: color tokens (light and dark), fonts, top bar, panels, buttons
assets/site.js          shared script: applies the theme, draws the top bar, stores the save (IndexedDB) and tool caches
assets/classes/         class icons for the Account page
sampling-gear-companion/      index.html, its sources (src/), data snapshot (data/) and build scripts
stamp-planner/          index.html, engine.js, sources (src/) and build scripts
```

Each tool is one page that loads `assets/theme.css` and `assets/site.js`. To rebuild one after a game update:

```bash
sampling-gear-companion/scripts/build.sh   # bundles IdleonToolbox + src/kimgap, assembles index.html
stamp-planner/scripts/build.sh             # bundles engine.js, assembles index.html
```

Both build scripts need Node 20+, Python 3 and git, and clone IdleonToolbox into the tool's `.build/` folder.

### Sampling and Gear Companion data

`sampling-gear-companion/data/bench*.json` is a snapshot of the five best public samplers per printer item from the IdleonToolbox leaderboards (efficiency breakdown leaves, statue, monument, vial and meal details, and the inputs behind each source). `bis.json` holds the best-in-slot boards and `icons.json` the row icons; both can be regenerated with `REBUILD_IMAGES=1 scripts/build.sh`.

## Adding a tool

1. Put it in its own folder with an `index.html` that loads the shared files in `<head>` and has the bar as the first thing in `<body>`:
   ```html
   <link rel="stylesheet" href="../assets/theme.css">
   <script src="../assets/site.js" data-page="mytool"></script>
   …
   <nav id="site-bar"></nav>
   ```
2. Read the save with `await IdleonTools.account.getSave()` (`{id, text, label, lastUpdated, …}` or `null`), and re-run when `IdleonTools.account.onChange(fn)` fires. Cache slow results with `IdleonTools.cache.get/set('mytool', save.id, version, value)`. Never add an import box; link to `../account/` instead.
3. Add it to `PAGES` in `assets/site.js` (the top bar), add a card to the landing page and a row to the table above.

## Credits and licence

- Game data, formulas and parser: [IdleonToolbox](https://github.com/Morta1/IdleonToolbox) by Morta1 (GPL-3.0).
- Best-in-slot setups: taken and updated from AlmostPsycho's Sampling Sheet.
- Game icons belong to Lavaflame2 / Legends of IdleOn.

Because the tools bundle IdleonToolbox code, this project is licensed under the GNU GPL v3.0 (see `LICENSE`).
