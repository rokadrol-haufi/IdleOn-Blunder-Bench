import '../polyfills';
import { parseData } from '@parsers/index';
import { getSkillEfficiency } from '@parsers/efficiency';
import { getMaxDamage } from '@parsers/damage';
import { getAfkGain } from '@parsers/character';
import { getClamWorkBonus } from '@parsers/world-7/clamWork';
import { getKillRoyShopBonus, isCompanionBonusActive } from '@parsers/misc';
import { getBubbleBonus } from '@parsers/world-2/alchemy';
import { getCardLevel } from '@parsers/cards';
import { getSushiBonus } from '@parsers/world-7/sushiStation';
import { getPlayerLabChipBonus } from '@parsers/world-4/lab';
import { evaluateBreakdownNode } from '@parsers/breakdown';
import { growth } from '@utility/helpers';
import { getMonumentBonus, getMonumentMultiplier } from '@parsers/world-5/caverns/bravery';
import { getFountainBonusTotal } from '@parsers/world-5/caverns/the-fountain';
import { getCosmoBonus } from '@parsers/world-5/hole';
import { getStatueBonus } from '@parsers/world-1/statues';
import { getVialMultiplier } from '@parsers/world-2/alchemy';
import { getMealBonus, getMealMaxLevel } from '@parsers/world-4/cooking';
import { makeDetails } from './details';
import { makeInputs } from './inputs';
import { getPrayerBonusAndCurse } from '@parsers/world-3/prayers';
import { getCardSets } from '@parsers/cards';
import { calcCardBonus } from '@parsers/cardMath';
import { getItemCapacity, getGoldenFoodMulti, getGoldenFoodBonus } from '@parsers/misc';
import { lavaLog } from '@utility/helpers';
import { getSuperTalentAddedLevels, isBookEligibleTalent } from '@parsers/talents';
import { items as ITEMS } from '@website-data';

// Golden food: what this character's bonus would be with a full food-slot stack (carry cap, or what storage holds).
const GOLDEN = { mining: ['Golden_Peanut', 'PeanutG'], fishing: ['Golden_Ribs', 'FoodG7'] };
const goldenWhatIf = (c, characters, account, skill) => {
  const g = GOLDEN[skill]; if (!g) return null;
  const [name, raw] = g;
  const cap = getItemCapacity('cFood', c, account)?.value ?? null;
  const equipped = (c?.food || []).filter((f) => f?.name === name).reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const storage = (account?.storage?.list || []).filter((x) => x?.rawName === raw || x?.name === name).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  // Everything the account owns: storage, every character's inventory and every character's food slots.
  const holders = (characters || []).map((ch) => ({
    name: ch.name,
    inventory: (ch.inventory || []).filter((i) => i?.rawName === raw).reduce((s, i) => s + (Number(i.amount) || 0), 0),
    food: ch.name === c.name ? 0 : (ch.food || []).filter((f) => f?.name === name).reduce((s, f) => s + (Number(f.amount) || 0), 0),
  })).filter((h) => h.inventory || h.food);
  const elsewhere = holders.reduce((s, h) => s + h.inventory + h.food, 0);
  const owned = equipped + storage + elsewhere;
  const multi = getGoldenFoodMulti(c, account, characters)?.value ?? 1;
  const amount = ITEMS?.[raw]?.Amount ?? 0;
  const part = (q) => (!q ? 0 : amount * multi * 0.05 * lavaLog(1 + q) * (1 + lavaLog(1 + q) / 2.14));
  const current = getGoldenFoodBonus(name, c, account, characters) || 0;
  const stack = cap == null ? owned : Math.min(cap, owned);
  const capped = current - part(equipped) + part(stack);
  return { name, raw, cap, equipped, storage, holders, owned, stack, multi, current, capped, gain: (1 + capped / 100) / (1 + current / 100) };
};
const INPUTS = makeInputs();
const DETAILS = makeDetails({ evaluateBreakdownNode, growth, getMonumentBonus, getMonumentMultiplier, getFountainBonusTotal, getCosmoBonus, getStatueBonus, getVialMultiplier, getMealBonus, getMealMaxLevel });

export const SKILLS = ['mining', 'chopping', 'catching', 'fishing'];
export const STATUE_IDX = { mining: 2, chopping: 6, catching: 9, fishing: 8 };
export const MONUMENT_T = { mining: 0, chopping: 2, catching: 1 };
// Classes that sample each item; the super talent plan is worked out for these (and the best sampler).
const WARRIORS = ['Warrior', 'Barbarian', 'Squire', 'Blood_Berserker', 'Death_Bringer', 'Divine_Knight', 'Royal_Guardian'];
const FAMILY = { mining: WARRIORS, chopping: ['Mage', 'Wizard', 'Shaman', 'Elemental_Sorcerer', 'Bubonic_Conjuror', 'Arcane_Cultist'], catching: ['Archer', 'Bowman', 'Hunter', 'Siege_Breaker', 'Beast_Master', 'Wind_Walker'], fishing: WARRIORS };
export const SAMPLE_ITEMS = { mining: 'Copper', chopping: 'OakTree', catching: 'Bug1', fishing: 'Fish1' };

// Plain JSON copy of a breakdown tree that evaluateBreakdownNode can re-evaluate.
const KEEP = ['name', 'value', 'unit', 'formatted', 'note', 'combine', 'power', 'min', 'max', 'round', 'step'];
export const cleanNode = (n) => {
  if (!n || typeof n !== 'object') return n;
  const out = {};
  for (const k of KEEP) if (n[k] !== undefined && typeof n[k] !== 'function') out[k] = n[k];
  if (Array.isArray(n.children)) out.children = n.children.map(cleanNode);
  return out;
};
export const cleanBreakdown = (b) => b && ({ statName: b.statName, combine: b.combine, min: b.min, max: b.max, round: b.round, step: b.step, tree: (b.tree || []).map(cleanNode) });

// Presets: each character has 2 talent presets and up to 7 card presets. A variant swaps them into the
// character so the efficiency formulas see that loadout. Stats (STR/WIS/AGI) stay as saved: the save only
// has the totals for what is equipped right now.
const flattenTalents = (tabs) => Object.values(tabs || {}).flatMap((x) => x?.orderedTalents || []);
const withLoadout = (c, talentIdx, cardIdx) => {
  let v = c;
  if (talentIdx !== c.selectedTalentPreset && c.talentPreset) {
    v = { ...v, talents: c.talentPreset.talents, flatTalents: flattenTalents(c.talentPreset.flatTalents), flatStarTalents: c.talentPreset.flatStarTalents || c.flatStarTalents };
  }
  if (cardIdx !== c.selectedCardPreset && Array.isArray(c.cardPresets?.[cardIdx])) {
    const cur = c.cards?.equippedCards || [];
    const cards = c.cardPresets[cardIdx].map((card, i) => (card?.cardIndex ? { ...card, chipBoost: cur[i]?.chipBoost, legendBonus: cur[i]?.legendBonus } : card));
    v = { ...v, cards: { ...c.cards, equippedCards: cards } };
  }
  return v;
};
const effOf = (skill, ch, characters, account, pi, orig) => { try { return getSkillEfficiency(skill, ch, ch === orig ? characters : characters.map((x) => (x === orig ? ch : x)), account, pi)?.value; } catch (e) { return null; } };
export const presetCheck = (c, characters, account, skill, pi) => {
  const talentOpts = [c.selectedTalentPreset ?? 0].concat(c.talentPreset ? [(c.selectedTalentPreset ?? 0) === 0 ? 1 : 0] : []);
  const cardOpts = (c.cardPresets || []).map((p, i) => ((p || []).some((x) => x?.cardIndex) ? i : null)).filter((i) => i !== null);
  const curT = c.selectedTalentPreset ?? 0, curC = c.selectedCardPreset ?? 0;
  const base = effOf(skill, c, characters, account, pi, c); if (!base) return null;
  const combos = [];
  for (const ti of talentOpts) for (const ci of (cardOpts.length ? cardOpts : [curC])) {
    const v = effOf(skill, withLoadout(c, ti, ci), characters, account, pi, c);
    if (v) combos.push({ talent: ti, card: ci, ratio: v / base, cards: (ci === curC ? c.cards?.equippedCards : c.cardPresets?.[ci] || []).map((x) => x?.cardIndex || null) });
  }
  combos.sort((a, b) => b.ratio - a.ratio);
  return { current: { talent: curT, card: curC }, best: combos[0], combos };
};

// Sets one talent (class or star) to a level everywhere IdleonToolbox looks for it.
const setTalentLevel = (c, skillIndex, level, statFactor, stat) => {
  const set = (t) => (t?.skillIndex === skillIndex ? { ...t, level } : t);
  const tabs = (obj) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v?.orderedTalents ? { ...v, orderedTalents: v.orderedTalents.map(set) } : v])) : obj);
  const out = { ...c, flatTalents: (c.flatTalents || []).map(set), talents: tabs(c.talents), flatStarTalents: (c.flatStarTalents || []).map(set) };
  if (c.starTalents?.orderedTalents) out.starTalents = { ...c.starTalents, orderedTalents: c.starTalents.orderedTalents.map(set) };
  if (statFactor && stat) out.stats = { ...c.stats, [stat]: (c.stats?.[stat] || 0) * statFactor };
  return out;
};
const g = (t, lv) => { try { return growth(t.funcX, lv, t.x1, t.x2, false); } catch (e) { return null; } };
// The skill-power multiplier node of an efficiency breakdown ("Mining power" = 1 + power / 100).
const powerOf = (b) => {
  let v = null;
  const walk = (n) => { if (!n || v !== null) return; if (/ power$/.test(n.name || '') && typeof n.value === 'number') { v = (n.value - 1) * 100; return; } (n.children || []).forEach(walk); };
  (b?.tree || []).forEach(walk);
  return v;
};
const AFK_KIND = { mining: 'MINING', chopping: 'CHOPPIN', catching: 'CATCHING', fishing: 'FISHING' };
// Efficiency, skill power and AFK gains of a (modified) character. With snapshot set, max HP and MP are
// worked out again for the modified character, so talents that raise them count through the HP / MP bubbles.
// Only Mining (Hearty Diggy, max HP) and Chopping (Hocus Choppus, max MP) use a snapshot.
const SNAP_SKILL = { mining: 'maxHp', chopping: 'maxMp' };
// Which talents can change AFK gains or max HP / MP at all, read from their description. Only those get
// the slower AFK and snapshot runs; everything else keeps the base value for them.
const talentText = (t) => `${t?.name || ''} ${t?.description || ''} ${t?.lvlUpText || ''}`;
const AFK_RE = /AFK/i;
// Names and texts use underscores ("+{_Base_HP"), so match HP / MP / STR / WIS between non-letters.
const RES_RE = /(?:^|[^A-Z])(?:HP|MP|STR|WIS)(?:[^A-Z]|$)|MANA|HEALTH|STRENGTH|WISDOM|STAT/i;
const skillMetrics = (skill, ch, orig, characters, account, pi, snapshot, plain, opts = {}) => {
  const chars = ch === orig ? characters : characters.map((x) => (x === orig ? ch : x));
  if (snapshot) {
    // Snapshot run: efficiency with this character's own max HP / MP. Talents that cannot change them reuse
    // the loadout's (opts.snapPi); the run is skipped when it equals the plain one.
    const key = SNAP_SKILL[skill];
    if (!key) return { ...plain, res: null, pi };
    let p;
    if (opts.noRes) p = opts.snapPi || pi;
    else if (ch === orig) p = pi;
    else { try { p = getMaxDamage(ch, chars, account); } catch (e) { p = pi; } }
    if (!p || p[key] === pi?.[key]) return { ...plain, res: p?.[key] ?? pi?.[key] ?? null, pi: p || pi };
    let eff = null; try { eff = getSkillEfficiency(skill, ch, chars, account, p)?.value ?? null; } catch (e) {}
    return { ...plain, eff, res: p[key], pi: p };
  }
  let eff = null, power = null, afk = opts.afk ?? null;
  try { const r = getSkillEfficiency(skill, ch, chars, account, pi); eff = r?.value ?? null; power = powerOf(r?.breakdown); } catch (e) {}
  if (opts.afk == null) { try { const r = getAfkGain({ ...ch, afkType: AFK_KIND[skill] }, chars, account); afk = r?.afkGains ?? null; } catch (e) {} }
  return { eff, power, afk, res: SNAP_SKILL[skill] ? pi?.[SNAP_SKILL[skill]] ?? null : null };
};
const ratio = (a, b) => (a && b ? a / b : null);
// Sample size grows one to one with AFK gains and with about efficiency^0.35 (the fishing formula).
const sampleOf = (effX, afkX) => (effX || 1) ** 0.35 * (afkX || 1);
// What changes when a talent goes from one level to another: efficiency, power, AFK gains, sample.
const compare = (skill, v, orig, characters, account, pi, base, baseS, skillIndex, from, to, statFactor, stat, tal) => {
  const c1 = setTalentLevel(v, skillIndex, to, statFactor, stat);
  const txt = talentText(tal);
  const m = skillMetrics(skill, c1, orig, characters, account, pi, false, null, { afk: AFK_RE.test(txt) ? null : base.afk });
  const ms = skillMetrics(skill, c1, orig, characters, account, pi, true, m, RES_RE.test(txt) ? {} : { noRes: true, snapPi: baseS.pi });
  const up = to > from;
  const eff = up ? ratio(m.eff, base.eff) : ratio(base.eff, m.eff);
  const afk = up ? ratio(m.afk, base.afk) : ratio(base.afk, m.afk);
  const effS = up ? ratio(ms.eff, baseS.eff) : ratio(baseS.eff, ms.eff);
  const power = m.power != null && base.power != null ? (up ? m.power - base.power : base.power - m.power) : null;
  const powerX = m.power != null && base.power != null ? (up ? ratio(1 + m.power / 100, 1 + base.power / 100) : ratio(1 + base.power / 100, 1 + m.power / 100)) : null;
  const snap = ms.res !== baseS.res;
  return { eff, afk, effS, power, powerX, snap, sample: sampleOf(eff, afk), sampleS: sampleOf(effS, afk) };
};
const meaningful = (r, eps = 0.0005) => r && ((r.eff || 1) > 1 + eps || (r.afk || 1) > 1 + eps || (r.effS || 1) > 1 + eps || Math.abs(r.power || 0) > 0.05);

// Super talents: for every talent of this loadout, what +super levels do for this skill's efficiency, skill
// power and AFK gains (measured by removing them if the talent is supered). Talents that only matter through
// max HP / MP (the HP and Mana snapshot bubbles) are flagged so the page can show them on request. "+% stat"
// talents are estimated as their own multiplier on the saved total (an upper bound); flat stat talents
// cannot be worked out from a save and are listed without a number. Each talent also gets what levelling it
// to its max, and to the Talent Book Library's max, would do.
const MAIN_STAT = { mining: 'strength', fishing: 'strength', chopping: 'wisdom', catching: 'agility' };
const STAT_PCT = { strength: ['OVERBLOWN_TESTOSTERONE'], agility: ['ADAPTATION_REVELATION'], wisdom: ['UTMOST_INTELLECT'] };
const STAT_FLAT = {
  strength: ['FIST_OF_RAGE', 'ABSOLUTE_UNIT', 'BUILT_DIFFERENT', "'STR'ESS_TESTED_GARB", 'FISTFUL_OF_OBOL'],
  agility: ['QUICKNESS_BOOTS', 'SANIC_SPEED', 'UNREAL_AGILITY', "GARB_OF_UN'AGI'NG_QUALITY", 'SHOEFUL_OF_OBOL'],
  wisdom: ['BOOK_OF_THE_WISE', 'INDIVIDUAL_INSIGHT', 'INDIVIDUALITY', "UNT'WIS'TED_ROBES", 'OCCULT_OBOLS'],
};
export const superTalentPlan = (c, characters, account, skill, pi, loadout) => {
  const v = loadout || c;
  const base = skillMetrics(skill, v, c, characters, account, pi, false); if (!base.eff) return null;
  const baseS = skillMetrics(skill, v, c, characters, account, pi, true, base);
  const bonus = c?.superTalentsInfo?.bonus || getSuperTalentAddedLevels(account) || 0;
  const bookMax = c?.maxBookLv ?? null;
  const stat = MAIN_STAT[skill];
  const out = [], extra = [];
  const seen = new Set();
  for (const t of v.flatTalents || []) {
    if (!t || seen.has(t.skillIndex) || !(t.level >= 1) || !t.name || /^_|FILLER/.test(t.name)) continue;
    seen.add(t.skillIndex);
    const isSuper = !!t.isSuperTalent;
    const added = Math.max(0, (t.level || 0) - (t.baseLevel ?? t.level));
    let statFactor = null, statNote = null;
    if (STAT_PCT[stat].includes(t.name)) {
      const to = isSuper ? t.level - bonus : t.level + bonus;
      const b0 = g(t, t.level) || 0, b1 = g(t, to) || 0;
      statFactor = (1 + b1 / 100) / (1 + b0 / 100);
      statNote = `+${Math.abs(b1 - b0).toFixed(1)}% ${stat} from the super levels (estimated as its own multiplier, so this is an upper bound)`;
    }
    const item = { skillIndex: t.skillIndex, name: t.name, level: t.level, baseLevel: t.baseLevel, maxLevel: t.maxLevel, supered: isSuper, description: t.description, value: g(t, t.level), statNote };
    if (STAT_FLAT[stat].includes(t.name)) {
      const d = Math.abs((g(t, t.level + bonus) || 0) - (g(t, t.level) || 0));
      extra.push({ ...item, gain: null, statNote: `Raises ${stat}${d ? ' (+' + Math.round(d).toLocaleString('en-US') + ' from the super levels)' : ''}. More ${stat} means bigger samples, but how much depends on your other ${stat} sources, which the save does not break down.` });
      continue;
    }
    const sup = compare(skill, v, c, characters, account, pi, base, baseS, t.skillIndex, t.level, isSuper ? t.level - bonus : t.level + bonus, statFactor, stat, t);
    if (!meaningful(sup)) continue;
    // Levels this talent could still gain: up to its max, and up to the library's max book level.
    const lvBase = t.baseLevel ?? t.level;
    const toMax = typeof t.maxLevel === 'number' && t.maxLevel > lvBase
      ? { from: lvBase, to: t.maxLevel, ...compare(skill, v, c, characters, account, pi, base, baseS, t.skillIndex, t.level, t.maxLevel + added, null, null, t) } : null;
    const libOk = bookMax && isBookEligibleTalent(t.skillIndex) && typeof t.maxLevel === 'number' && t.maxLevel < bookMax;
    const toLib = libOk ? { from: t.maxLevel, to: bookMax, ...compare(skill, v, c, characters, account, pi, base, baseS, t.skillIndex, t.level, bookMax + added, null, null, t) } : null;
    out.push({ ...item, gain: sup.eff, sup, toMax, toLib, estimate: !!statFactor });
  }
  out.sort((a, b) => b.sup.sample - a.sup.sample);
  return { bonus, bookMax, slotsUsed: (v.flatTalents || []).filter((t) => t?.isSuperTalent).length, list: out.concat(extra) };
};

// Star talents on the library's VIP Bookshelf (unlocked by VIP Membership %): their max level can be raised
// with books like class talents. From the IdleOn wiki, Talent Book Library page.
const VIP_BOOKS = { TIPTOE_QUICKNESS: 1, UBERCHARGED_HEALTH: 10, COINS_FOR_CHARON: 30, AMERICAN_TIPPER: 75, OVERACCURATE_CRIT: 125, ANCIENT_MULTITOOL: 500, STATUE_METALLURGY: 1000 };
// Star talents that matter for this skill and are below their max level (or, for VIP books, below the
// library's max): what maxing them would do.
export const starTalentCheck = (c, characters, account, skill, pi, loadout) => {
  const v = loadout || c;
  const bookMax = c?.maxBookLv ?? null;
  const base = skillMetrics(skill, v, c, characters, account, pi, false); if (!base.eff) return null;
  const baseS = skillMetrics(skill, v, c, characters, account, pi, true, base);
  const list = [];
  for (const t of v.flatStarTalents || []) {
    const vip = VIP_BOOKS[t?.name] ?? null;
    const libUp = vip != null && bookMax && (t.maxLevel ?? 0) < bookMax;
    // maxLevel 0 or below: the VIP book was never read (or the VIP Bookshelf is not unlocked yet).
    if (!t?.name || /^_|FILLER/.test(t.name) || !(t.maxLevel > 0 || libUp) || !((t.level || 0) < t.maxLevel || libUp)) continue;
    // Relevant if the talent does anything for this skill at all (0 against max), however little is left.
    const txt = talentText(t);
    const zero = setTalentLevel(v, t.skillIndex, 0);
    const z = skillMetrics(skill, zero, c, characters, account, pi, false, null, { afk: AFK_RE.test(txt) ? null : base.afk });
    const zS = skillMetrics(skill, zero, c, characters, account, pi, true, z, RES_RE.test(txt) ? {} : { noRes: true, snapPi: baseS.pi });
    const top = libUp ? bookMax : t.maxLevel;
    const full = compare(skill, v, c, characters, account, pi, z, zS, t.skillIndex, 0, top, null, null, t);
    // Ubercharged Health raises base HP, which only counts through the HP snapshot (Hearty Diggy); always check it for mining.
    if (!meaningful(full, 1e-6) && !(skill === 'mining' && t.name === 'UBERCHARGED_HEALTH')) continue;
    const r = (t.maxLevel ?? 0) > 0 && (t.level || 0) < t.maxLevel ? compare(skill, v, c, characters, account, pi, base, baseS, t.skillIndex, t.level || 0, t.maxLevel, null, null, t) : { eff: 1, afk: 1, effS: 1, power: 0, sample: 1, sampleS: 1 };
    const toLib = libUp ? { from: Math.max(0, t.maxLevel ?? 0), unread: !((t.maxLevel ?? 0) > 0), to: bookMax, ...compare(skill, v, c, characters, account, pi, base, baseS, t.skillIndex, t.level || 0, bookMax, null, null, t) } : null;
    // Highest max level any of your characters has for this star talent.
    const best = Math.max(...(characters || []).map((x) => (x.flatStarTalents || []).find((y) => y?.skillIndex === t.skillIndex)?.maxLevel ?? 0));
    list.push({ skillIndex: t.skillIndex, name: t.name, level: t.level || 0, maxLevel: t.maxLevel, bestMax: best, description: t.description, vip, bookMax, toLib, notMaxed: (t.maxLevel ?? 0) > 0 && (t.level || 0) < t.maxLevel, ...r });
  }
  list.sort((a, b) => b.sampleS - a.sampleS);
  return list;
};

// Right Hand of Action needs this character's skill level below the Voidwalker's. What it is worth if it did.
export const rightHandCheck = (c, characters, account, skill, pi) => {
  const vman = (characters || []).filter((x) => ['Maestro', 'Voidwalker'].includes(x?.class)).at(-1);
  if (!vman) return { vman: null };
  const myLv = c?.skillsInfo?.[skill]?.level ?? 0, vLv = vman?.skillsInfo?.[skill]?.level ?? 0;
  // A Maestro without points in the talent gives nothing either way.
  const talentLv = (vman.flatTalents || []).find((x) => x?.name === 'RIGHT_HAND_OF_ACTION')?.level ?? 0;
  if (!(talentLv > 0)) return { vman: vman.name, cls: vman.class, noTalent: true, myLv, vLv };
  if (vman.name === c.name) return { vman: vman.name, self: true, myLv, vLv };
  const active = myLv < vLv;
  let gain = null;
  if (!active) {
    try {
      const v2 = { ...vman, skillsInfo: { ...vman.skillsInfo, [skill]: { ...(vman.skillsInfo?.[skill] || {}), level: myLv + 1 } } };
      const chars = characters.map((x) => (x === vman ? v2 : x));
      const a = getSkillEfficiency(skill, c, characters, account, pi)?.value, b = getSkillEfficiency(skill, c, chars, account, pi)?.value;
      gain = ratio(b, a);
    } catch (e) {}
  }
  return { vman: vman.name, self: false, myLv, vLv, active, gain };
};

// AFK gains for each skill, as if the character were AFK on that skill (the sample is 90% of AFK yield).
const AFK_TYPE = { mining: 'MINING', chopping: 'CHOPPIN', catching: 'CATCHING', fishing: 'FISHING' };
// AFK stats on gear also come from the gallery (trophies and nametags on podiums) and the hat rack, which are
// account-wide. Split each one so the gallery part is not hidden inside "gear".
export const AFK_STATS = { 'Equipment AFK multi': '%_AFK_GAINS_MULTI', 'Gear (AFK gains)': '%_ALL_AFK_GAIN', 'Gear (Skill AFK gains)': '%_SKILL_AFK_GAIN', 'Gear (Fishing AFK gains)': '%_FISH_AFK_GAIN', 'Gear (Catching AFK gains)': '%_CATCH_AFK_GAIN' };
const afkParts = (c, account) => {
  const pick = (list, name) => (list || []).find((x) => x?.name === name)?.value || 0;
  const g = c?.gallery || account?.gallery || {};
  const items = (list, name) => (list || []).filter((x) => x?.UQ1txt === name || x?.UQ2txt === name).map((x) => ({ raw: x.rawName, name: x.displayName, value: Number(x.UQ1txt === name ? x.UQ1val : x.UQ2val) || 0, podium: x.podiumLevel ?? null }));
  return Object.fromEntries(Object.values(AFK_STATS).map((name) => [name, {
    trophies: pick(g.trophyBonuses, name), nametags: pick(g.nametagBonuses, name), hatRack: pick(account?.hatRack?.hatBonuses, name),
    trophyItems: items(account?.gallery?.trophiesUsed, name), nametagItems: items(account?.gallery?.nametagsUsed, name),
    gearItems: (c?.equipment || []).concat(c?.tools || []).filter((x) => !['TROPHY', 'NAMETAG', 'PREMIUM_HELMET', 'REPLICA_TROPHY', 'REPLICA_NAMETAG'].includes(x?.Type)).filter((x) => x?.UQ1txt === name || x?.UQ2txt === name).map((x) => ({ raw: x.rawName, name: x.displayName, value: Number(x.UQ1txt === name ? x.UQ1val : x.UQ2val) || 0 })),
  }]));
};
export const afkTrees = (c, characters, account) => {
  const trees = {}; const values = {};
  for (const s of SKILLS) {
    try { const r = getAfkGain({ ...c, afkType: AFK_TYPE[s] }, characters, account); trees[s] = cleanBreakdown(r?.breakdown); values[s] = r?.afkGains == null ? null : 100 * r.afkGains; }
    catch (e) { trees[s] = null; values[s] = null; }
  }
  let parts = null; try { parts = afkParts(c, account); } catch (e) {}
  return { trees, values, parts };
};

export const characterTrees = (c, characters, account) => {
  let pi; try { pi = getMaxDamage(c, characters, account); } catch (e) { pi = undefined; }
  const trees = {}; const values = {};
  for (const s of SKILLS) {
    try { const r = getSkillEfficiency(s, c, characters, account, pi); trees[s] = cleanBreakdown(r?.breakdown); values[s] = r?.value; }
    catch (e) { trees[s] = null; values[s] = null; }
  }
  return { trees, values };
};

export const bestSamples = (account, characters) => {
  const out = {};
  (account?.printer || []).forEach((slots, ci) => (slots || []).forEach((x) => {
    for (const [skill, item] of Object.entries(SAMPLE_ITEMS)) {
      if (x?.item === item && (!out[skill] || Number(x.value) > out[skill].value)) out[skill] = { value: Number(x.value), char: characters[ci]?.name };
    }
  }));
  return out;
};

export const analyzeSave = (raw) => {
  const save = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = save.data ?? save;
  const parsed = parseData(data, save.charNames ?? [], save.companion ?? null, save.guildData ?? null, save.serverVars, save.accountCreateTime ? 1e3 * save.accountCreateTime : undefined, save.tournament, {});
  const account = parsed.account ?? parsed.accountData; const characters = parsed.characters ?? parsed.charactersData;
  const samples = bestSamples(account, characters);
  const chars = characters.map((c) => {
    const { trees, values } = characterTrees(c, characters, account);
    let piForInputs; try { piForInputs = getMaxDamage(c, characters, account); } catch (e) { piForInputs = undefined; }
    const inputs = Object.fromEntries(SKILLS.map((s) => { try { return [s, INPUTS.forSkill(account, characters, c, s, piForInputs)]; } catch (e) { return [s, { __error: [{ label: String(e && e.stack || e).slice(0, 300), value: null }] }]; } }));
    const statueVal = Object.fromEntries(SKILLS.map((s) => [s, DETAILS.forSkill(account, characters, c, s)?.statue?.statue?.value ?? null]));
    const golden = Object.fromEntries(SKILLS.map((s) => { try { return [s, goldenWhatIf(c, characters, account, s)]; } catch (e) { return [s, null]; } }));
    const planSkills = SKILLS.filter((s) => FAMILY[s].includes(c.class) || samples[s]?.char === c.name);
    const presets = Object.fromEntries(planSkills.map((s) => { try { return [s, presetCheck(c, characters, account, s, piForInputs)]; } catch (e) { return [s, null]; } }));
    // Super talent plan for the talent preset that is best for this skill.
    const supers = Object.fromEntries(planSkills.map((s) => {
      try {
        const bt = presets[s]?.best?.talent ?? c.selectedTalentPreset ?? 0;
        const plan = superTalentPlan(c, characters, account, s, piForInputs, withLoadout(c, bt, c.selectedCardPreset ?? 0));
        return [s, plan && { ...plan, talentPreset: bt }];
      } catch (e) { return [s, null]; }
    }));
    const stars = Object.fromEntries(planSkills.map((s) => {
      try { const bt = presets[s]?.best?.talent ?? c.selectedTalentPreset ?? 0; return [s, starTalentCheck(c, characters, account, s, piForInputs, withLoadout(c, bt, c.selectedCardPreset ?? 0))]; } catch (e) { return [s, null]; }
    }));
    const hand = Object.fromEntries(SKILLS.map((s) => { try { return [s, rightHandCheck(c, characters, account, s, piForInputs)]; } catch (e) { return [s, null]; } }));
    const loadout = {
      equip: (c.equipment || []).map((x) => x?.rawName).filter((x) => x && x !== 'Blank'),
      tools: (c.tools || []).map((x) => x?.rawName).filter((x) => x && x !== 'Blank'),
      food: (c.food || []).map((x) => x?.rawName).filter((x) => x && x !== 'Blank'),
      chips: (account?.lab?.playersChips?.[c.playerId] || []).map((x) => x?.rawName || ('ConsoleChip' + x?.index)).filter(Boolean),
      cards: (c.cards?.equippedCards || []).map((x) => x?.cardIndex).filter(Boolean),
      cardSet: c.cards?.cardSet?.rawName || null,
      prayers: (c.activePrayers || []).map((x) => 'Prayer' + x?.prayerIndex),
      obols: (c.obols?.list || []).map((x) => x?.rawName).filter((x) => x && !/Locked|Blank/.test(x)),
    };
    loadout.galleryChip = (() => { try { return getPlayerLabChipBonus(c, account, 16) ? 1 : 0; } catch (e) { return 0; } })();
    loadout.talentPreset = c.selectedTalentPreset ?? 0; loadout.cardPreset = c.selectedCardPreset ?? 0;
    const afk = afkTrees(c, characters, account);
    return { afk, loadout, presets, supers, stars, hand, golden, name: c.name, cls: c.class, level: c.level, skillLv: Object.fromEntries(SKILLS.map((s) => [s, c.skillsInfo?.[s]?.level ?? 0])), trees, values, statueVal, inputs };
  });
  const h = account?.hole?.holesObject || {};
  const extras = {};
  for (const [skill, idx] of Object.entries(STATUE_IDX)) {
    const st = account?.statues?.[idx] || {};
    extras[skill] = {
      statue: { name: st.name, level: st.level, onyx: !!st.onyxStatue, zenith: !!st.zenithStatue, onyxMulti: st.onyxMulti, zenithMulti: st.zenithMulti, dragonMulti: st.dragonMulti, vault: st.upgradeVaultMulti, talentMulti: st.talentMulti, event: st.eventBonusMulti, merit: st.meritocracyMulti },
      monument: MONUMENT_T[skill] === undefined ? null : { level: h.braveryBonuses?.[10 * MONUMENT_T[skill]], multiLevel: h.braveryBonuses?.[10 * MONUMENT_T[skill] + 9] }
    };
  }
  const details = Object.fromEntries(SKILLS.map((s) => [s, DETAILS.forSkill(account, characters, characters.find((c) => c.name === samples[s]?.char) || characters[0], s)]));
  const bisSave = { cards: {}, cardSets: {}, prayers: {} };
  try {
    Object.values(account?.cards || {}).forEach((c) => { if (c?.cardIndex) bisSave.cards[c.cardIndex] = { stars: c.stars ?? -1, amount: c.amount ?? 0, bonus: c.amount > 0 ? calcCardBonus({ bonus: c.bonus, stars: c.stars }) : 0 }; });
  } catch (e) {}
  try {
    Object.values(getCardSets(account) || {}).forEach((set) => { if (set?.rawName) bisSave.cardSets[set.rawName] = { stars: set.stars, bonus: (set.bonus || 0) * Math.max(0, (set.stars ?? -1) + 1) }; });
  } catch (e) {}
  for (const name of ['Skilled_Dimwit', 'Zerg_Rushogen']) {
    try {
      const pr = (account?.prayers || []).find((x) => x?.name === name);
      const r = getPrayerBonusAndCurse([{ name: '__none__' }], name, account, true);
      bisSave.prayers[name] = { level: pr?.level ?? 0, maxLevel: pr?.maxLevel ?? null, bonus: r?.bonus ?? 0, curse: r?.curse ?? 0 };
    } catch (e) {}
  }
  const trophies = (account?.gallery?.trophiesUsed || []).map((x) => x?.rawName).filter(Boolean);
  // Gallery and hat rack, for the AFK gains view.
  let gallery = null;
  try {
    const g = account?.gallery || {};
    gallery = {
      multi: g.bonusMulti ?? null,
      podiums: [g.podiumsOwned, g.lv2PodiumsOwned, g.lv3PodiumsOwned, g.lv4PodiumsOwned],
      trophies: (g.trophiesUsed || []).map((x) => (x?.isEmpty ? { empty: true, level: x.podiumLevel } : { raw: x.rawName, level: x.podiumLevel, multi: x.podiumMultiplier, stats: [x.UQ1txt, x.UQ2txt].filter((s) => s && s !== '0') })),
      inventory: (g.inventoryTrophies || []).map((x) => ({ raw: x.rawName, stats: [x.UQ1txt, x.UQ2txt].filter((s) => s && s !== '0') })),
      nametags: (g.nametagsUsed || []).map((x) => ({ raw: x.rawName, level: x.level, multi: x.nametagMultiplier, stats: [x.UQ1txt, x.UQ2txt].filter((s) => s && s !== '0') })),
      hats: { count: account?.hatRack?.totalHats ?? (account?.hatRack?.hatsUsed || []).length, multi: account?.hatRack?.bonusMulti ?? null },
      // Gallery bonus multi = 1 + (3 × gallery level + Silkrode Motherboard chip 10 + 3 × clam work + Killroy shop
      // + Codfrey Rulz OK bubble (max 20) + Coralcave Crab card level (max 10) + Bubba the Seal + sushi) / 100
      multiParts: (() => { const s = (f) => { try { return Number(f()) || 0; } catch (e) { return 0; } }; return {
        level: s(() => g.rawSpelunk?.[13]?.[4]), clam: s(() => getClamWorkBonus(account, 7)), killroy: s(() => getKillRoyShopBonus(account, 3)),
        bubble: s(() => Math.min(20, getBubbleBonus(account, 'CODFREY_RULZ_OK', false))), card: s(() => Math.min(getCardLevel(account?.cards, 'w7a11'), 10)),
        companion: s(() => (isCompanionBonusActive(account, 49) ? account?.companions?.list?.at(49)?.bonus : 0)), sushi: s(() => getSushiBonus(account, 54)),
        killroyLevel: s(() => account?.accountOptions?.[467]), bubbleLevel: s(() => (account?.alchemy?.bubblesFlat || Object.values(account?.alchemy?.bubbles || {}).flat()).find((b) => b?.bubbleName === 'CODFREY_RULZ_OK')?.level) }; })(),
    };
  } catch (e) {}
  // Base bonuses of every trophy and nametag (before podium / copies and the gallery bonus multi).
  const galleryItems = {};
  try {
    for (const [raw, it] of Object.entries(ITEMS || {})) {
      if (!/^(Trophy\d+|EquipmentNametag\d+)$/.test(raw)) continue;
      const list = [];
      for (const i of [1, 2]) { const txt = it?.['UQ' + i + 'txt'], val = Number(it?.['UQ' + i + 'val']) || 0; if (txt && txt !== '0' && val) list.push([txt, val]); }
      for (const s of ['Weapon_Power', 'STR', 'AGI', 'WIS', 'LUK', 'Defence']) { const v = Number(it?.[s]) || 0; if (v) list.push([s, v]); }
      galleryItems[raw] = list;
    }
  } catch (e) {}
  if (gallery) gallery.items = galleryItems;
  return { gallery, trophies, chars, samples, extras, details, bisSave, lastUpdated: save.lastUpdated ?? null };
};

export const evaluate = (node) => evaluateBreakdownNode(node);
export const evaluateTree = (b) => {
  const vals = (b?.tree || []).map((n) => evaluateBreakdownNode(n));
  if ((b?.combine ?? 'product') === 'sum') return vals.reduce((a, v) => a + v, 0);
  return vals.reduce((a, v) => a * v, 1);
};


// Activity tabs: account-wide loadout search (see optimizer.js).
export { ACTIVITIES, parseSave, optimizeLoadout, stonedItem, familyOf } from './optimizer';
