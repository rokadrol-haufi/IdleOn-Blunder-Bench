import './polyfills';
import { parseData } from '@parsers/index';
import { evaluateStamp, getGoldCostToMaxLevel, getStampsPerDay, getExaltedStampBonus } from '@parsers/world-1/stamps';
import { items, monsterDrops } from '@website-data';
import { getSigilBonus, getVialsBonusByEffect } from '@parsers/world-2/alchemy';
import { getMeritocracyBonus } from '@parsers/world-2/voteBallot';
import { getHighestCapacityCharacter } from '@parsers/misc';

// Max carry per item type, every character compared. force = IdleonToolbox's forceMaxCapacity: Ruck Sack on,
// no Zerg Rushogen curse, every unlocked carry star sign plus the Silkrode Nanochip.
// Types with the same capacities are merged. "Everybody" when all characters reach the top value,
// otherwise the first character that does.
const CARRY_TYPES = [
  ['Materials', 'bCraft'], ['Ore, Bars, Oil', 'bOre'], ['Logs, Leaves', 'bLog'], ['Fish', 'dFish'],
  ['Bugs', 'dBugs'], ['Critters', 'dCritters'], ['Souls', 'dSouls'], ['Food', 'cFood'],
  ['Quest items, Statues, Stones', 'dQuest'],
];
const carriers = (account, chars, force) => {
  const rows = CARRY_TYPES.map(([label, typeGen]) => {
    const caps = chars.map(c => getHighestCapacityCharacter({ typeGen }, [c], account, force)?.maxCapacity ?? 0);
    const cap = Math.max(...caps);
    const at = caps.map((v, i) => (v === cap ? chars[i].name : null)).filter(Boolean);
    return { label, cap, who: at.length === chars.length ? '' : at[0], all: at.length === chars.length, n: at.length, caps: caps.join() };
  });
  const merged = [];
  rows.forEach(r => {
    const m = merged.find(x => x.caps === r.caps);
    if (m) m.label += ', ' + r.label; else merged.push({ ...r });
  });
  return merged.map(({ caps, ...r }) => r);
};

// Rare drops: crafting materials whose best source is a regular mob with under 1% drop chance
// (chests excluded), e.g. Glass Shard from Sandy Pot. These are farmed with candy.
const RARE_DROP_CHANCE = 0.01;
const bestMobChance = (() => {
  const best = {};
  Object.values(monsterDrops || {}).forEach((drops) => (drops || []).forEach((dr) => {
    const mob = String(dr?.monsterDisplayName ?? '');
    if (!dr?.rawName || mob.includes('Chest')) return;
    const ch = dr.effectiveChance ?? dr.chance ?? 0;
    best[dr.rawName] = Math.max(best[dr.rawName] ?? 0, ch);
  }));
  return best;
})();
// World 7 mob drops can't be farmed with candy, so they get their own category.
const isWorld7Drop = (rawName) => /^w7[A-Z]/.test(String(rawName ?? ''));
const isRareDrop = (rawName) => items?.[rawName]?.typeGen === 'bCraft' && !isWorld7Drop(rawName)
  && bestMobChance[rawName] > 0 && bestMobChance[rawName] < RARE_DROP_CHANCE;
// Material categories that the item type alone doesn't tell apart.
const SHOP_ITEMS = new Set(['CraftMat3']); // Cue Tape
const materialCategory = (rawName) => {
  if (/^Spelunking\d+$/.test(String(rawName ?? ''))) return 'Spelunking Chapter';
  if (SHOP_ITEMS.has(rawName)) return 'Shop Item';
  if (isWorld7Drop(rawName)) return 'W7 Drop (no candy)';
  if (isRareDrop(rawName)) return 'Rare Drop';
  return null;
};

const CARRY = ['StampB4', 'StampB6', 'StampB8', 'StampB21', 'StampB23', 'StampC2'];
// 'g70' is "Gilded + one day of Hydrogen" (atom level × bonus per day, max 90%); the key stays for saved page state.
const scenarios = (hNow) => [
  ['now', false, 0], ['h70', false, 70], ['h90', false, 90],
  ['g', true, 0], ['g70', true, hNow], ['g90', true, 90],
];
// Material cost before the Gilded Stamp, Hydrogen and the vial (IdleonToolbox getMaterialCost), so the
// page can apply any custom Gilded / Hydrogen choice itself: see matCost() in page-body.html.
const costFactors = (account) => {
  const vial = getVialsBonusByEffect(account?.alchemy?.vials, 'material_cost_for_stamps');
  const sigil = getSigilBonus(account?.alchemy?.p2w?.sigils, 'ENVELOPE_PILE') ?? 0;
  const mb = account?.voteBallot?.meritocracyBonuses?.[14];
  const merit = { bonus: mb?.value != null ? mb.value * (account?.voteBallot?.meritocracyMult ?? 1) : 0, active: !!mb?.selected,
    value: mb?.value ?? 0, mult: account?.voteBallot?.meritocracyMult ?? 1 };
  return {
    base: (1 / (1 + getMeritocracyBonus(account, 14) / 100)) * (1 / (1 + sigil / 100)),
    vr: Math.max(0.1, 1 - vial / 100),
    merit,
    // extra factor if the Stamp cost Meritocracy wins (1 when it is already active)
    mf: mb?.selected ? 1 : 1 / (1 + (mb?.value ?? 0) * (account?.voteBallot?.meritocracyMult ?? 1) / 100),
  };
};
// Same as the page's matCost(): Gilded, Hydrogen and the vial applied to a pre-reduction cost.
const matCostFrom = (pre, gilded, h, vr) => {
  const c = pre * (gilded ? 0.05 : 1) * Math.max(0.1, 1 - h / 100);
  return Math.floor(Math.max(1, c > 2e9 ? c * vr : Math.floor(Math.floor(c) * vr)));
};
const preCost = (level, s, base) => s.baseMatCost * base
  * Math.pow(s.powMatBase, Math.pow(Math.max(0, Math.round(level / s.reqItemMultiplicationLevel) - 1), 0.8));

const allStamps = (account) => Object.values(account.stamps || {}).flat();
const clean = (s) => String(s ?? '').replace(/_/g, ' ').replace(/[{}]/g, '').trim();

const evalAt = (stamp, account, characters, level, gilded, red, force = false) => {
  const ev = evaluateStamp({ ...stamp, level }, account, characters, gilded, red, force, false);
  return { cost: ev.materialCost, cap: ev.bestCharacter?.maxCapacity, who: ev.bestCharacter?.character };
};

const tiersReachable = (stamp, account, characters, gilded, red) => {
  // Returns how many material tiers still fit and the total material those tiers need.
  let n = 0, mats = 0, lvl = Math.max(stamp.level, stamp.maxLevel);
  while (n < 200) {
    const { cost, cap } = evalAt(stamp, account, characters, lvl, gilded, red);
    if (!(cost <= cap)) break;
    n++; mats += cost; lvl += stamp.reqItemMultiplicationLevel;
  }
  return { n, mats };
};

const runSim = (account, characters) => {
  const saved = allStamps(account).map(s => [s, s.level, s.maxLevel]);
  const steps = [];
  try {
    for (let i = 0; i < 400; i++) {
      const cands = allStamps(account).filter(s => CARRY.includes(s.rawName) && s.level > 0).map(s => {
        const r = evalAt(s, account, characters, s.level, true, 90);
        return { s, ...r, ratio: r.cost / r.cap };
      }).filter(c => c.cost <= c.cap).sort((a, b) => a.ratio - b.ratio);
      if (!cands.length) break;
      const c = cands[0];
      const from = c.s.level;
      c.s.level += c.s.reqItemMultiplicationLevel;
      c.s.maxLevel = Math.max(c.s.maxLevel, c.s.level);
      steps.push({ rawName: c.s.rawName, name: clean(c.s.displayName ?? c.s.name), from, to: c.s.level, cost: c.cost, cap: c.cap, carrier: c.who });
    }
  } finally {
    saved.forEach(([s, l, m]) => { s.level = l; s.maxLevel = m; });
  }
  return { steps };
};

export const compute = (input) => {
  let raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof raw?.data === 'string') raw = { ...raw, data: JSON.parse(raw.data) };
  const data = raw?.data ?? raw;
  if (!data || !(data.StampLv || data.StampLevel)) {
    throw new Error('No stamp data found. Use the JSON export from IdleonToolbox (it has "data" and "charNames" at the top level).');
  }
  const { account, characters } = parseData(data, raw.charNames ?? [], raw.companion ?? null, raw.guildData ?? null, raw.serverVars, raw.accountCreateTime);
  if (!characters?.length) throw new Error('No characters found in this file. Check that "charNames" is included in the export.');
  const h = account?.atoms?.atoms?.[0];
  const exaltedSet = new Set();
  Object.entries(account.stamps || {}).forEach(([tree, list]) => (list || []).forEach((st, idx) => {
    if (account?.compass?.exaltedStamps?.[tree]?.[idx]) exaltedSet.add(st.rawName);
  }));
  const cf = costFactors(account);
  const SCEN = scenarios(Math.min(90, Math.max(0, (account?.atoms?.atoms?.[0]?.level ?? 0) * (account?.atoms?.atoms?.[0]?.baseBonus ?? 0))));
  const stamps = allStamps(account).filter(s => s.level > 0).map(s => {
    const cs = {}, rr = {}, gr = {}, mr = {};
    let cap = 0, w = '';
    const top = Math.max(s.level, s.maxLevel);
    for (const [k, g, r] of SCEN) {
      const e = evalAt(s, account, characters, s.level, g, r);
      cs[k] = e.cost; cap = e.cap; w = e.who;
      const { n: t, mats } = tiersReachable(s, account, characters, g, r);
      rr[k] = t; mr[k] = mats;
      gr[k] = getGoldCostToMaxLevel({ ...s, maxLevel: top + t * s.reqItemMultiplicationLevel }, account);
    }
    const fx = evalAt(s, account, characters, s.level, true, 90, true);
    // Custom reduction and the Meritocracy preview: pre-costs of the current tier and of every tier the
    // strongest reduction (Gilded + 90% + Meritocracy) can still reach, plus one, and the coin cost to each.
    const pt = [], gt = [];
    for (let i = 0; i <= 200; i++) {
      const pre = preCost(top + i * s.reqItemMultiplicationLevel, s, cf.base);
      pt.push(pre);
      gt.push(getGoldCostToMaxLevel({ ...s, maxLevel: top + i * s.reqItemMultiplicationLevel }, account));
      if (!(matCostFrom(pre * cf.mf, true, 90, cf.vr) <= Math.max(cap, fx.cap ?? 0))) break;
    }
    const nextTarget = s.level < s.maxLevel ? s.maxLevel : s.level + s.reqItemMultiplicationLevel;
    return {
      r: s.rawName, n: clean(s.displayName ?? s.name), c: s.category, e: clean(s.effect),
      l: s.level, m: s.maxLevel, k: s.reqItemMultiplicationLevel,
      i: clean(s.itemReq?.name), ir: s.itemReq?.rawName, t: items?.[s.itemReq?.rawName]?.typeGen ?? '', rd: isRareDrop(s.itemReq?.rawName), mc: materialCategory(s.itemReq?.rawName), q: (s.materials?.length ?? 0) > 0,
      o: s.ownedMats ?? 0, cap, w, cx: fx.cap ?? cap, wx: fx.who ?? w, cs, p0: preCost(s.level, s, cf.base), pt, gt,
      rg: rr.g90, rh: rr.h90, rr, gr, mr,
      gn: getGoldCostToMaxLevel({ ...s, maxLevel: nextTarget }, account), nt: nextTarget,
      cy: CARRY.includes(s.rawName),
      x: exaltedSet.has(s.rawName),
    };
  });
  return {
    meta: {
      save: raw.savedAt ?? null,
      h: { level: h?.level ?? 0, baseBonus: h?.baseBonus ?? 0, days: account?.accountOptions?.[134] ?? 0, value: account?.atoms?.stampReducer ?? 0 },
      gilded: account?.accountOptions?.[154] ?? 0,
      vr: cf.vr,
      merit: cf.merit,
      nslb: getStampsPerDay(account)?.value ?? 0,
      chars: characters.length,
      money: account?.currencies?.rawMoney ?? 0,
      exaltedMulti: getExaltedStampBonus(account)?.value ?? 0,
      slots: Math.max(...characters.map(c => c.inventorySlots || 0)),
      carriers: carriers(account, characters, false),
      carriersMax: carriers(account, characters, true),
    },
    stamps,
    sim: runSim(account, characters),
  };
};
