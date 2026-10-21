// Activity loadout optimizer: searches the whole account (storage, every inventory, what other characters
// wear) for the setup that gives one character the most of one activity, and works out a theoretical
// best-in-slot setup from the game's full item list. The value of a setup is always IdleonToolbox's own
// formula for that activity, run on a copy of the character with the swapped loadout.
import { parseData } from '@parsers/index';
import { getDropRate, getAfkGain } from '@parsers/character';
import { getItemCapacity } from '@parsers/misc';
import { getPowerType } from '@parsers/powerTypes';
import { getCardSets } from '@parsers/cards';
import { getInfiniteStarsCount } from '@parsers/starSigns';
import { isGalleryActive, getTrophyBonuses } from '@parsers/world-7/gallery';
import { getPrayerBonusAndCurse } from '@parsers/world-3/prayers';
import { isHatRackActive } from '@parsers/world-3/hatRack';
import { getLegendTalentBonus } from '@parsers/world-7/legendTalents';
import { items as ITEMS, classPromotions } from '@website-data';

/* Activities ------------------------------------------------------------------------------------ */
export const ACTIVITIES = {
  rareDrops: {
    label: 'Rare Drops', sub: 'AFK · drop rate × fight AFK gains', unit: '',
    what: 'Score = drop rate × Fight AFK gains.',
    parts: (c, chars, A) => ({ 'Drop rate': getDropRate(c, A, chars)?.dropRate, 'Fight AFK gains': getAfkGain({ ...c, afkType: 'FIGHTING' }, chars, A)?.afkGains }),
    partUnits: { 'Drop rate': 'x', 'Fight AFK gains': '%' },
    value(c, chars, A) { const p = this.parts(c, chars, A); return p['Drop rate'] * p['Fight AFK gains']; },
  },
};

/* Save ------------------------------------------------------------------------------------------ */
export const parseSave = (raw) => {
  const save = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const data = save.data ?? save;
  const parsed = parseData(data, save.charNames ?? [], save.companion ?? null, save.guildData ?? null, save.serverVars, save.accountCreateTime ? 1e3 * save.accountCreateTime : undefined, save.tournament, {});
  // Prayer slots the account has: the most any character has filled (the save keeps 12 places, -1 when empty).
  let prayerSlots = 0;
  for (let i = 0; i < (save.charNames || []).length; i++) {
    let arr = data?.['Prayers_' + i]; try { if (typeof arr === 'string') arr = JSON.parse(arr); } catch (e) { arr = null; }
    if (Array.isArray(arr)) arr.forEach((x, k) => { if (x !== -1 && x != null) prayerSlots = Math.max(prayerSlots, k + 1); });
  }
  return { account: parsed.account ?? parsed.accountData, characters: parsed.characters ?? parsed.charactersData, prayerSlots };
};

/* Item rules ------------------------------------------------------------------------------------ */
const WEAPONS = ['SPEAR', 'BOW', 'WAND', 'FISTICUFF', 'SWORD'];
export const EQUIP_SLOTS = [
  ['Helmet', ['HELMET']], ['Weapon', WEAPONS], ['Shirt', ['SHIRT']], ['Pendant', ['PENDANT']], ['Pants', ['PANTS']], ['Ring', ['RING']],
  ['Shoes', ['SHOES']], ['Ring', ['RING']], ['Premium helmet', ['PREMIUM_HELMET']], ['Keychain', ['KEYCHAIN']], ['Trophy', ['TROPHY', 'REPLICA_TROPHY']],
  ['Keychain', ['KEYCHAIN']], ['Cape', ['CAPE']], ['Chat ring', ['CHAT_RING']], ['Nametag', ['NAMETAG', 'REPLICA_NAMETAG']], ['Attire', ['ATTIRE']],
];
export const TOOL_SLOTS = [
  ['Pickaxe', ['PICKAXE'], 'mining'], ['Hatchet', ['HATCHET'], 'chopping'], ['Fishing rod', ['FISHING_ROD'], 'fishing'], ['Bug net', ['BUG_CATCHING_NET'], 'catching'],
  ['Trap box', ['TRAP_BOX_SET'], 'trapping'], ['Worship skull', ['WORSHIP_SKULL'], 'worship'], ['DNA splicer', ['DNA_SPLICER'], 'breeding'],
];
const FOOD_TYPES = ['GOLDEN_FOOD', 'BOOST_FOOD'];
const STAT_KEYS = { STR: 'strength', AGI: 'agility', WIS: 'wisdom', LUK: 'luck' };
const MAIN_STAT = { WARRIOR: 'STR', ARCHER: 'AGI', MAGE: 'WIS', BEGINNER: 'LUK' };
const real = (x) => x && x.rawName && x.rawName !== 'Blank' && x.rawName !== 'LockedInvSpace' && x.rawName !== 'ERROR';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const familyOf = (cls) => {
  let k = cls;
  for (let i = 0; i < 8 && k; i++) {
    if (k === 'Warrior') return 'WARRIOR';
    if (k === 'Archer') return 'ARCHER';
    if (k === 'Mage') return 'MAGE';
    if (k === 'Beginner' || k === 'Journeyman') return 'BEGINNER';
    k = classPromotions?.[k]?.promotesFrom;
  }
  return null;
};
const classOk = (it, fam) => !it?.Class || it.Class === 'ALL' || it.Class === fam;
// Equipment: class level. Tools: the level of their own skill.
const levelOk = (c, it, skill) => {
  const need = num(it?.lvReqToEquip);
  const have = skill ? (c?.skillsInfo?.[skill]?.level ?? c?.level ?? 0) : (c?.level ?? 0);
  return need <= have;
};

// What makes two items interchangeable for every formula: all stats plus the misc bonuses.
const SIG_KEYS = ['Type', 'Class', 'Weapon_Power', 'STR', 'AGI', 'WIS', 'LUK', 'Defence', 'Speed', 'Reach', 'UQ1txt', 'UQ1val', 'UQ2txt', 'UQ2val', 'Effect', 'Amount', 'Power'];
const sig = (it) => (it ? (it.rawName ?? it.name ?? it.starName ?? it.cardIndex) + '|' + SIG_KEYS.map((k) => it[k] ?? '').join('|') : 'none');

/* Theoretical best in slot: base item + (upgrade slots + 1 from the Post Office box) W7 stones -------- */
// Effect strings of Weapon / Armor / Tool Upgrade Stone VII. Main_Stat goes to the character's main stat
// (STR, AGI, WIS, LUK by class family); Misc_Bonus raises the item's first misc bonus.
const STONES = {
  weapon: { raw: 'StoneW9', Weapon_Power: 10, main: 10, misc: 3, Defence: 0 },
  armor: { raw: 'StoneA8', Weapon_Power: 2, main: 15, misc: 1, Defence: 20 },
  tool: { raw: 'StoneT8', Weapon_Power: 12, main: 15, misc: 2, Defence: 0 },
};
// "% Drop Chance" (gem shop Relic Chains) is the game's drop rate. IdleonToolbox does not read that stat name,
// so it is counted as drop rate here.
const dropChance = (it) => (it && (it.UQ1txt === '%_DROP_CHANCE' || it.UQ2txt === '%_DROP_CHANCE')
  ? { ...it, UQ1txt: it.UQ1txt === '%_DROP_CHANCE' ? '%_DROP_RATE' : it.UQ1txt, UQ2txt: it.UQ2txt === '%_DROP_CHANCE' ? '%_DROP_RATE' : it.UQ2txt } : it);
const keychainVal = (v) => (typeof v === 'string' && v.includes(',') ? Math.max(...v.split(',').map(Number).filter(Number.isFinite)) : num(v));
export const stonedItem = (raw, fam) => {
  const base = ITEMS?.[raw]; if (!base) return null;
  const it = { ...base, rawName: raw };
  if (it.Type === 'KEYCHAIN') { it.UQ1val = keychainVal(it.UQ1val); it.UQ2val = keychainVal(it.UQ2val); }
  const kind = WEAPONS.includes(it.Type) ? 'weapon' : TOOL_SLOTS.some((t) => t[1].includes(it.Type)) ? 'tool' : 'armor';
  const slots = num(it.Upgrade_Slots_Left) > 0 ? num(it.Upgrade_Slots_Left) + 1 : 0;
  if (slots) {
    const s = STONES[kind], main = MAIN_STAT[fam] || 'STR';
    it.Weapon_Power = num(it.Weapon_Power) + slots * s.Weapon_Power;
    it.Defence = num(it.Defence) + slots * s.Defence;
    it[main] = num(it[main]) + slots * s.main;
    if (it.UQ1txt && it.UQ1txt !== '0') it.UQ1val = num(it.UQ1val) + slots * s.misc;
    it.stones = { raw: s.raw, count: slots };
  }
  it.Upgrade_Slots_Left = 0;
  return it;
};

/* Building a character from a loadout state ------------------------------------------------------- */
const flattenTalents = (tabs) => Object.values(tabs || {}).flatMap((x) => x?.orderedTalents || []);
const talentVariant = (c, idx) => (idx === (c.selectedTalentPreset ?? 0) || !c.talentPreset
  ? c
  : { ...c, talents: c.talentPreset.talents, flatTalents: flattenTalents(c.talentPreset.flatTalents), flatStarTalents: c.talentPreset.flatStarTalents || c.flatStarTalents });

// Obol stats the way IdleonToolbox sums them (getStatsFromObols), personal part only; the family part is kept.
const OBOL_STATS = ['STR', 'AGI', 'WIS', 'LUK', 'Weapon_Power', 'Defence', 'UQ1txt', 'UQ2txt'];
const obolPersonal = (list) => {
  const res = {};
  for (const obol of list || []) {
    if (!real(obol)) continue;
    for (const statName of OBOL_STATS) {
      const statValue = obol[statName];
      if (statValue === undefined) continue;
      const uq = statName === 'UQ1txt' ? 1 : statName === 'UQ2txt' ? 2 : null;
      if (uq && statValue === 0) continue;
      let name = uq ? statValue : statName;
      if (statName === 'Weapon_Power' && statValue > 0) name = getPowerType(obol?.UQ1txt || obol?.rawName).replace(/ /, '_');
      const value = Number(uq ? obol?.[`UQ${uq}val`] : statValue) || 0;
      res[name] = (res[name] ?? 0) + Math.max(0, value);
    }
  }
  return res;
};
const mergeObolStats = (personal, orig) => {
  const out = {};
  for (const k of new Set([...Object.keys(personal), ...Object.keys(orig || {})])) out[k] = { personalBonus: personal[k], familyBonus: orig?.[k]?.familyBonus };
  return out;
};
const flatStats = (list) => {
  const s = { STR: 0, AGI: 0, WIS: 0, LUK: 0 };
  for (const it of list) if (real(it)) for (const k of Object.keys(s)) s[k] += num(it[k]);
  return s;
};

/* The search ------------------------------------------------------------------------------------- */
const tick = () => new Promise((r) => setTimeout(r, 0));

export const optimizeLoadout = async (P, charName, activityKey, opts = {}) => {
  const act = ACTIVITIES[activityKey]; if (!act) throw new Error('Unknown activity ' + activityKey);
  const A = P.account, C = P.characters;
  const c = C.find((x) => x.name === charName); if (!c) throw new Error('No character ' + charName);
  const fam = familyOf(c.class);
  const pid = c.playerId;
  const onProgress = opts.onProgress || (() => {});
  const notes = [];
  const t0 = Date.now();
  let evals = 0, lastYield = Date.now();

  /* Pools of things this character could use, each with where it is now. */
  const where = { equipped: 'Equipped', storage: 'Storage' };
  const equipPool = [];
  const addEquip = (it, loc, key) => { if (real(it) && it.itemType === 'Equip') equipPool.push({ id: key, item: it, where: loc }); };
  (c.equipment || []).forEach((it, i) => addEquip(it, where.equipped, 'me-e' + i));
  (c.tools || []).forEach((it, i) => addEquip(it, where.equipped, 'me-t' + i));
  (A?.storage?.list || []).forEach((it, i) => addEquip(it, where.storage, 'st' + i));
  for (const ch of C) {
    (ch.inventory || []).forEach((it, i) => addEquip(it, ch === c ? 'Your inventory' : `${ch.name}'s inventory`, `inv${ch.playerId}-${i}`));
    if (ch === c) continue;
    (ch.equipment || []).forEach((it, i) => addEquip(it, `Worn by ${ch.name}`, `w${ch.playerId}-e${i}`));
    (ch.tools || []).forEach((it, i) => addEquip(it, `Worn by ${ch.name}`, `w${ch.playerId}-t${i}`));
  }
  const RANK = (w) => (w === where.equipped ? 0 : w === where.storage ? 1 : w === 'Your inventory' ? 2 : /inventory$/.test(w) ? 3 : 4);
  equipPool.sort((a, b) => RANK(a.where) - RANK(b.where));

  const galleryOn = isGalleryActive(c), rackOn = isHatRackActive(c);
  const skipEquip = (i) => (galleryOn && (i === 10 || i === 14)) || (rackOn && i === 8);

  // Food: everything the account owns, a stack per slot up to the carry cap.
  const foodCap = (() => { try { return getItemCapacity('cFood', c, A)?.value ?? null; } catch (e) { return null; } })();
  const foodOwned = {}; const foodWhere = {};
  const addFood = (raw, amount, loc) => {
    if (!raw || !FOOD_TYPES.includes(ITEMS?.[raw]?.Type) || !(amount > 0)) return;
    foodOwned[raw] = (foodOwned[raw] || 0) + amount;
    (foodWhere[raw] = foodWhere[raw] || {})[loc] = (foodWhere[raw][loc] || 0) + amount;
  };
  (A?.storage?.list || []).forEach((x) => addFood(x?.rawName, num(x?.amount), 'Storage'));
  for (const ch of C) {
    (ch.inventory || []).forEach((x) => addFood(x?.rawName, num(x?.amount), ch === c ? 'Your inventory' : `${ch.name}'s inventory`));
    (ch.food || []).forEach((x) => addFood(x?.rawName, num(x?.amount), ch === c ? 'Your food slots' : `${ch.name}'s food slots`));
  }
  const foodSlots = Math.max(1, ...C.map((ch) => (ch.food || []).filter(real).length));
  const foodItem = (raw, amount) => (raw ? { ...ITEMS[raw], rawName: raw, name: ITEMS[raw]?.displayName, amount } : { rawName: 'Blank', amount: 0 });

  // Cards: every card the account has found, boosted in slot 1 / 8 by the Omega chips.
  const legend = (() => { try { return 1 + getLegendTalentBonus(A, 21) / 100; } catch (e) { return 1; } })();
  const cardPool = Object.values(A?.cards || {}).filter((x) => x?.cardIndex && x.amount > 0).map((x) => ({ cardName: x.displayName, ...x }));
  const setPool = (() => { try { return Object.values(getCardSets(A) || {}).filter((s) => s?.rawName && s.stars >= 0).map((s) => ({ ...s, bonus: (s.bonus || 0) * (s.stars + 1) })); } catch (e) { return []; } })();

  // Prayers the account has unlocked.
  const prayerPool = (A?.prayers || []).filter((p) => p && p.level > 0);

  // Lab chips: spare ones plus those sitting in other characters' slots.
  const chipPool = [];
  (A?.lab?.chips || []).forEach((ch) => { for (let k = 0; k < (ch?.amount || 0); k++) chipPool.push({ id: `spare${ch.index}-${k}`, chip: ch, where: 'Spare chips' }); });
  (A?.lab?.playersChips || []).forEach((list, p) => {
    if (p === pid) return;
    const owner = C.find((x) => x.playerId === p)?.name || `Character ${p + 1}`;
    (list || []).forEach((ch, k) => { if (ch && ch.index != null) chipPool.push({ id: `p${p}-${k}`, chip: ch, where: `In ${owner}'s chip slots` }); });
  });
  const myChips = (A?.lab?.playersChips?.[pid] || []).map((ch, k) => (ch && ch.index != null ? { id: `me${k}`, chip: ch, where: where.equipped } : null));
  const chipSlots = Math.max(myChips.length, 0);

  // Star signs: only those not already active through Infinite Stars.
  const infinite = (() => { try { return getInfiniteStarsCount(A); } catch (e) { return 0; } })();
  const signPool = (A?.starSigns || []).filter((s, i) => s?.unlocked && i >= infinite && s.starName);

  // Obols: the obol storage and other characters' personal obols, by shape.
  const obolPool = [];
  const SHAPES = ['CIRCLE', 'SQUARE', 'HEXAGON', 'SPARKLE'];
  (A?.obols?.inventory || []).forEach((tab, ti) => (tab || []).forEach((raw, k) => {
    if (!raw || /^(Blank|LockedInvSpace)$/.test(raw) || !ITEMS?.[raw]) return;
    obolPool.push({ id: `oi${ti}-${k}`, item: { ...ITEMS[raw], rawName: raw }, where: 'Obol storage' });
  }));
  for (const ch of C) {
    if (ch === c) continue;
    (ch.obols?.list || []).forEach((o, k) => { if (real(o)) obolPool.push({ id: `o${ch.playerId}-${k}`, item: o, where: `${ch.name}'s obols` }); });
  }
  const myObols = (c.obols?.list || []).map((o, k) => ({ id: `me-o${k}`, item: o, where: where.equipped }));
  const obolMeta = (o) => ({ index: o?.index, shape: o?.shape, levelReq: o?.levelReq });
  const obolShapeOk = (slot, it) => !!slot?.shape && String(it?.Type || '').startsWith(String(slot.shape).toUpperCase() + '_') && SHAPES.includes(String(slot.shape).toUpperCase());

  // Gallery: which trophy sits on which podium. Podium positions start at 48; the first ones are the highest level.
  // This is account-wide, so a change here changes the gallery for every character.
  const galleryRaw = galleryOn && Array.isArray(A?.gallery?.rawSpelunk?.[16]) ? A.gallery.rawSpelunk : null;
  const podiums = galleryRaw ? Math.min(A.gallery.podiumsOwned || 0, galleryRaw[16].length - 48) : 0;
  const podiumLevel = (k) => { const off = k - 48; const g = A.gallery; return g.lv4PodiumsOwned > off ? 4 : (g.lv4PodiumsOwned + g.lv3PodiumsOwned) > off ? 3 : (g.lv4PodiumsOwned + g.lv3PodiumsOwned + g.lv2PodiumsOwned) > off ? 2 : 1; };
  const trophyOutside = [];
  if (galleryRaw) {
    const inGallery = new Set(galleryRaw[16].filter((x) => x >= 1));
    const seen = new Set();
    const addT = (it, loc) => { const m = /^Trophy(\d+)$/.exec(it?.rawName || ''); if (!m) return; const n = Number(m[1]); if (inGallery.has(n) || seen.has(n)) return; seen.add(n); trophyOutside.push({ n, where: loc }); };
    (A?.storage?.list || []).forEach((it) => addT(it, 'Storage'));
    for (const ch of C) { (ch.inventory || []).forEach((it) => addT(it, ch === c ? 'Your inventory' : `${ch.name}'s inventory`)); (ch.equipment || []).forEach((it) => addT(it, ch === c ? 'Equipped' : `Worn by ${ch.name}`)); }
  }
  const trophyBonusFor = (list) => { const rs = galleryRaw.slice(); rs[16] = list; return getTrophyBonuses(rs, A, c)?.bonuses; };
  if (galleryRaw) {
    const mine = trophyBonusFor(galleryRaw[16]) || [], saved = c.gallery?.trophyBonuses || A.gallery?.trophyBonuses || [];
    const off = saved.some((b) => Math.abs((mine.find((x) => x.name === b.name)?.value ?? 0) - (b.value || 0)) > 1e-6 * Math.max(1, Math.abs(b.value || 0)));
    if (off) notes.push('Gallery: rebuilding your trophy bonuses does not match the save exactly, so podium suggestions may be off.');
    if (opts.debug) opts.debug.gallery = { podiums, off, sample: mine.slice(0, 4) };
  }

  /* State: what sits in each slot. Entries point at pool entries so a physical item is used once. */
  const tVariants = [c.selectedTalentPreset ?? 0].concat(c.talentPreset ? [(c.selectedTalentPreset ?? 0) === 0 ? 1 : 0] : []);
  const tBase = Object.fromEntries(tVariants.map((t) => [t, talentVariant(c, t)]));
  const init = {
    talent: c.selectedTalentPreset ?? 0,
    equip: (c.equipment || []).map((it, i) => (real(it) ? equipPool.find((p) => p.id === 'me-e' + i) : null)),
    tools: (c.tools || []).map((it, i) => (real(it) ? equipPool.find((p) => p.id === 'me-t' + i) : null)),
    food: (c.food || []).slice(0, Math.max(foodSlots, (c.food || []).filter(real).length)).map((f) => (real(f) ? { raw: f.rawName, amount: num(f.amount) } : null)),
    cards: Array.from({ length: 8 }, (_, i) => c.cards?.equippedCards?.[i]).map((x) => (x?.cardIndex ? cardPool.find((p) => p.cardIndex === x.cardIndex) || x : null)),
    cardSet: c.cards?.cardSet || null,
    prayers: Array.from({ length: Math.max(P.prayerSlots || 0, (c.activePrayers || []).length) }, (_, k) => (c.activePrayers || [])[k] || null),
    chips: myChips.slice(),
    signs: (c.starSigns || []).slice(),
    obols: myObols.slice(),
    trophies: galleryRaw ? galleryRaw[16].slice() : null,
  };
  while (init.food.length < foodSlots) init.food.push(null);
  const origFlat = flatStats([...(c.equipment || []), ...(c.tools || []), ...(c.obols?.list || [])]);
  const origObolStats = c.obols?.stats;

  const build = (st) => {
    const b = tBase[st.talent] || c;
    const equipment = (c.equipment || []).map((orig, i) => (skipEquip(i) ? orig : dropChance(st.equip[i]?.item) || { rawName: 'Blank' }));
    const tools = (c.tools || []).map((orig, i) => (i < TOOL_SLOTS.length ? st.tools[i]?.item || { rawName: 'Blank' } : orig));
    const obolList = st.obols.map((e, k) => (e ? { ...e.item, ...obolMeta(myObols[k].item) } : { ...obolMeta(myObols[k].item), rawName: 'Blank' }));
    const hasNano = st.chips.some((e) => e?.chip?.index === 20), hasMother = st.chips.some((e) => e?.chip?.index === 21);
    const cards = st.cards.map((x, i) => (x ? { ...x, chipBoost: (i === 0 && hasNano) || (i === 7 && hasMother) ? 2 : undefined, legendBonus: legend } : {}));
    const fl = flatStats([...equipment, ...tools, ...obolList]);
    const stats = { ...c.stats };
    for (const [k, key] of Object.entries(STAT_KEYS)) stats[key] = (c.stats?.[key] || 0) + fl[k] - origFlat[k];
    const v = {
      ...b, equipment, tools, stats,
      food: st.food.map((f) => (f ? foodItem(f.raw, f.amount) : foodItem(null))).concat((c.food || []).slice(st.food.length).map(() => foodItem(null))),
      cards: { ...c.cards, equippedCards: cards, cardSet: st.cardSet },
      activePrayers: st.prayers.filter(Boolean),
      starSigns: st.signs,
      obols: { ...c.obols, list: obolList, stats: mergeObolStats(obolPersonal(obolList), origObolStats) },
    };
    if (st.trophies && st.trophies.some((x, k) => x !== galleryRaw[16][k])) {
      const tb = trophyBonusFor(st.trophies);
      v.gallery = { ...(c.gallery || {}), trophyBonuses: tb };
    }
    const acc = { ...A, lab: { ...A.lab, playersChips: (A.lab?.playersChips || []).map((list, p) => (p === pid ? st.chips.filter(Boolean).map((e) => e.chip) : list)) } };
    return { v, acc, chars: C.map((x) => (x === c ? v : x)) };
  };
  // Same setup, same value: passes and the pruning step revisit many setups, so remember them.
  const memo = new Map();
  const stKey = (st) => [st.talent, st.equip.map((e) => e?.id || '').join(','), st.tools.map((e) => e?.id || '').join(','), st.food.map((f) => (f ? f.raw + ':' + f.amount : '')).join(','),
    st.cards.map((x) => x?.cardIndex || '').join(','), st.cardSet?.rawName || '', st.prayers.map((p) => p?.name || '').join(','), st.chips.map((e) => e?.id || '').join(','),
    st.signs.map((s) => s?.starName || '').join(','), st.obols.map((e) => e?.id || '').join(','), st.trophies ? st.trophies.join(',') : ''].join('|');
  const value = async (st) => {
    const key = stKey(st);
    if (memo.has(key)) return memo.get(key);
    const v = await valueRaw(st);
    memo.set(key, v);
    return v;
  };
  const valueRaw = async (st) => {
    // A card goes in a preset once.
    const ci = st.cards.filter(Boolean).map((x) => x.cardIndex);
    if (new Set(ci).size !== ci.length) return -Infinity;
    evals++;
    if (Date.now() - lastYield > 40) { await tick(); lastYield = Date.now(); onProgress({ evals }); }
    try { const { v, acc, chars } = build(st); const r = act.value(v, chars, acc); return Number.isFinite(r) ? r : -Infinity; } catch (e) { return -Infinity; }
  };

  // Sanity: the rebuilt current loadout must give the same value as the character itself.
  const own = (() => { try { return act.value(c, C, A); } catch (e) { return null; } })();
  const base = await value(init);
  const drift = own && base ? base / own : 1;
  if (Math.abs(drift - 1) > 1e-6) notes.push(`Rebuilding your current setup gives ${(drift * 100 - 100).toFixed(4)}% against the save itself, so small gains may be noise.`);

  /* One slot at a time: try every candidate, keep the best; repeat until nothing improves. */
  const better = (a, b) => a > b * (1 + 1e-9);
  const used = (st) => {
    const ids = new Set();
    for (const e of [...st.equip, ...st.tools, ...st.chips, ...st.obols]) if (e) ids.add(e.id);
    return ids;
  };
  const clone = (st) => ({ ...st, equip: st.equip.slice(), tools: st.tools.slice(), food: st.food.slice(), cards: st.cards.slice(), prayers: st.prayers.slice(), chips: st.chips.slice(), signs: st.signs.slice(), obols: st.obols.slice(), trophies: st.trophies ? st.trophies.slice() : null });

  // Tries each distinct candidate for one slot; candidates that are the same item with the same stats are tried once.
  const trySlot = async (st, cur, key, i, candidates, allowEmpty = true) => {
    let best = st, bestV = cur;
    const seen = new Set([key === 'food' ? (st[key][i]?.raw ?? 'none') : sig(st[key][i]?.item || st[key][i]?.chip || st[key][i])]);
    // Prayers: an empty slot first, so a prayer that does nothing is not suggested just to fill the slot.
    const list = !allowEmpty ? candidates : key === 'prayers' ? [null].concat(candidates) : candidates.concat([null]);
    for (const cand of list) {
      const s = key === 'food' ? (cand?.raw ?? 'none') : sig(cand?.item || cand?.chip || cand);
      if (seen.has(s)) continue; seen.add(s);
      const nx = clone(st); nx[key][i] = cand;
      const val = await value(nx);
      if (better(val, bestV)) { best = nx; bestV = val; }
    }
    return [best, bestV];
  };

  const categories = opts.categories || ['equip', 'tools', 'cards', 'cardSet', 'prayers', 'chips', 'signs', 'obols', 'gallery', 'food'];
  let cardTop = null, cardsScanned = false;
  const boostSlots = (st) => [st.chips.some((e) => e?.chip?.index === 20) ? 0 : null, st.chips.some((e) => e?.chip?.index === 21) ? 7 : null].filter((x) => x != null);
  const search = async (start) => {
    let st = start, cur = await value(st);
    for (let pass = 0; pass < 4; pass++) {
      const before = cur;
      if (categories.includes('equip')) for (let i = 0; i < EQUIP_SLOTS.length && i < st.equip.length; i++) {
        if (skipEquip(i)) continue;
        const ids = used(st); ids.delete(st.equip[i]?.id);
        const cands = equipPool.filter((p) => !ids.has(p.id) && EQUIP_SLOTS[i][1].includes(p.item.Type) && classOk(p.item, fam) && levelOk(c, p.item));
        [st, cur] = await trySlot(st, cur, 'equip', i, cands);
      }
      if (categories.includes('tools')) for (let i = 0; i < TOOL_SLOTS.length && i < st.tools.length; i++) {
        const ids = used(st); ids.delete(st.tools[i]?.id);
        const cands = equipPool.filter((p) => !ids.has(p.id) && TOOL_SLOTS[i][1].includes(p.item.Type) && levelOk(c, p.item, TOOL_SLOTS[i][2]));
        [st, cur] = await trySlot(st, cur, 'tools', i, cands);
      }
      if (categories.includes('cards')) {
        // Rank every card the account has once, by what it is worth in a normal (not doubled) slot.
        if (!cardTop) {
          const ranked = [];
          const probe = 3;
          for (const card of cardPool) {
            const nx = clone(st); nx.cards[probe] = card;
            if (nx.cards.some((x, k) => k !== probe && x?.cardIndex === card.cardIndex)) nx.cards[nx.cards.findIndex((x, k) => k !== probe && x?.cardIndex === card.cardIndex)] = null;
            ranked.push([card, await value(nx)]);
          }
          ranked.sort((a, b) => b[1] - a[1]);
          cardTop = ranked.slice(0, 16).map((x) => x[0]);
        }
        // Slots the Omega chips double: every card is tried there, not just the top of the ranking.
        const boosted = boostSlots(st);
        for (let i = 0; i < st.cards.length; i++) {
          const have = new Set(st.cards.map((x, k) => (k === i ? null : x?.cardIndex)).filter(Boolean));
          const pool = boosted.includes(i) && !cardsScanned ? cardPool : cardTop.concat(st.cards.filter(Boolean));
          [st, cur] = await trySlot(st, cur, 'cards', i, pool.filter((x) => !have.has(x.cardIndex)));
        }
        cardsScanned = true;
        // Then which of the chosen cards sit in the doubled slots.
        for (const b of boosted) for (let j = 0; j < st.cards.length; j++) {
          if (j === b) continue;
          const nx = clone(st); [nx.cards[b], nx.cards[j]] = [nx.cards[j], nx.cards[b]];
          const val = await value(nx);
          if (better(val, cur)) { st = nx; cur = val; }
        }
      }
      if (categories.includes('cardSet') && setPool.length) {
        for (const s of setPool) {
          if (s.rawName === st.cardSet?.rawName) continue;
          const nx = clone(st); nx.cardSet = s;
          const val = await value(nx);
          if (better(val, cur)) { st = nx; cur = val; }
        }
      }
      if (categories.includes('prayers')) for (let i = 0; i < st.prayers.length; i++) {
        const have = new Set(st.prayers.map((p, k) => (k === i ? null : p?.name)).filter(Boolean));
        [st, cur] = await trySlot(st, cur, 'prayers', i, prayerPool.filter((p) => !have.has(p.name)));
      }
      if (categories.includes('chips')) for (let i = 0; i < chipSlots; i++) {
        const ids = used(st); ids.delete(st.chips[i]?.id);
        const mine = new Set(st.chips.map((e, k) => (k === i ? null : e?.chip?.bool1 === '1' ? e.chip.index : null)).filter((x) => x != null));
        const pool = [...myChips.filter(Boolean), ...chipPool].filter((e) => !ids.has(e.id) && !mine.has(e.chip.index));
        [st, cur] = await trySlot(st, cur, 'chips', i, pool);
      }
      if (categories.includes('signs') && signPool.length) for (let i = 0; i < st.signs.length; i++) {
        const have = new Set(st.signs.map((s, k) => (k === i ? null : s?.starName)).filter(Boolean));
        [st, cur] = await trySlot(st, cur, 'signs', i, signPool.filter((s) => !have.has(s.starName)));
      }
      if (categories.includes('obols')) for (let i = 0; i < st.obols.length; i++) {
        const slot = myObols[i]?.item; if (!slot?.shape) continue;
        const ids = used(st); ids.delete(st.obols[i]?.id);
        const pool = [...myObols, ...obolPool].filter((e) => real(e.item) && !ids.has(e.id) && obolShapeOk(slot, e.item) && classOk(e.item, fam));
        [st, cur] = await trySlot(st, cur, 'obols', i, pool);
      }
      if (categories.includes('gallery') && st.trophies) for (let p = 48; p < 48 + podiums; p++) {
        // Swap this podium's trophy with any other trophy in the gallery, or put in one from outside.
        let bestSt = st, bestV2 = cur;
        const tried = new Set([st.trophies[p]]);
        for (let j = 0; j < 48 + podiums; j++) {
          const n = st.trophies[j];
          if (j === p || !(n >= 1) || tried.has(n) || (j >= 48 && podiumLevel(j) === podiumLevel(p))) continue;
          tried.add(n);
          const nx = clone(st); [nx.trophies[p], nx.trophies[j]] = [nx.trophies[j], nx.trophies[p]];
          const val = await value(nx); if (better(val, bestV2)) { bestSt = nx; bestV2 = val; }
        }
        for (const o of trophyOutside) {
          if (st.trophies.includes(o.n)) continue;
          const nx = clone(st); const old = nx.trophies[p]; nx.trophies[p] = o.n;
          const shelf = nx.trophies.findIndex((x, k) => k < 48 && !(x >= 1)); if (old >= 1 && shelf >= 0) nx.trophies[shelf] = old;
          const val = await value(nx); if (better(val, bestV2)) { bestSt = nx; bestV2 = val; }
        }
        st = bestSt; cur = bestV2;
      }
      if (categories.includes('food')) for (let i = 0; i < st.food.length; i++) {
        // A slot gets a full stack (carry cap), or what is left after the other slots of the same food.
        const left = (raw) => (foodOwned[raw] || 0) - st.food.reduce((a, f, k) => a + (k !== i && f?.raw === raw ? f.amount : 0), 0);
        const other = new Set(st.food.map((f, k) => (k !== i ? f?.raw : null)).filter(Boolean));
        const cands = Object.keys(foodOwned).filter((raw) => !other.has(raw)).map((raw) => ({ raw, amount: foodCap == null ? left(raw) : Math.min(foodCap, left(raw)) })).filter((f) => f.amount > 0);
        [st, cur] = await trySlot(st, cur, 'food', i, cands);
      }
      if (tVariants.length > 1) {
        for (const t of tVariants) { if (t === st.talent) continue; const nx = clone(st); nx.talent = t; const val = await value(nx); if (better(val, cur)) { st = nx; cur = val; } }
      }
      onProgress({ evals, pass: pass + 1 });
      if (!better(cur, before)) break;
    }
    return [st, cur];
  };

  // Drop swaps that do nothing on their own, so the list only shows moves that matter.
  const prune = async (st, cur) => {
    const keys = ['equip', 'tools', 'cards', 'prayers', 'chips', 'signs', 'obols', 'food'];
    for (const key of keys) for (let i = 0; i < st[key].length; i++) {
      if (sameEntry(key, st[key][i], init[key][i])) continue;
      const nx = clone(st); nx[key][i] = init[key][i];
      if (key !== 'food' && nx[key][i]?.id && used(st).has(nx[key][i].id)) continue;
      const val = await value(nx);
      // Changes worth under 0.01% on their own are not worth the trip.
      if (!(cur > val * (1 + 1e-4))) { st = nx; cur = val; }
    }
    if (st.cardSet?.rawName !== init.cardSet?.rawName) { const nx = clone(st); nx.cardSet = init.cardSet; const val = await value(nx); if (!(cur > val * (1 + 1e-4))) { st = nx; cur = val; } }
    return [st, cur];
  };
  const sameEntry = (key, a, b) => {
    if (key === 'food') return (a?.raw ?? null) === (b?.raw ?? null) && (a?.amount ?? 0) === (b?.amount ?? 0);
    if (key === 'cards') return (a?.cardIndex ?? null) === (b?.cardIndex ?? null);
    if (key === 'prayers') return (a?.name ?? null) === (b?.name ?? null);
    if (key === 'signs') return (a?.starName ?? null) === (b?.starName ?? null);
    if (key === 'chips') return (a?.chip?.index ?? null) === (b?.chip?.index ?? null);
    return (a?.id ?? null) === (b?.id ?? null);
  };

  onProgress({ evals, phase: 'account' });
  let [best, bestV] = await search(init);
  [best, bestV] = await prune(best, bestV);
  // What each change is worth on its own: the best setup against the best setup with only that slot put back.
  // Card presets: use one that already is this setup, otherwise the one that already holds most of these cards.
  const presets = (c.cardPresets || []).map((p, i) => ({ i, cards: Array.from({ length: 8 }, (_, k) => p?.[k]).map((x) => (x?.cardIndex ? cardPool.find((q) => q.cardIndex === x.cardIndex) || null : null)) })).filter((p) => p.cards.some(Boolean));
  const curPreset = c.selectedCardPreset ?? 0;
  const bestSet = new Set(best.cards.filter(Boolean).map((x) => x.cardIndex));
  for (const p of presets) {
    p.overlap = p.cards.filter((x) => x && bestSet.has(x.cardIndex)).length;
    const nx = clone(best); nx.cards = p.cards.slice(); p.value = await value(nx);
  }
  const same = (a, b) => a >= b * (1 - 1e-4); // within 0.01%: cards with the same bonus count as the same
  const exact = presets.filter((p) => same(p.value, bestV)).sort((a, b) => (b.i === curPreset) - (a.i === curPreset) || b.value - a.value)[0];
  let usePreset = exact || presets.slice().sort((a, b) => b.overlap - a.overlap || (b.i === curPreset) - (a.i === curPreset) || b.value - a.value)[0] || null;
  if (exact) { best = clone(best); best.cards = exact.cards.slice(); bestV = exact.value; }
  const cardBase = usePreset ? usePreset.cards.slice() : init.cards.slice();
  if (usePreset && !exact) {
    // Keep the preset's cards where they are, so only the slots that change need touching.
    const boosted = boostSlots(best);
    const out = Array(8).fill(null), placed = new Set();
    const bc = boosted.map((b) => best.cards[b]).filter(Boolean);
    for (const b of boosted) { const keep = bc.find((x) => x.cardIndex === cardBase[b]?.cardIndex); if (keep) { out[b] = keep; placed.add(keep.cardIndex); } }
    for (const b of boosted) if (!out[b]) { const nx = bc.find((x) => !placed.has(x.cardIndex)); if (nx) { out[b] = nx; placed.add(nx.cardIndex); } }
    for (let i = 0; i < 8; i++) if (!boosted.includes(i) && cardBase[i] && bestSet.has(cardBase[i].cardIndex) && !placed.has(cardBase[i].cardIndex)) { out[i] = cardBase[i]; placed.add(cardBase[i].cardIndex); }
    const rest = best.cards.filter((x) => x && !placed.has(x.cardIndex));
    for (let i = 0; i < 8; i++) if (!out[i] && !boosted.includes(i)) out[i] = rest.shift() || null;
    const nx = clone(best); nx.cards = out;
    const val = await value(nx);
    if (!better(bestV, val)) { best = nx; bestV = Math.max(bestV, val); }
    // A preset card that gives the same as the recommended one stays.
    for (let i = 0; i < 8; i++) {
      if (!cardBase[i] || best.cards[i]?.cardIndex === cardBase[i].cardIndex) continue;
      const nx2 = clone(best); nx2.cards[i] = cardBase[i];
      const v2 = await value(nx2);
      if (same(v2, bestV)) { best = nx2; bestV = v2; }
    }
  }
  // Prayers: keep what is there, take out only what hurts, and put new prayers into free or freed slots first,
  // so a prayer is only replaced when there is no room.
  {
    const want = best.prayers.filter(Boolean);
    const wantN = new Set(want.map((p) => p.name));
    const out = init.prayers.map((p) => (p && wantN.has(p.name) ? p : p));
    // Prayers the best setup drops: drop them only if that matters.
    for (let i = 0; i < out.length; i++) {
      if (!out[i] || wantN.has(out[i].name)) continue;
      const nx = clone(best); nx.prayers = out.slice(); nx.prayers[i] = null;
      const keep = clone(best); keep.prayers = out.slice();
      const [a, b] = [await value(nx), await value(keep)];
      if (a > b * (1 + 1e-9)) out[i] = null;
    }
    const have = new Set(out.filter(Boolean).map((p) => p.name));
    const add = want.filter((p) => !have.has(p.name));
    for (const p of add) {
      let k = out.findIndex((x, i) => !x && init.prayers[i]); // a slot freed above
      if (k < 0) k = out.findIndex((x) => !x); // an empty slot
      if (k < 0) k = out.findIndex((x) => x && !wantN.has(x.name)); // replace one that does nothing here
      if (k >= 0) out[k] = p;
    }
    const nx = clone(best); nx.prayers = out;
    const v = await value(nx);
    if (v >= bestV * (1 - 1e-9)) { best = nx; bestV = Math.max(bestV, v); }
  }
  const cardPresetInfo = usePreset ? { current: curPreset, use: usePreset.i, exact: !!exact, overlap: usePreset.overlap, presets: presets.length } : null;
  const worth = {};
  for (let i = 0; i < 8; i++) {
    if ((best.cards[i]?.cardIndex ?? null) === (cardBase[i]?.cardIndex ?? null)) continue;
    const nx = clone(best); nx.cards[i] = cardBase[i];
    if (cardBase[i] && nx.cards.some((x, k) => k !== i && x?.cardIndex === cardBase[i].cardIndex)) { worth['cards' + i] = null; continue; }
    const val = await value(nx);
    worth['cards' + i] = val > 0 ? bestV / val : null;
  }
  for (const key of ['equip', 'tools', 'prayers', 'chips', 'signs', 'obols', 'food']) for (let i = 0; i < best[key].length; i++) {
    if (sameEntry(key, best[key][i], init[key][i])) continue;
    const nx = clone(best); nx[key][i] = init[key][i];
    const val = await value(nx);
    worth[key + i] = val > 0 ? bestV / val : null;
  }
  if (best.cardSet?.rawName !== init.cardSet?.rawName) { const nx = clone(best); nx.cardSet = init.cardSet; const val = await value(nx); worth.cardSet = val > 0 ? bestV / val : null; }
  if (best.talent !== init.talent) { const nx = clone(best); nx.talent = init.talent; const val = await value(nx); worth.talent = val > 0 ? bestV / val : null; }

  /* Theoretical best in slot: every item in the game for gear, tools, obols and food, on top of the account's best. */
  onProgress({ evals, phase: 'bis' });
  const bisItems = { equip: {}, tools: {} };
  const allEquip = Object.keys(ITEMS || {}).map((raw) => (ITEMS[raw]?.itemType === 'Equip' ? raw : null)).filter(Boolean);
  const bisPool = allEquip.map((raw) => stonedItem(raw, fam)).filter((it) => it && classOk(it, fam)).map((it) => ({ id: 'bis-' + it.rawName, item: it, where: 'Item list' }));
  // Keychains: both lines roll the same stat, so the best roll is the top tier on both lines. Other stat names a
  // keychain can roll (Sushi Chain STR / AGI / WIS…) are taken from keychains the account owns, as long as their
  // values fit the normal tiers. Keychains whose rolls are above the tiers (gem shop Relic Chains) cannot be
  // rolled again, so they only count exactly as owned.
  const keyBis = [];
  const ownedKeys = equipPool.filter((e) => e.item.Type === 'KEYCHAIN');
  for (const raw of allEquip) {
    const base = ITEMS[raw]; if (base?.Type !== 'KEYCHAIN') continue;
    if (base.UQ2txt && base.UQ2txt !== '0') { keyBis.push(stonedItem(raw, fam)); continue; }
    const tiers = String(base.UQ1val ?? '').split(',').map(Number).filter(Number.isFinite);
    const top = Math.max(0, ...tiers);
    const stats = new Set(base.UQ1txt && base.UQ1txt !== '0' ? [base.UQ1txt] : []);
    for (const e of ownedKeys) {
      if (e.item.rawName !== raw) continue;
      for (const k of [1, 2]) { const tx = e.item['UQ' + k + 'txt'], v = num(e.item['UQ' + k + 'val']); if (tx && tx !== '0' && v <= top) stats.add(tx); }
    }
    for (const tx of stats) keyBis.push({ ...base, rawName: raw, UQ1txt: tx, UQ1val: top, UQ2txt: tx, UQ2val: top, keyRoll: true });
  }
  for (const e of ownedKeys) {
    const tiers = String(ITEMS[e.item.rawName]?.UQ1val ?? '').split(',').map(Number).filter(Number.isFinite);
    if (num(e.item.UQ1val) > Math.max(0, ...tiers) || num(e.item.UQ2val) > Math.max(0, ...tiers)) keyBis.push({ ...e.item, special: true });
  }
  for (let k = bisPool.length - 1; k >= 0; k--) if (bisPool[k].item.Type === 'KEYCHAIN') bisPool.splice(k, 1);
  keyBis.forEach((it, k) => { if (it) bisPool.push({ id: 'bis-key' + k, item: it, where: 'Item list' }); });
  let bis = clone(best), bisV = bestV;
  const bisCats = { equip: EQUIP_SLOTS, tools: TOOL_SLOTS };
  for (let pass = 0; pass < 1; pass++) {
    const before = bisV;
    for (const [key, slots] of Object.entries(bisCats)) for (let i = 0; i < slots.length && i < bis[key].length; i++) {
      if (key === 'equip' && skipEquip(i)) continue;
      const cands = bisPool.filter((p) => slots[i][1].includes(p.item.Type));
      [bis, bisV] = await trySlot(bis, bisV, key, i, cands, false);
    }
    for (let i = 0; i < bis.obols.length; i++) {
      const slot = myObols[i]?.item; if (!slot?.shape) continue;
      const cands = allEquip.filter((raw) => obolShapeOk(slot, ITEMS[raw])).map((raw) => ({ id: 'bis-' + raw, item: { ...ITEMS[raw], rawName: raw }, where: 'Item list' }));
      [bis, bisV] = await trySlot(bis, bisV, 'obols', i, cands, false);
    }
    for (let i = 0; i < bis.food.length; i++) {
      const raws = Object.keys(ITEMS || {}).filter((raw) => FOOD_TYPES.includes(ITEMS[raw]?.Type));
      const cap = foodCap ?? 1e6;
      [bis, bisV] = await trySlot(bis, bisV, 'food', i, raws.filter((raw) => !bis.food.some((f, k) => k !== i && f?.raw === raw)).map((raw) => ({ raw, amount: cap })), true);
    }
    if (bis.trophies) {
      // Every trophy in the game, on the podiums (the highest podium levels first).
      const allT = Object.keys(ITEMS || {}).map((raw) => /^Trophy(\d+)$/.exec(raw)).filter(Boolean).map((m) => Number(m[1]));
      for (let p = 48; p < 48 + podiums; p++) {
        let bs = bis, bv = bisV;
        for (const n of allT) {
          if (n === bis.trophies[p]) continue;
          const nx = clone(bis); const j = nx.trophies.indexOf(n);
          if (j >= 0) [nx.trophies[p], nx.trophies[j]] = [nx.trophies[j], nx.trophies[p]];
          else nx.trophies[p] = n;
          const v = await value(nx); if (better(v, bv)) { bs = nx; bv = v; }
        }
        bis = bs; bisV = bv;
      }
    }
    if (!better(bisV, before)) break;
  }

  /* What does something for this activity: a slot counts if emptying it changes the score. */
  const relevance = async (S, V) => {
    const rel = {};
    const test = async (k, mut) => { const nx = clone(S); mut(nx); const v = await value(nx); rel[k] = Math.abs(v - V) > Math.abs(V) * 1e-7; };
    for (let i = 0; i < S.equip.length; i++) if (!skipEquip(i) && S.equip[i]) await test('equip' + i, (n) => { n.equip[i] = null; });
    for (let i = 0; i < S.tools.length; i++) if (S.tools[i]) await test('tools' + i, (n) => { n.tools[i] = null; });
    for (let i = 0; i < S.cards.length; i++) if (S.cards[i]) await test('cards' + i, (n) => { n.cards[i] = null; });
    if (S.cardSet) await test('cardSet', (n) => { n.cardSet = null; });
    for (let i = 0; i < S.prayers.length; i++) if (S.prayers[i]) await test('prayers' + i, (n) => { n.prayers[i] = null; });
    for (let i = 0; i < S.chips.length; i++) if (S.chips[i]) await test('chips' + i, (n) => { n.chips[i] = null; });
    for (let i = 0; i < S.signs.length; i++) if (S.signs[i]) await test('signs' + i, (n) => { n.signs[i] = null; });
    for (let i = 0; i < S.obols.length; i++) if (S.obols[i]) await test('obols' + i, (n) => { n.obols[i] = null; });
    for (let i = 0; i < S.food.length; i++) if (S.food[i]) await test('food' + i, (n) => { n.food[i] = null; });
    if (S.trophies) for (let p = 48; p < 48 + podiums; p++) if (S.trophies[p] >= 1) await test('troph' + p, (n) => { n.trophies[p] = -1; });
    return rel;
  };
  // Gallery moves are account-wide: only suggest them when they are worth at least 0.01%.
  if (best.trophies && best.trophies.some((x, k) => x !== galleryRaw[16][k])) {
    const nx = clone(best); nx.trophies = galleryRaw[16].slice(); const v = await value(nx);
    if (!(bestV > v * (1 + 1e-4))) { best = nx; bestV = v; }
  }
  onProgress({ evals, phase: 'relevance' });
  const relB = await relevance(best, bestV), relS = await relevance(bis, bisV), relI = await relevance(init, base);

  /* Report ------------------------------------------------------------------------------------------ */
  // Keychains roll their stats, so the roll is part of what to look for.
  const keyRoll = (it) => {
    if (it?.Type !== 'KEYCHAIN') return null;
    const l = [1, 2].map((k) => [it['UQ' + k + 'txt'], num(it['UQ' + k + 'val'])]).filter(([tx, v]) => tx && tx !== '0' && v);
    if (!l.length) return null;
    const nm = (tx) => String(tx).replace(/^%?_/, '').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/\bAfk\b/g, 'AFK');
    const pc = (tx) => (String(tx).startsWith('%') ? '%' : '');
    return l.length === 2 && l[0][0] === l[1][0] ? `${l[0][1]}${pc(l[0][0])} / ${l[1][1]}${pc(l[0][0])} ${nm(l[0][0])}` : l.map(([tx, v]) => `${v}${pc(tx)} ${nm(tx)}`).join(' · ');
  };
  const itemView = (it) => (real(it) ? { raw: it.rawName, name: it.displayName || it.name || it.rawName, stones: it.stones || null, roll: keyRoll(it) } : null);
  const rows = [];
  const push = (cat, slot, from, to, extra = {}) => rows.push({ cat, slot, from, to, worth: worth[extra.k] ?? null, ...extra });
  EQUIP_SLOTS.forEach(([label], i) => { if (i < best.equip.length && !skipEquip(i)) push('Equipment', label, itemView(init.equip[i]?.item), itemView(best.equip[i]?.item), { k: 'equip' + i, where: best.equip[i]?.where ?? null, bis: itemView(bis.equip[i]?.item) }); });
  TOOL_SLOTS.forEach(([label], i) => { if (i < best.tools.length) push('Tools', label, itemView(init.tools[i]?.item), itemView(best.tools[i]?.item), { k: 'tools' + i, where: best.tools[i]?.where ?? null, bis: itemView(bis.tools[i]?.item) }); });
  const cardView = (x) => (x?.cardIndex ? { raw: '2Cards' + x.cardIndex, name: x.displayName || x.cardName, stars: x.stars, effect: x.effect } : null);
  best.cards.forEach((x, i) => push('Cards', `Card ${i + 1}`, cardView(cardBase[i]), cardView(x), { k: 'cards' + i, boosted: (i === 0 && best.chips.some((e) => e?.chip?.index === 20)) || (i === 7 && best.chips.some((e) => e?.chip?.index === 21)) }));
  push('Card set', 'Card set', init.cardSet?.rawName ? { raw: init.cardSet.rawName, name: init.cardSet.name } : null, best.cardSet?.rawName ? { raw: best.cardSet.rawName, name: best.cardSet.name } : null, { k: 'cardSet' });
  const prView = (p) => (p ? { raw: 'Prayer' + p.prayerIndex, name: p.name, level: p.level } : null);
  best.prayers.forEach((p, i) => push('Prayers', `Prayer ${i + 1}`, prView(init.prayers[i]), prView(p), { k: 'prayers' + i }));
  const chipView = (e) => (e?.chip ? { raw: 'ConsoleChip' + e.chip.index, name: e.chip.name } : null);
  best.chips.forEach((e, i) => push('Lab chips', `Chip ${i + 1}`, chipView(init.chips[i]), chipView(e), { k: 'chips' + i, where: e?.where ?? null }));
  if (signPool.length) best.signs.forEach((s, i) => push('Star signs', `Star sign ${i + 1}`, s ? null : null, s ? { raw: null, name: s.starName } : null, { k: 'signs' + i, fromName: init.signs[i]?.starName ?? null }));
  best.obols.forEach((e, i) => push('Obols', `${myObols[i]?.item?.shape || ''} obol`, itemView(init.obols[i]?.item), itemView(e?.item), { k: 'obols' + i, where: e?.where ?? null, bis: itemView(bis.obols[i]?.item) }));
  const foodView = (f) => (f ? { raw: f.raw, name: ITEMS?.[f.raw]?.displayName || f.raw, amount: f.amount } : null);
  best.food.forEach((f, i) => push('Food', `Food ${i + 1}`, foodView(init.food[i]), foodView(f), { k: 'food' + i, where: f ? foodWhere[f.raw] || null : null, bis: foodView(bis.food[i]) }));
  for (const r of rows) r.changed = JSON.stringify([r.from?.raw, r.from?.amount, r.from?.roll, r.fromName]) !== JSON.stringify([r.to?.raw, r.to?.amount, r.to?.roll, r.fromName === undefined ? undefined : r.to?.name]) && !(r.cat === 'Star signs' && r.fromName === r.to?.name);
  for (const r of rows) if (r.cat === 'Star signs') { r.from = r.fromName ? { name: r.fromName } : null; r.changed = (r.fromName ?? null) !== (r.to?.name ?? null); }
  // Only what does something for this activity: the recommended thing counts, or what is there now does.
  for (const r of rows) r.relevant = r.changed || !!relB[r.k] || !!relI[r.k];
  // Identical obol changes (same obol out, same obol in, same place) are one row.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (r.cat !== 'Obols' || !r.changed || r.merged) continue;
    const same = rows.filter((x, j) => j > i && x.cat === 'Obols' && x.changed && !x.merged && x.from?.raw === r.from?.raw && x.to?.raw === r.to?.raw && x.where === r.where);
    if (!same.length) continue;
    same.forEach((x) => { x.merged = true; });
    r.count = same.length + 1;
    const idx = [r, ...same].map((x) => Number(x.k.slice(5)));
    const nx = clone(best); idx.forEach((k) => { nx.obols[k] = init.obols[k]; });
    const v = await value(nx); r.worth = v > 0 ? bestV / v : null;
    r.slot = `${r.slot} ×${r.count}`;
  }
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].merged) rows.splice(i, 1);

  /* Boards: the setup laid out like the sampling best-in-slot boards, with a tooltip for every slot. */
  const pretty = (s) => String(s ?? '').replace(/_/g, ' ');
  const titleCase = (s) => pretty(s).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/\b(Afk|Exp|Hp|Mp|Str|Agi|Wis|Luk)\b/g, (m) => m.toUpperCase());
  const n2 = (v) => { const x = Number(v); return Number.isFinite(x) ? (Math.round(x * 100) / 100).toLocaleString('en-US') : String(v); };
  const uqLine = (txt, val) => (!txt || txt === '0' || !Number(val) ? null : `+${n2(val)}${String(txt).startsWith('%') ? '%' : ''} ${titleCase(String(txt).replace(/^%_?/, ''))}`);
  const effLine = (eff, val) => (eff ? pretty(String(eff).replace('{', n2(val))).replace(/\*.*$/, '').trim() : null);
  const itemTip = (it, type) => {
    const st = ['Weapon_Power', 'STR', 'AGI', 'WIS', 'LUK', 'Defence'].filter((k) => num(it[k])).map((k) => `${pretty(k)} ${n2(it[k])}`).join(' · ');
    const lines = [st, uqLine(it.UQ1txt, it.UQ1val), uqLine(it.UQ2txt, it.UQ2val)];
    if (it.Effect && it.Amount != null && /FOOD/.test(it.Type || '')) lines.push(`${titleCase(it.Effect)}: ${n2(it.Amount)}`);
    if (num(it.lvReqToEquip) > 1) lines.push(`Level ${n2(it.lvReqToEquip)} to equip`);
    if (it.stones) lines.push(`With ${it.stones.count} × ${pretty(ITEMS?.[it.stones.raw]?.displayName || it.stones.raw)}`);
    return { title: pretty(it.displayName || it.name || it.rawName), type: type || titleCase(it.Type || ''), lines: lines.filter(Boolean) };
  };
  const cell = (raw, tip, nowName, where, same, extraSv = []) => (raw ? { raw, tip, same, sv: [same ? 'Already like this' : nowName ? `Now: ${nowName}` : 'Now: empty', where && !same ? `Where: ${typeof where === 'string' ? where : Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k).join(', ')}` : null, ...extraSv].filter(Boolean) } : null);
  const eqName = (e) => (e?.item && real(e.item) ? pretty(e.item.displayName || e.item.rawName) : null);
  const boardFor = (S, isBis, rel) => {
    const groups = [];
    const equipCell = (i) => {
      if (skipEquip(i) || !rel['equip' + i]) return null;
      const e = S.equip[i]; if (!e || !real(e.item)) return null;
      return cell(e.item.rawName, itemTip(e.item, EQUIP_SLOTS[i][0]), eqName(init.equip[i]), e.where, e.item.rawName === init.equip[i]?.item?.rawName);
    };
    groups.push({ cat: 'Equipment', cols: 2, cells: [0, 1, 2, 3, 4, 5, 6, 7].map(equipCell) });
    groups.push({ cat: 'Specials', cols: 2, cells: [8, 9, 10, 11, 12, 13, 14, 15].map(equipCell) });
    groups.push({ cat: 'Tools', cols: 2, cells: TOOL_SLOTS.map((ts, i) => { const e = S.tools[i]; return e && real(e.item) && rel['tools' + i] ? cell(e.item.rawName, itemTip(e.item, ts[0]), eqName(init.tools[i]), e.where, e.item.rawName === init.tools[i]?.item?.rawName) : null; }) });
    const boosted = boostSlots(S);
    const cardCell = (x, i) => {
      if (!x?.cardIndex || !rel['cards' + i]) return null;
      const val = (x.bonus || 0) * ((x.stars ?? -1) + 1) * (boosted.includes(i) ? 2 : 1) * legend;
      const base = cardBase[i];
      return cell('2Cards' + x.cardIndex, { title: pretty(x.displayName || x.cardName), type: `${x.stars ?? 0}★`, lines: [effLine(x.effect, val), boosted.includes(i) ? 'Doubled by the Omega chip in this slot' : null].filter(Boolean) }, base ? pretty(base.displayName || base.cardName) : null, null, base?.cardIndex === x.cardIndex);
    };
    const set = S.cardSet?.rawName && rel.cardSet ? cell(S.cardSet.rawName, { title: pretty(S.cardSet.name), type: 'Set bonus', lines: [effLine(S.cardSet.effect, S.cardSet.bonus)].filter(Boolean) }, init.cardSet?.name ? pretty(init.cardSet.name) : null, null, S.cardSet.rawName === init.cardSet?.rawName) : null;
    groups.push({ cat: 'Cards', set, cards: Array.from({ length: 8 }, (_, i) => cardCell(S.cards[i], i)), preset: cardPresetInfo });
    const prTip = (p) => { let r = null; try { r = getPrayerBonusAndCurse([p], p.name, A); } catch (e) {} return { title: pretty(p.name), type: `Level ${p.level}`, lines: [effLine(p.effect, r?.bonus ?? '{'), p.curse ? 'Curse: ' + effLine(p.curse, r?.curse ?? '{') : null].filter(Boolean) }; };
    groups.push({ cat: 'Prayers', cols: 2, cells: S.prayers.map((p, i) => (p && rel['prayers' + i] ? cell('Prayer' + p.prayerIndex, prTip(p), init.prayers[i] ? pretty(init.prayers[i].name) : null, null, init.prayers.some((q) => q?.name === p.name)) : null)) });
    groups.push({ cat: 'Chips', cols: 2, cells: S.chips.map((e, i) => (e?.chip && rel['chips' + i] ? cell('ConsoleChip' + e.chip.index, { title: pretty(e.chip.name), type: 'Lab chip', lines: [effLine(e.chip.bonus, e.chip.baseVal)].filter(Boolean) }, init.chips[i]?.chip ? pretty(init.chips[i].chip.name) : null, e.where, init.chips.some((q) => q?.chip?.index === e.chip.index)) : null)) });
    // Obols: one cell per distinct obol (same obol, same place, same status), with how many.
    const ob = [];
    S.obols.forEach((e, i) => {
      if (!e || !real(e.item) || !rel['obols' + i]) return;
      const same = e.item.rawName === init.obols[i]?.item?.rawName;
      const key = e.item.rawName + '|' + (same ? '' : e.where) + '|' + same + '|' + (same ? '' : init.obols[i]?.item?.rawName);
      const hit = ob.find((x) => x.key === key);
      if (hit) { hit.count++; return; }
      ob.push({ key, count: 1, ...cell(e.item.rawName, itemTip(e.item, `${myObols[i]?.item?.shape || ''} obol`), eqName(init.obols[i]), e.where, same) });
    });
    groups.push({ cat: 'Obols', cols: 3, cells: ob });
    groups.push({ cat: 'Food', cols: 2, cells: S.food.map((f, i) => (f && rel['food' + i] ? cell(f.raw, { ...itemTip({ ...ITEMS[f.raw], rawName: f.raw }, 'Food'), lines: [...itemTip({ ...ITEMS[f.raw], rawName: f.raw }, 'Food').lines, `Stack: ${n2(f.amount)}`] }, init.food[i] ? pretty(ITEMS?.[init.food[i].raw]?.displayName) : null, isBis ? null : foodWhere[f.raw], init.food.some((g) => g?.raw === f.raw)) : null)) });
    if (S.trophies && podiums) {
      groups.push({ cat: 'Gallery podiums', cols: 4, cells: Array.from({ length: podiums }, (_, k) => {
        const n = S.trophies[48 + k]; if (!(n >= 1) || !rel['troph' + (48 + k)]) return null;
        const raw = 'Trophy' + n, it = { ...ITEMS[raw], rawName: raw };
        const was = galleryRaw[16][48 + k];
        const fromShelf = galleryRaw[16].indexOf(n);
        const where = fromShelf < 0 ? (trophyOutside.find((o) => o.n === n)?.where || null) : fromShelf < 48 ? 'Gallery shelf' : `Gallery podium ${fromShelf - 47} (level ${podiumLevel(fromShelf)})`;
        const owns = fromShelf >= 0 || trophyOutside.some((o) => o.n === n);
        return { ...cell(raw, itemTip(it, `Trophy · level ${podiumLevel(48 + k)} podium`), was >= 1 ? pretty(ITEMS?.['Trophy' + was]?.displayName) : null, isBis && !owns ? null : where, fromShelf >= 48 && podiumLevel(fromShelf) === podiumLevel(48 + k), [isBis && !owns ? 'You do not own this trophy' : null, 'Changes the gallery for every character'].filter(Boolean)), tier: podiumLevel(48 + k) };
      }) });
    }
    // Only what does something for this activity.
    return groups.map((g) => (g.cat === 'Cards' ? g : { ...g, cells: g.cells.filter(Boolean) })).filter((g) => (g.cat === 'Cards' ? g.set || g.cards.some(Boolean) : g.cells.length));
  };
  const boards = { account: boardFor(best, false, relB), bis: boardFor(bis, true, relS) };
  const galleryMoves = best.trophies ? Array.from({ length: podiums }, (_, k) => ({ k, level: podiumLevel(48 + k), from: galleryRaw[16][48 + k], to: best.trophies[48 + k] })).filter((x) => x.from !== x.to).map((x) => ({ ...x, fromName: pretty(ITEMS?.['Trophy' + x.from]?.displayName), toName: pretty(ITEMS?.['Trophy' + x.to]?.displayName) })) : [];
  let galleryWorth = null;
  if (galleryMoves.length) { const nx = clone(best); nx.trophies = galleryRaw[16].slice(); const val = await value(nx); galleryWorth = val > 0 ? bestV / val : null; }

  const partsOf = (st) => { try { const { v, acc, chars } = build(st); return act.parts ? act.parts(v, chars, acc) : null; } catch (e) { return null; } };
  return {
    parts: act.parts ? { now: partsOf(init), best: partsOf(best), bis: partsOf(bis) } : null, partUnits: act.partUnits || null,
    activity: activityKey, char: c.name, cls: c.class, family: fam,
    current: own ?? base, base, best: bestV, gain: bestV / base, bis: bisV, bisGain: bisV / base,
    talent: { from: init.talent, to: best.talent, worth: worth.talent ?? null }, cardPreset: cardPresetInfo, boards, gallery: galleryRaw ? { checked: true, podiums, moves: galleryMoves, worth: galleryWorth } : null, foodCap, foodSlots, rows, notes, evals, ms: Date.now() - t0,
  };
};
