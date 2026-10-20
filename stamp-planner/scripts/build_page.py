"""Assemble index.html from src/page-head.html + src/page-body.html.

Inlines every stamp icon, the icon of each stamp's required material and the
30 coin icons as data URIs, taken from IdleonToolbox's public/data folder.
No save data is embedded: the page starts empty and the user imports their own.

Usage: python3 scripts/build_page.py <IdleonToolbox dir> <repo root>
"""
import base64
import json
import os
import sys

toolbox, root = sys.argv[1], sys.argv[2]
images_dir = os.path.join(toolbox, 'public', 'data')

stamps = json.load(open(os.path.join(toolbox, 'data', 'website-data', 'stamps.json'), encoding='utf-8'))
names = set()


def walk(node):
    if isinstance(node, dict):
        raw = str(node.get('rawName', ''))
        if raw.startswith('Stamp'):
            names.add(raw)
            for item in node.get('itemReq') or []:
                if isinstance(item, dict) and item.get('rawName'):
                    names.add(item['rawName'])
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for value in node:
            walk(value)


walk(stamps)
names.update(f'Coins{i}' for i in range(1, 31))
names.update(['Particle', 'GildedStamp', 'MeritBon14'])  # atom and Gilded Stamp icons for the reduction buttons

images = {}
for name in sorted(names):
    # src/icons overrides the Toolbox image (e.g. the Hydrogen atom, cropped to its visible part)
    override = os.path.join(root, 'src', 'icons', f'{name}.png')
    path = override if os.path.exists(override) else os.path.join(images_dir, f'{name}.png')
    if not os.path.exists(path):
        path = os.path.join(toolbox, 'public', 'etc', f'{name}.png')
    if os.path.exists(path):
        with open(path, 'rb') as fh:
            images[name] = 'data:image/png;base64,' + base64.b64encode(fh.read()).decode()
    else:
        print(f'warning: no image for {name}', file=sys.stderr)

head = open(os.path.join(root, 'src', 'page-head.html'), encoding='utf-8').read()
body = open(os.path.join(root, 'src', 'page-body.html'), encoding='utf-8').read()
reset = ('<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);'
         'padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.5 system-ui,sans-serif}'
         'img{max-width:100%}[hidden]{display:none!important}</style>\n')
head = head.replace('</title>', '</title>\n' + reset, 1)
body = body.replace('__DATA__', 'null').replace('__IMGS__', json.dumps(images, separators=(',', ':')))

html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + head + '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
with open(os.path.join(root, 'index.html'), 'w', encoding='utf-8') as fh:
    fh.write(html)
print(f'index.html written with {len(images)} icons')
