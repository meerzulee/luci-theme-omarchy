#!/usr/bin/env python3
"""Generate the palette layer of luci-theme-omarchy from Omarchy colors.toml files.

Reads   palettes/<id>.toml                       (vendored from omacom/omarchy, MIT)
        backdrops.toml                           colour grids of the wallpapers, optional
Writes  htdocs/luci-static/omarchy/palettes.css  one token block per palette
        htdocs/luci-static/resources/omarchy-palettes.js   palette list for the UI
        root/etc/uci-defaults/30_luci-theme-omarchy         theme registration
        htdocs/luci-static/omarchy-<id>, ucode/template/themes/omarchy-<id>
                                                 symlink aliases, one per palette

The base stylesheet (base.css) is an unmodified copy of luci-theme-bootstrap's
cascade.css. Its colours come from custom properties declared on :root, most of
them as "h, s%, l%" or "r, g, b" component lists. Every palette block overrides
those properties, so the base file never needs editing.

Run with --check to verify that the committed outputs are up to date.
"""
import argparse
import base64
import colorsys
import math
import json
import os
import re
import struct
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PALETTES = ROOT / 'palettes'
BACKDROPS = ROOT / 'backdrops.toml'
MEDIA = ROOT / 'htdocs/luci-static/omarchy'
STATIC = ROOT / 'htdocs/luci-static'
TEMPLATES = ROOT / 'ucode/template/themes'
DEFAULT = 'tokyo-night'

# Keys every Omarchy palette defines as "#rrggbb" (verified across the vendored set).
REQUIRED = [
    'accent', 'selection', 'muted',
    'background', 'dark_background', 'darker_background', 'lighter_background',
    'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground',
    'red', 'yellow', 'green', 'cyan', 'blue', 'magenta',
]

# Properties base.css declares on :root that a palette does not set directly,
# because the base file derives them from properties the palette does set.
DERIVED_BY_BASE = {
    '--background-color-high', '--background-color-medium', '--background-color-low',
    '--text-color-highest', '--text-color-high', '--text-color-medium', '--text-color-low',
    '--border-color-high', '--border-color-medium', '--border-color-low',
    '--border-color-h', '--border-color-s', '--border-color-l',
    '--error-color-high', '--success-color-high',
}
# Set once for every palette by omarchy.css, not per palette.
SET_BY_SKIN = {'--font-sans', '--font-mono'}

HEX = re.compile(r'^#[0-9a-fA-F]{6}$')

# The backdrop is a grid of colours, drawn as a tiny bitmap and blurred by the browser.
WALL_COLUMNS, WALL_ROWS = 8, 5
# A wallpaper whose cells differ by less than this in luminance reads as flat black or
# white behind the windows, so it gets the palette's own glows.
WALL_FLAT = 0.12
# Omarchy's frosted glass (default/hypr/glass.lua): brightness 0.75, vibrancy 0.35.
WALL_BRIGHTNESS = 0.75
WALL_VIBRANCY = 1.35
# How far the treated backdrop may stray from a readable ground.
WALL_LIMIT_DARK = 0.26
WALL_LIMIT_LIGHT = 0.50
# Opacity of the palette background over the backdrop: the most see-through value
# at which all text stays readable and dim text stays visibly dimmer than text.
WINDOW_ALPHAS = (0.80, 0.84, 0.88, 0.92, 0.96)
# The same over a picture the user picks, which can be anything: solved against
# a white backdrop for dark palettes and a black one for light palettes.
SAFE_ALPHAS = (0.84, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 1.00)
POPUP_ALPHA = 0.95
DIM_DISTINCT = 1.2


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def to_hex(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)


def mix(a, b, t):
    """Blend a toward b by t (0..1) in sRGB, as Omarchy's own templates do."""
    ra, rb = rgb(a), rgb(b)
    return to_hex(tuple(ra[i] * (1 - t) + rb[i] * t for i in range(3)))


def luminance(h):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def hsl_parts(h):
    r, g, b = (v / 255 for v in rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, ss * 100, ll * 100


def num(v):
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


def hsl_list(h):
    hh, ss, ll = hsl_parts(h)
    return f'{num(hh)}, {num(ss)}%, {num(ll)}%'


def rgb_list(h):
    return ', '.join(str(v) for v in rgb(h))


def toward(colour, target, against, minimum, step=0.05, limit=1.0):
    """Move colour toward target until its contrast against `against` reaches minimum."""
    t, out = 0.0, colour
    while contrast(out, against) < minimum and t < limit:
        t = min(limit, t + step)
        out = mix(colour, target, t)
    return out


def dimmest(colour, bg, ground, minimum, most):
    """The dimmest blend of colour into bg that keeps `minimum` contrast against ground."""
    t = most
    while t > 0:
        out = mix(colour, bg, t)
        if contrast(out, ground) >= minimum:
            return out
        t = round(t - 0.05, 2)
    return colour


def scale(colour, factor):
    return to_hex(tuple(v * factor for v in rgb(colour)))


def saturate(colour, factor):
    r, g, b = (v / 255 for v in rgb(colour))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return to_hex(tuple(v * 255 for v in colorsys.hls_to_rgb(hh, ll, min(1.0, ss * factor))))


def glow(u, v, centre_u, centre_v, reach):
    return max(0.0, 1 - math.hypot(u - centre_u, v - centre_v) / reach) ** 2


def backdrop(p, rows):
    """The grid behind the windows: the wallpaper's colours, toned so text can sit over them."""
    dark = p['mode'] == 'dark'
    cells = [['#' + c.lower() for c in row.split()] for row in rows] if rows else [[p['background']] * WALL_COLUMNS] * WALL_ROWS
    if len(cells) != WALL_ROWS or any(len(row) != WALL_COLUMNS for row in cells):
        sys.exit(f'backdrops.toml: expected {WALL_ROWS} rows of {WALL_COLUMNS} colours')

    levels = [luminance(c) for row in cells for c in row]
    if max(levels) - min(levels) < WALL_FLAT:
        cells = [[
            mix(mix(c, p['accent'], 0.70 * glow((x + 0.5) / WALL_COLUMNS, (y + 0.5) / WALL_ROWS, 0.12, 0.08, 0.95)),
                p['magenta'], 0.60 * glow((x + 0.5) / WALL_COLUMNS, (y + 0.5) / WALL_ROWS, 0.90, 0.96, 0.90))
            for x, c in enumerate(row)] for y, row in enumerate(cells)]

    def tone(colour):
        colour = saturate(colour, WALL_VIBRANCY)
        if dark:
            colour = scale(colour, WALL_BRIGHTNESS)
            while luminance(colour) > WALL_LIMIT_DARK:
                colour = scale(colour, 0.96)
        else:
            colour = mix(colour, '#ffffff', 0.25)
            while luminance(colour) < WALL_LIMIT_LIGHT:
                colour = mix(colour, '#ffffff', 0.05)
        return colour

    return [[tone(c) for c in row] for row in cells]


def wall_image(cells):
    """The grid as an uncompressed 24-bit BMP in a data URI: smaller than a stack of gradients."""
    pixels = b''.join(bytes(reversed(rgb(c))) for row in reversed(cells) for c in row)
    header = struct.pack('<2sIHHI', b'BM', 54 + len(pixels), 0, 0, 54)
    info = struct.pack('<IiiHHIIiiII', 40, WALL_COLUMNS, WALL_ROWS, 1, 24, 0, len(pixels), 2835, 2835, 0, 0)
    return 'url("data:image/bmp;base64,%s")' % base64.b64encode(header + info + pixels).decode()


def best_on(fills, candidates, minimum=4.5):
    """Text colour for a filled control: first candidate readable on every fill."""
    def worst(c):
        return min(contrast(c, f) for f in fills)
    for c in candidates:
        if worst(c) >= minimum:
            return c
    return max(candidates, key=worst)


def load(path):
    raw = tomllib.loads(path.read_text())
    missing = [k for k in REQUIRED if not HEX.match(str(raw.get(k, '')))]
    if missing:
        sys.exit(f'{path.name}: missing or non-hex keys: {", ".join(missing)}')
    p = {k: raw[k].lower() for k in REQUIRED}
    # `orange` is absent from a few palettes.
    orange = raw.get('orange')
    p['orange'] = orange.lower() if HEX.match(str(orange or '')) else mix(p['red'], p['yellow'], 0.5)
    mode = raw.get('mode')
    if mode not in ('dark', 'light'):
        mode = 'light' if luminance(p['background']) > 0.18 else 'dark'
    p['mode'] = mode
    return p


def derive(p, rows):
    """Pick the most see-through window that keeps every text colour readable over the backdrop."""
    wall = backdrop(p, rows)
    for alpha in WINDOW_ALPHAS:
        tokens, checks = derive_at(p, wall, alpha)
        if all(value + 1e-9 >= minimum for value, minimum in checks.values()):
            break
    return tokens, checks, alpha


def derive_at(p, wall, alpha):
    """Map an Omarchy palette onto bootstrap's tokens plus the skin's --o-* set."""
    dark = p['mode'] == 'dark'
    bg = p['background']

    # What text sits on: a window over the backdrop cell that takes the most contrast away.
    ground = (max if dark else min)((mix(c, bg, alpha) for row in wall for c in row), key=luminance)

    # Omarchy's foreground shade names follow lightness, not emphasis, so they
    # swap meaning between dark and light palettes. Rank by contrast instead.
    text_highest = max((p['bright_foreground'], p['foreground'], p['light_foreground']),
                       key=lambda c: contrast(c, ground))
    text_high = p['foreground'] if contrast(p['foreground'], ground) >= 4.5 else text_highest
    text_medium = dimmest(text_high, bg, ground, 4.5, 0.30)
    text_low = dimmest(text_high, bg, ground, 3.0, 0.55)
    # Fields and highlighted rows lay the text colour over the window, as Omarchy's controls do.
    raised = mix(ground, text_high, 0.08)

    bg_medium = mix(bg, p['lighter_background'], 0.35)
    bg_low = mix(bg, p['lighter_background'], 0.60)

    border_high = p['muted']
    if contrast(border_high, bg) < 1.6:
        border_high = toward(border_high, text_high, bg, 1.6)
    while contrast(border_high, bg) > 4.5:
        border_high = mix(border_high, bg, 0.1)
    border_medium = mix(bg, border_high, 0.60)
    border_low = mix(bg, border_high, 0.35)

    on_candidates = [bg, p['darker_background'], text_highest, '#000000', '#ffffff']

    def family(base, text_min):
        """A fill colour, two stronger shades of it, and a text colour readable on all three.

        `text_min` is the contrast the fill itself needs against the page when it
        doubles as a text colour. Where the palette colour is a mid-tone that
        neither light nor dark text reads on, the fill is moved away from its
        text colour just far enough, and the shades continue in that direction.
        """
        start = toward(base, text_highest, raised, text_min) if text_min else base
        # Palette colours that already read on the fill come first, in their
        # listed order; pure black and white are the last resort.
        ranked = sorted(on_candidates, key=lambda c: (contrast(c, start) < 4.5, 0 if contrast(c, start) >= 4.5 else -contrast(c, start)))
        for on in ranked:
            away = max((bg, text_highest), key=lambda c: abs(luminance(c) - luminance(on)))
            high = toward(start, away, on, 4.5, step=0.03, limit=0.6)
            if contrast(on, high) >= 4.5 and contrast(high, raised) >= text_min:
                break
        else:
            on = ranked[0]
            away = max((bg, text_highest), key=lambda c: abs(luminance(c) - luminance(on)))
            high = start
        return high, mix(high, away, 0.10), mix(high, away, 0.20), on

    primary = family(p['accent'], 4.5)   # also the link colour
    error = family(p['red'], 4.0)        # also text of negative buttons
    success = family(p['green'], 4.0)    # also text of positive buttons
    warn = family(p['yellow'], 0)        # only ever a fill

    t = {
        'color-scheme': p['mode'],
        '--background-color-delta-l-sign': '1' if dark else '-1',
        '--text-color-delta-l-sign': '-1' if dark else '1',
        '--border-color-delta-l-sign': '1' if dark else '-1',
        '--disabled-opacity': '.4' if dark else '.7',
    }
    for name, colour in (('background', bg), ('text', text_highest)):
        hh, ss, ll = hsl_parts(colour)
        t[f'--{name}-color-h'] = num(hh)
        t[f'--{name}-color-s'] = num(ss) + '%'
        t[f'--{name}-color-l'] = num(ll) + '%'
    for name, colour in (
        ('background-color-high', bg), ('background-color-medium', bg_medium), ('background-color-low', bg_low),
        ('text-color-highest', text_highest), ('text-color-high', text_high),
        ('text-color-medium', text_medium), ('text-color-low', text_low),
        ('border-color-high', border_high), ('border-color-medium', border_medium), ('border-color-low', border_low),
    ):
        t[f'--{name}-hsl'] = hsl_list(colour)
    for name, (high, medium, low, on) in (('primary', primary), ('warn', warn)):
        t[f'--{name}-color-high'] = high
        t[f'--{name}-color-medium'] = medium
        t[f'--{name}-color-low'] = low
        t[f'--on-{name}-color'] = on
    for name, (high, medium, low, on) in (('error', error), ('success', success)):
        t[f'--{name}-color-high-rgb'] = rgb_list(high)
        t[f'--{name}-color-medium'] = medium
        t[f'--{name}-color-low'] = low
        t[f'--on-{name}-color'] = on

    # Raw palette colours for omarchy.css.
    t['--o-mode'] = p['mode']
    for name, key in (
        ('bg-dark', 'dark_background'), ('bg-darker', 'darker_background'), ('bg-light', 'lighter_background'),
        ('selection', 'selection'), ('accent', 'accent'),
        ('red', 'red'), ('orange', 'orange'), ('yellow', 'yellow'), ('green', 'green'),
        ('cyan', 'cyan'), ('blue', 'blue'), ('magenta', 'magenta'),
    ):
        t[f'--o-{name}'] = p[key]
    # The keys of the fastfetch window, in the colours Omarchy's fastfetch config
    # gives its hardware, software and time groups.
    keys = [toward(p[c], text_highest, raised, 4.5) for c in ('green', 'blue', 'magenta')]
    t['--o-key-hw'], t['--o-key-sw'], t['--o-key-age'] = keys
    # Text placed on the accent colour itself (active bar items, selection).
    t['--o-on-accent'] = best_on((p['accent'],), on_candidates)

    # Glass: what the windows, the bar and the popups are made of.
    t['--o-wall'] = wall_image(wall)
    t['--o-glass'] = f'rgba({rgb_list(bg)}, {alpha:.2f})'
    t['--o-pop'] = f'rgba({rgb_list(bg)}, {max(alpha, POPUP_ALPHA):.2f})'

    # The same two for a wallpaper of the user's.
    worst = '#ffffff' if dark else '#000000'

    def holds(a):
        floor = mix(worst, bg, a)
        lit = mix(floor, text_high, 0.08)
        return (contrast(text_high, floor) >= 4.5 and contrast(text_medium, floor) >= 4.5
                and contrast(text_low, floor) >= 3.0 and contrast(text_high, lit) >= 4.5
                and contrast(primary[0], lit) >= 4.5
                and all(contrast(k, lit) >= 4.5 for k in keys))

    safe = next((a for a in SAFE_ALPHAS if holds(a)), 1.00)
    t['--o-glass-safe'] = f'rgba({rgb_list(bg)}, {safe:.2f})'
    t['--o-pop-safe'] = f'rgba({rgb_list(bg)}, {max(safe, POPUP_ALPHA):.2f})'

    checks = {
        'text/win': (contrast(text_high, ground), 4.5),
        'dim/win': (contrast(text_medium, ground), 4.5),
        'faint/win': (contrast(text_low, ground), 3.0),
        'text/field': (contrast(text_high, raised), 4.5),
        'text/panel': (contrast(text_high, bg_low), 4.5),
        'link/win': (contrast(primary[0], raised), 4.5),
        'keys/win': (min(contrast(k, raised) for k in keys), 4.5),
        'on-primary': (min(contrast(primary[3], c) for c in primary[:3]), 4.5),
        'on-error': (min(contrast(error[3], c) for c in error[:3]), 4.5),
        'on-success': (min(contrast(success[3], c) for c in success[:3]), 4.5),
        'on-warn': (min(contrast(warn[3], c) for c in warn[:3]), 4.5),
        'on-accent': (contrast(t['--o-on-accent'], p['accent']), 4.5),
        'border/bg': (contrast(border_high, bg), 1.6),
        'text/dim': (contrast(text_high, ground) / contrast(text_medium, ground), DIM_DISTINCT),
        'safe-glass': (safe, 0.0),
    }
    return t, checks


def title(pid):
    return ' '.join(w.capitalize() for w in pid.split('-'))


def uci_name(pid):
    return 'Omarchy' + ''.join(w.capitalize() for w in pid.split('-'))


def base_root_properties():
    """Custom properties declared in base.css's :root blocks."""
    css = (MEDIA / 'base.css').read_text()
    names = set()
    for block in re.findall(r':root(?:\[[^\]]*\])?\s*\{([^}]*)\}', css):
        names.update(re.findall(r'(--[a-z0-9-]+)\s*:', block))
    return names


def render_css(palettes):
    out = [
        '/* Generated by tools/gen-palettes.py from palettes/*.toml. Do not edit.',
        ' * Palette colours: Omarchy, (c) David Heinemeier Hansson, MIT license. */',
    ]
    for pid, (tokens, _, _) in palettes.items():
        sel = f':root[data-palette="{pid}"]'
        if pid == DEFAULT:
            sel = ':root:not([data-palette]), ' + sel
        out.append(f'{sel} {{')
        out.extend(f'\t{k}: {v};' for k, v in tokens.items())
        out.append('}')
    return '\n'.join(out) + '\n'


def render_js(palettes, sources, grids):
    rows = []
    for pid in palettes:
        p = sources[pid]
        rows.append("\t\t{ id: '%s', name: '%s', mode: '%s', bg: '%s', fg: '%s', accent: '%s', walls: %s }" % (
            pid, title(pid), p['mode'], p['background'], p['foreground'], p['accent'],
            json.dumps(grids.get(pid, {}).get('walls', []))))
    return '\n'.join([
        "'use strict';",
        "'require baseclass';",
        '',
        '/* Generated by tools/gen-palettes.py. Do not edit. */',
        'return baseclass.extend({',
        f"\tfallback: '{DEFAULT}',",
        '\tlist: [',
        ',\n'.join(rows),
        '\t]',
        '});',
        '',
    ])


def render_uci_defaults(palettes):
    lines = [
        '#!/bin/sh',
        '# Generated by tools/gen-palettes.py. Do not edit.',
        '#',
        '# Registers the theme and one alias per palette. An existing theme choice is',
        '# left alone: pick Omarchy under System > System > Language and Style, or run',
        '#   uci set luci.main.mediaurlbase=/luci-static/omarchy && uci commit luci',
        '',
        'changed=0',
        '',
        'set_opt() {',
        '\tuci -q get "luci.$1" >/dev/null && return',
        '\tuci set "luci.$1=$2"',
        '\tchanged=1',
        '}',
        '',
        'set_opt themes.Omarchy /luci-static/omarchy',
        '',
        'if [ "${PKG_UPGRADE:-}" != 1 ] && [ "$changed" = 1 ]; then',
        '\tset_opt main.mediaurlbase /luci-static/omarchy',
        'fi',
        '',
    ]
    lines += [f'set_opt themes.{uci_name(pid)} /luci-static/omarchy-{pid}' for pid in palettes]
    lines += ['', '[ "$changed" = 1 ] && uci commit luci', '', 'exit 0', '']
    return '\n'.join(lines)


def sync_links(parent, ids, check):
    """Keep exactly one omarchy-<id> -> omarchy symlink per palette in parent."""
    stale = False
    wanted = {f'omarchy-{pid}' for pid in ids}
    for entry in parent.glob('omarchy-*'):
        if entry.name not in wanted and entry.is_symlink():
            stale = True
            if not check:
                entry.unlink()
    for name in sorted(wanted):
        link = parent / name
        if link.is_symlink() and os.readlink(link) == 'omarchy':
            continue
        stale = True
        if not check:
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to('omarchy')
    return stale


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='fail if generated files are out of date')
    ap.add_argument('--report', action='store_true', help='print the contrast table')
    args = ap.parse_args()

    sources = {f.stem: load(f) for f in sorted(PALETTES.glob('*.toml'))}
    if DEFAULT not in sources:
        sys.exit(f'default palette {DEFAULT} is missing')
    grids = tomllib.loads(BACKDROPS.read_text()) if BACKDROPS.exists() else {}
    palettes = {pid: derive(p, grids.get(pid, {}).get('rows')) for pid, p in sources.items()}

    # Every property the base file declares on :root must be accounted for.
    declared = base_root_properties()
    emitted = set(next(iter(palettes.values()))[0])
    unhandled = sorted(declared - emitted - DERIVED_BY_BASE - SET_BY_SKIN)
    if unhandled:
        sys.exit('base.css declares properties no palette sets: ' + ', '.join(unhandled))
    unknown = sorted(k for k in emitted if k.startswith('--') and not k.startswith('--o-') and k not in declared)
    if unknown:
        sys.exit('palettes set properties base.css does not declare: ' + ', '.join(unknown))

    failures = []
    names = list(next(iter(palettes.values()))[1])
    if args.report:
        print(f'{"palette":18}{"alpha":>7}' + ''.join(f'{n:>11}' for n in names))
    for pid, (_, checks, alpha) in palettes.items():
        row = f'{pid:18}{alpha:>7.2f}'
        for n in names:
            value, minimum = checks[n]
            bad = value + 1e-9 < minimum
            row += f'{value:>10.2f}{"!" if bad else " "}'
            if bad:
                failures.append(f'{pid}: {n} contrast {value:.2f} is below {minimum}')
        if args.report:
            print(row)
    if failures:
        sys.exit('\n'.join(failures))
    if args.report:
        return

    outputs = {
        MEDIA / 'palettes.css': render_css(palettes),
        STATIC / 'resources/omarchy-palettes.js': render_js(palettes, sources, grids),
        ROOT / 'root/etc/uci-defaults/30_luci-theme-omarchy': render_uci_defaults(palettes),
    }
    stale = [p for p, text in outputs.items() if not p.exists() or p.read_text() != text]
    links_stale = any([sync_links(STATIC, palettes, args.check), sync_links(TEMPLATES, palettes, args.check)])
    if args.check:
        if stale or links_stale:
            sys.exit('generated files are out of date; run tools/gen-palettes.py')
        print(f'{len(palettes)} palettes, generated files up to date')
        return
    for path, text in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    os.chmod(ROOT / 'root/etc/uci-defaults/30_luci-theme-omarchy', 0o755)
    print(f'{len(palettes)} palettes written ({len(stale)} file(s) changed)')


if __name__ == '__main__':
    main()
