#!/usr/bin/env bash
# Small fixes applied to the IdleonToolbox checkout before bundling. Each one is checked so a changed
# upstream file fails the build instead of silently skipping the fix.
# Usage: scripts/it-fixes.sh <IdleonToolbox dir>
set -euo pipefail
TB="$1"
EFF="$TB/parsers/efficiency.ts"

# 1. "Base efficiency for all skills" (AllBaseSkillEff) should read the Galvanic Processor chip (index 13,
#    "+{ Base Efficiency for all skills"), not the Galvanic Motherboard (index 11, "% Total Skilling
#    Efficiency", which is already counted in the % group). Checked against Corgan's idleon-research-optimizer.
if ! grep -q "KIMFIX-base-eff-chip" "$EFF"; then
  python3 - "$EFF" <<'PY'
import sys, re
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
start = t.index('export const getAllBaseSkillEffBreakdown')
end = t.index('return sumGroup', start)
seg = t[start:end]
old = "find((chip: any) => chip.index === 11)?.baseVal ?? 0;"
assert seg.count(old) == 1, 'base efficiency chip line not found'
seg = seg.replace(old, "find((chip: any) => chip.index === 13)?.baseVal ?? 0; // KIMFIX-base-eff-chip")
open(p, 'w', encoding='utf-8').write(t[:start] + seg + t[end:])
PY
fi
# 2. Chips that can be equipped more than once count once per copy in the game; efficiency.ts only finds the
#    first one. Sum every copy (as getPlayerLabChipBonus does) for the efficiency chips.
if ! grep -q "KIMFIX-chip-sum" "$EFF"; then
  python3 - "$EFF" <<'PY'
import sys, re
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
pat = re.compile(r"account\?\.lab\?\.playersChips\?\.\[character\?\.playerId\]\?\.find\(\(chip: any\) => chip\.index === (\d+)\)\?\.baseVal \?\? 0;")
n = 0
def rep(m):
    global n; n += 1
    return "(account?.lab?.playersChips?.[character?.playerId] ?? []).reduce((s: number, chip: any) => s + (chip?.index === %s ? (chip?.baseVal ?? 0) : 0), 0); // KIMFIX-chip-sum" % m.group(1)
t = pat.sub(rep, t)
assert n >= 2, 'chip lines not found: %d' % n
open(p, 'w', encoding='utf-8').write(t)
PY
fi
echo "IdleonToolbox fixes applied"
