#!/usr/bin/env python3
"""One-off WP01 migration: map literal presentation values in Client feature
CSS Modules to the nearest ui-theme role token.

Usage (repository root):
    python3 .agents/plans/2026-10-02-web-ui-redesign/tools/migrate_style_literals.py [--dry-run] [package ...]

Mapping rules
- font-size px -> nearest type role size; a px line-height in the same rule
  block moves to that role's line-height.
- font shorthand px -> type role shorthand, keeping a differing weight as a
  following font-weight declaration.
- border-radius -> xs/sm/md/lg/xl/full by nearest step.
- z-index -> layer roles (local-n for in-context ordering).
- durations -> duration tokens; easing keywords -> ease tokens.
Values that have no defensible mapping stay literal and are printed so a
person decides; the style ratchet keeps them visible.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DRY = '--dry-run' in sys.argv
ONLY = [a for a in sys.argv[1:] if not a.startswith('--')]

FONT_ROLE_BY_PX = {
    10: 'micro', 11: 'micro', 12: 'caption', 13: 'label', 14: 'body', 15: 'body-reading',
    16: 'heading', 17: 'heading', 18: 'title', 20: 'title', 22: 'title', 24: 'title',
    21: 'title', 26: 'display', 28: 'display', 32: 'display',
}
MONO_ROLE_BY_PX = {10: 'mono-small', 11: 'mono-small', 12: 'mono-small', 13: 'mono', 14: 'mono'}
ROLE_WEIGHT = {
    'display': 600, 'title': 600, 'heading': 600, 'body': 400, 'body-reading': 400,
    'label': 500, 'caption': 400, 'micro': 500, 'mono': 400, 'mono-small': 400,
}


def radius_token(px: float) -> str:
    if px >= 99:
        return 'var(--clocky-radius-full)'
    if px <= 5:
        return 'var(--clocky-radius-xs)'
    if px <= 7:
        return 'var(--clocky-radius-sm)'
    if px <= 10:
        return 'var(--clocky-radius-md)'
    if px <= 14:
        return 'var(--clocky-radius-lg)'
    return 'var(--clocky-radius-xl)'


def duration_token(ms: float) -> str:
    if ms <= 100:
        return 'var(--clocky-duration-instant)'
    if ms <= 170:
        return 'var(--clocky-duration-fast)'
    if ms <= 240:
        return 'var(--clocky-duration-base)'
    if ms <= 340:
        return 'var(--clocky-duration-slow)'
    if ms <= 600:
        return 'var(--clocky-duration-deliberate)'
    if ms <= 1300:
        return 'var(--clocky-duration-spin)'
    if ms <= 2000:
        return 'var(--clocky-duration-shimmer)'
    if ms <= 2800:
        return 'var(--clocky-duration-sweep)'
    return 'var(--clocky-duration-dwell)'


EASE = {
    'var(--ds-ease-in-out)': 'var(--clocky-ease-standard)',
    'ease-in-out': 'var(--clocky-ease-standard)',
    'ease-out': 'var(--clocky-ease-enter)',
    'ease-in': 'var(--clocky-ease-exit)',
    'ease': 'var(--clocky-ease-standard)',
}

# Page layers keyed by file suffix and literal; everything else uses the generic rule.
Z_SPECIFIC = {
    ('ui-primitives/src/Menu.module.css', '1100'): 'var(--clocky-layer-popover)',
    ('ui-message-feedback/src/client/MessageFeedbackActions.module.css', '1100'): 'var(--clocky-layer-popover)',
    ('ui-primitives/src/Toast.module.css', '1100'): 'var(--clocky-layer-toast)',
    ('ui-primitives/src/OnboardingSurface.module.css', '1100'): 'var(--clocky-layer-modal)',
    ('ui-attachment/src/DropOverlay.module.css', '1000'): 'var(--clocky-layer-overlay)',
    ('ui-primitives/src/Tooltip.module.css', '100'): 'var(--clocky-layer-tooltip)',
    ('ui-primitives/src/ConnectionBanner.module.css', '100'): 'var(--clocky-layer-overlay)',
}


def z_token(file: str, value: str) -> str | None:
    for (suffix, literal), token in Z_SPECIFIC.items():
        if file.endswith(suffix) and value == literal:
            return token
    n = int(value)
    if n == 0:
        return '0'
    if n == -1:
        return 'var(--clocky-layer-behind)'
    if 1 <= n <= 8:
        return f'var(--clocky-layer-local-{n})'
    if 10 <= n <= 20:
        return 'var(--clocky-layer-sticky)'
    if n == 100:
        return 'var(--clocky-layer-dropdown)'
    if n == 101:
        return 'calc(var(--clocky-layer-dropdown) + var(--clocky-layer-local-1))'
    if n == 1000:
        return 'var(--clocky-layer-modal)'
    if n == 1100:
        return 'var(--clocky-layer-popover)'
    return None


unmapped: list[str] = []


def migrate_block(file: str, body: str) -> str:
    """Rewrite one rule block body (text between braces, no nested blocks)."""
    role_for_block: str | None = None

    def font_size(m: re.Match) -> str:
        nonlocal role_for_block
        px = float(m.group(2))
        role = FONT_ROLE_BY_PX.get(int(px // 1))
        if role is None:
            unmapped.append(f'{file}: font-size: {m.group(2)}px')
            return m.group(0)
        role_for_block = role
        return f'{m.group(1)}var(--clocky-type-{role}-size)'

    body = re.sub(r'(font-size\s*:\s*)(\d+(?:\.\d+)?)px', font_size, body)
    if role_for_block is not None:
        body = re.sub(r'(line-height\s*:\s*)\d+(?:\.\d+)?px',
                      lambda m: f'{m.group(1)}var(--clocky-type-{role_for_block}-line-height)', body)

    def font_shorthand(m: re.Match) -> str:
        weight, px, family = m.group(2), int(m.group(3)), m.group(5)
        mono = 'code' in family or 'Menlo' in family or 'mono' in family.lower()
        role = (MONO_ROLE_BY_PX if mono else FONT_ROLE_BY_PX).get(px)
        if role is None:
            unmapped.append(f'{file}: font: {m.group(0).strip()}')
            return m.group(0)
        out = f'{m.group(1)}var(--clocky-type-{role})'
        w = int(weight) if weight else 400
        if w != ROLE_WEIGHT[role]:
            out += f';\n  font-weight: {w}'
        return out

    body = re.sub(r'(\bfont\s*:\s*)(?:(\d{3})\s+)?(\d+)px/(\d+)px\s+([^;]+?)(?=\s*;|\s*$)', font_shorthand, body)

    def radius(m: re.Match) -> str:
        parts = []
        for part in m.group(2).split():
            pm = re.fullmatch(r'(\d+(?:\.\d+)?)(px|%)', part)
            if pm is None:
                parts.append(part)
            elif pm.group(2) == '%':
                parts.append('var(--clocky-radius-full)' if float(pm.group(1)) >= 50 else part)
            elif float(pm.group(1)) == 0:
                parts.append('0')
            else:
                parts.append(radius_token(float(pm.group(1))))
        return f'{m.group(1)}{" ".join(parts)}'

    body = re.sub(r'(border(?:-[a-z]+)*-radius\s*:\s*)([^;{}]+?)(?=\s*;|\s*$)', radius, body)

    def zindex(m: re.Match) -> str:
        token = z_token(file, m.group(2))
        if token is None:
            unmapped.append(f'{file}: z-index: {m.group(2)}')
            return m.group(0)
        return f'{m.group(1)}{token}'

    body = re.sub(r'(z-index\s*:\s*)(-?\d+)(?=\s*;|\s*$)', zindex, body)

    def motion(m: re.Match) -> str:
        value = m.group(2)

        def time(t: re.Match) -> str:
            n = float(t.group(1))
            ms = n * 1000 if t.group(2) == 's' else n
            return '0s' if ms == 0 else duration_token(ms)

        value = re.sub(r'(?<![\w.-])(\d+\.?\d*|\.\d+)(ms|s)\b', time, value)
        for key, token in EASE.items():
            value = re.sub(rf'(?<![\w(-]){re.escape(key)}(?![\w-])', token, value)
        return f'{m.group(1)}{value}'

    body = re.sub(r'((?:transition|animation)(?:-duration|-delay|-timing-function)?\s*:\s*)([^;{}]+)', motion, body)
    return body


def migrate(file: Path) -> bool:
    rel = file.relative_to(ROOT / 'packages').as_posix()
    text = file.read_text()
    # Protect comments from rewriting.
    comments: list[str] = []

    def stash(m: re.Match) -> str:
        comments.append(m.group(0))
        return f'\0{len(comments) - 1}\0'

    work = re.sub(r'/\*[\s\S]*?\*/', stash, text)
    work = re.sub(r'\{([^{}]*)\}', lambda m: '{' + migrate_block(rel, m.group(1)) + '}', work)
    work = re.sub(r'\0(\d+)\0', lambda m: comments[int(m.group(1))], work)
    work = work.replace('var(--ds-transition-duration-slow)', 'var(--clocky-duration-slow)')
    work = work.replace('var(--ds-transition-duration-fast)', 'var(--clocky-duration-instant)')
    work = work.replace('var(--ds-transition-duration)', 'var(--clocky-duration-base)')
    work = work.replace('var(--ds-ease-in-out)', 'var(--clocky-ease-standard)')
    if work != text:
        if not DRY:
            file.write_text(work)
        return True
    return False


changed = 0
for path in sorted({*(ROOT / 'packages/client').glob('*/src/**/*.module.css'), *ROOT.glob('packages/*/*/src/client/**/*.module.css')}):
    pkg = path.parent.as_posix().split('/packages/')[1].split('/')[1]
    if ONLY and pkg not in ONLY:
        continue
    if path.as_posix().endswith('web/src/boot-page.module.css'):
        continue
    changed += migrate(path)
print(f'changed {changed} file(s)')
for line in unmapped:
    print('UNMAPPED', line)
