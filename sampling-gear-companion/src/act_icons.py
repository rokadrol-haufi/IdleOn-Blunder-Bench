"""Icons for the activity tabs: every equipment item, tool, obol, food, card, card set, prayer and lab chip.
Small WebP (at most 36 px) so the page stays light. Usage: TB=<IdleonToolbox> OUT=data python3 src/act_icons.py"""
import json, base64, io, os, glob
from PIL import Image
TB = os.environ.get('TB', '.build/IdleonToolbox'); IMG = TB + '/public/data/'
items = json.load(open(TB + '/data/website-data/items.json'))
TYPES = {'HELMET','SPEAR','BOW','WAND','FISTICUFF','SWORD','SHIRT','PENDANT','PANTS','RING','SHOES','PREMIUM_HELMET','KEYCHAIN','TROPHY','REPLICA_TROPHY',
         'CAPE','CHAT_RING','NAMETAG','REPLICA_NAMETAG','ATTIRE','PICKAXE','HATCHET','FISHING_ROD','BUG_CATCHING_NET','TRAP_BOX_SET','WORSHIP_SKULL','DNA_SPLICER',
         'CIRCLE_OBOL','SQUARE_OBOL','HEXAGON_OBOL','SPARKLE_OBOL','GOLDEN_FOOD','BOOST_FOOD'}
names = [k for k, v in items.items() if v.get('Type') in TYPES]
for pat in ['2Cards*.png', 'CardSet*.png', 'Prayer[0-9]*.png', 'ConsoleChip[0-9]*.png', 'StoneW9.png', 'StoneA8.png', 'StoneT8.png']:
    names += [os.path.basename(f)[:-4] for f in glob.glob(IMG + pat)]
out = {}
for raw in sorted(set(names)):
    p = IMG + raw + '.png'
    if not os.path.exists(p): continue
    try:
        im = Image.open(p).convert('RGBA'); bb = im.getbbox(); im = im.crop(bb) if bb else im
        if max(im.size) > 36: im.thumbnail((36, 36), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'WEBP', quality=82, method=6)
        out[raw] = 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
    except Exception as e:
        print('skip', raw, e)
json.dump(out, open(os.environ.get('OUT', 'data') + '/act-icons.json', 'w'), separators=(',', ':'))
print(len(out), 'icons', sum(len(v) for v in out.values()) // 1000, 'KB')
