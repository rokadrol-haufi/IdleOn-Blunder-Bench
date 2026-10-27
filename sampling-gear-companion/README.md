# Sampling and Gear Companion

Compares your 3D Printer sampling characters with the top public samplers for Copper (Mining), Oak Logs (Chopping), Flies (Catching) and Goldfish (Fishing).

- Every efficiency source from IdleonToolbox's efficiency formulas, grouped (skill multipliers, skill power, all-skill efficiency, post offices, base efficiency) and ranked by how much your efficiency would rise if that one source matched the best top sampler.
- Expandable details: what feeds each source, monument, statue and Dragon statue, vials, meals, golden food carry cap, Right Hand of Action, star signs.
- Best-in-slot setups per skill with hover tooltips, and the fishing spots table.

Build: `scripts/build.sh` (see the root README). No save is embedded; the page reads the save imported on the site's Account page and caches the analysis per save.

The theoretical best-in-slot board of each activity tab is precomputed so it shows instantly, even before a save is imported: `node scripts/act-bis.cjs .build/bundle.js <save.json> data/act-bis.json`, then `scripts/build.sh` again. It is worked out on the highest-level character of the activity's best class in that save; only the class and level are kept, no names.
