#!/usr/bin/env python3
"""Builds htdocs/luci-static/omarchy/icons-3.woff2 from a Symbols Nerd Font.

Keeps only the glyphs menu-omarchy.js, omarchy-home.js and omarchy.css ask for. Needs fonttools
with brotli, and the font from the NerdFontsSymbolsOnly archive of a Nerd Fonts
release:

    tools/gen-icons.py /path/to/SymbolsNerdFont-Regular.ttf

Only Material Design Icons are used, so that one licence covers the glyphs.
When a glyph changes, raise the number in the file name and in omarchy.css: a
stylesheet cannot stamp the URL of its font, and browsers keep fonts for long.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / 'htdocs/luci-static'


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    js = (STATIC / 'resources/menu-omarchy.js').read_text() + (STATIC / 'resources/omarchy-home.js').read_text()
    css = (STATIC / 'omarchy/omarchy.css').read_text()
    codes = set(re.findall(r'0x(F[0-9A-F]{4})', js)) | set(re.findall(r'content: "\\(F[0-9A-F]{4})"', css))
    subprocess.run([
        'pyftsubset', sys.argv[1], '--unicodes=' + ','.join(sorted(codes)), '--flavor=woff2',
        '--output-file=' + str(STATIC / 'omarchy/icons-3.woff2'), '--no-hinting', '--desubroutinize',
        '--layout-features=', '--name-IDs=1,2,4,6,13,14',
    ], check=True)
    print(len(codes), 'glyphs')


if __name__ == '__main__':
    main()
