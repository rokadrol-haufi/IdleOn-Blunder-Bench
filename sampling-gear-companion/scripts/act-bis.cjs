// Precomputes the theoretical best-in-slot board of every activity tab and sampling setup (skill and HP / MP
// snapshot), so the page shows it instantly.
// Each activity is worked out on the highest-level character of its best class (ACTIVITIES[k].bestClass;
// highest-level character overall when it has none), with the default map, full min-max and the gallery chip trick.
// Usage: node scripts/act-bis.cjs <bundle.js> <IdleonToolbox save JSON> <out.json>
const fs = require('fs');
global.window = global; global.self = global; global.localStorage = { getItem: () => null, setItem: () => {} };
const [bundle, savePath, out] = process.argv.slice(2);
eval(fs.readFileSync(bundle, 'utf8') + ';global.KimGap=KimGap;');
(async () => {
  const P = KimGap.parseSave(fs.readFileSync(savePath, 'utf8'));
  const byLv = P.characters.slice().sort((a, b) => b.level - a.level);
  const acts = {};
  for (const [key, act] of Object.entries(KimGap.ACTIVITIES)) {
    const want = act.bestClass || [];
    const ref = want.map((cls) => byLv.find((c) => c.class === cls)).find(Boolean) || byLv[0];
    const t = Date.now();
    const r = await KimGap.optimizeLoadout(P, ref.name, key, { bisOnly: true, generic: true, minmax: true, galleryChip: true });
    acts[key] = { cls: r.cls, level: r.level, bestClass: want, map: r.map ? { name: r.map.name, mob: r.map.mob } : null, boards: r.boards.bis };
    console.log(key.padEnd(10), ref.class.padEnd(20), ref.level, Date.now() - t, 'ms');
  }
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), acts }));
  console.log('wrote', out, Math.round(fs.statSync(out).size / 1000), 'KB');
})();
