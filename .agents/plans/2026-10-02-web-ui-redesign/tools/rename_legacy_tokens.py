#!/usr/bin/env python3
"""One-off WP01-e migration: rename every legacy theme token consumer to the
ui-theme role tokens, so `--clocky-alias-*`, `--clocky-specific-*`,
`--clocky-static-*`, `--clocky-workspace-*`, `--clocky-navigation-*`,
`--clocky-control-radius`, `--clocky-shadow-lv*`, and the size-named
`--clocky-font-*` tokens can be deleted.

Usage (repository root):
    python3 .agents/plans/2026-10-02-web-ui-redesign/tools/rename_legacy_tokens.py [--dry-run]

Names whose correct role depends on the property (an accent used as text
versus as a fill) are resolved per CSS declaration. Leftover legacy names
are printed for a person to resolve.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DRY = '--dry-run' in sys.argv

SIMPLE = {
    # Text.
    'alias-label-primary': 'fg-primary',
    'alias-label-secondary': 'fg-secondary',
    'alias-label-tertiary': 'fg-tertiary',
    'alias-label-caption': 'fg-tertiary',
    'alias-label-dimmed': 'fg-disabled',
    'alias-label-primary-bluish': 'fg-primary',
    'alias-label-primary-dimmed': 'fg-primary',
    'alias-label-primary-foreground': 'fg-on-accent',
    'alias-label-primary-inverted': 'fg-inverse',
    'alias-text-primary': 'fg-primary',
    'alias-text-tertiary': 'fg-tertiary',
    'alias-brand-text': 'fg-primary',
    'alias-brand-primary-invert': 'fg-on-accent',
    # Status.
    'alias-state-business-tertiary': 'accent-subtle',
    'alias-state-error-primary': 'status-failed-fg',
    'alias-state-error-secondary': 'status-failed-fg',
    'alias-state-success-primary': 'status-done-fg',
    'alias-state-success-secondary': 'status-done-fg',
    'alias-state-success-tertiary': 'status-done-bg',
    'alias-state-warn-label': 'status-needs-you-fg',
    'alias-state-warn-primary': 'status-needs-you-fg',
    'alias-state-warn-secondary': 'status-needs-you-border',
    'alias-state-warn-tertiary': 'status-needs-you-bg',
    # Interaction.
    'alias-interactive-bg-hover': 'bg-hover',
    'alias-interactive-bg-active': 'bg-active',
    'alias-interactive-bg-hover-accent': 'bg-active',
    'alias-interactive-bg-hover-danger': 'status-failed-bg',
    'alias-interactive-bg-hover-solid': 'bg-sunken',
    # Lines.
    'alias-border-l1': 'border-subtle',
    'alias-border-l2': 'border-default',
    'alias-border-l2-darkmode-thin': 'border-subtle',
    'alias-border-l3': 'border-default',
    'alias-border-l4': 'border-strong',
    'alias-border-subtle': 'border-subtle',
    # Surfaces.
    'alias-bg-base': 'bg-canvas',
    'alias-bg-layer-1': 'bg-surface',
    'alias-bg-layer-2': 'bg-raised',
    'alias-bg-layer-3': 'bg-overlay',
    'alias-bg-overlay': 'bg-sunken',
    'alias-bg-module-platform': 'bg-sunken',
    'alias-bg-multi-select': 'bg-sunken',
    'alias-bg-skeleton': 'bg-hover',
    'alias-bg-mask-1': 'bg-scrim',
    'alias-bg-mask-2': 'bg-scrim',
    'alias-bg-mask-3': 'bg-scrim',
    'alias-bg-mask-photo': 'bg-scrim-strong',
    'alias-bg-mask-drop': 'bg-drop',
    'alias-toast-bg': 'bg-inverse',
    'alias-tooltip-bg': 'bg-inverse',
    # Buttons.
    'alias-button-primary-fill': 'accent-bg',
    'alias-button-primary-hover': 'accent-bg-hover',
    'alias-button-primary-dimmed': 'bg-active',
    'alias-button-info-fill': 'accent-bg',
    'alias-button-info-hover': 'accent-bg-hover',
    'alias-button-contrast-fill': 'fg-primary',
    'alias-button-elevated-fill': 'bg-raised',
    'alias-button-floating-fill': 'bg-raised',
    'alias-button-floating-hover': 'bg-sunken',
    'alias-button-ghost-active-border': 'border-strong',
    'alias-button-ghost-active-fill': 'bg-active',
    'alias-button-ghost-active-hover': 'bg-active',
    'alias-button-tool-bar-fill': 'media-control-bg',
    'alias-button-tool-bar-hover': 'media-control-bg-hover',
    'alias-button-tool-bar-fill-invisible': 'media-control-bg-subtle',
    # Markdown.
    'alias-markdown-citation': 'bg-sunken',
    'alias-markdown-code-block': 'bg-sunken',
    'alias-markdown-code-block-banner': 'bg-sunken',
    'alias-markdown-code-segment-selected': 'bg-surface',
    'alias-markdown-code-segment-unselected': 'bg-sunken',
    'alias-markdown-inline-code': 'bg-active',
    'alias-markdown-placeholder': 'bg-sunken',
    'alias-markdown-tag': 'bg-sunken',
    # Scrollbar.
    'alias-scrollbar-bg-l1': 'scrollbar-l1',
    'alias-scrollbar-hover-l1': 'scrollbar-l1-hover',
    'alias-scrollbar-bg-l2': 'scrollbar-l2',
    'alias-scrollbar-hover-l2': 'scrollbar-l2-hover',
    # Product-specific surfaces.
    'specific-bubble': 'accent-subtle',
    'specific-bubble-highlight': 'accent-subtle-border',
    'specific-input-major': 'bg-surface',
    'specific-login-input': 'bg-sunken',
    'specific-menu': 'bg-overlay',
    'specific-selector': 'bg-sunken',
    'specific-sidebar-fill': 'bg-sidebar',
    'specific-sidebar-nav-item-active-accent': 'accent-subtle',
    'specific-sidebar-nav-item-active': 'bg-active',
    'specific-sidebar-nav-item-hover': 'bg-hover',
    'specific-tip': 'bg-sunken',
    # Former Team and navigation palettes.
    'workspace-canvas': 'bg-canvas',
    'workspace-surface': 'bg-surface',
    'workspace-ink': 'fg-primary',
    'workspace-muted': 'fg-secondary',
    'workspace-border': 'border-default',
    'workspace-accent-hover': 'accent-bg-hover',
    'workspace-selection': 'accent-subtle',
    'workspace-success': 'status-done-fg',
    'workspace-warning': 'status-needs-you-fg',
    'workspace-error': 'status-failed-fg',
    'workspace-control-radius': 'radius-md',
    'control-radius': 'radius-md',
    'navigation-fill': 'bg-sidebar',
    'navigation-ink': 'fg-primary',
    'navigation-muted': 'fg-secondary',
    'navigation-border': 'border-default',
    'navigation-hover': 'bg-hover',
    'navigation-selected': 'bg-active',
    'navigation-action': 'accent-bg',
    # Elevation.
    'shadow-lv1': 'elevation-1',
    'shadow-lv1-blur': 'elevation-1',
    'shadow-lv2': 'elevation-2',
    'shadow-lv3': 'elevation-3',
    # Size-named type.
    'font-xl-24': 'type-title',
    'font-l-20': 'type-title',
    'font-m-18': 'type-heading',
    'font-base-16': 'type-body-reading',
    'font-base-strong-16': 'type-heading',
    'font-s-14': 'type-body',
    'font-s-strong-14': 'type-body-strong',
    'font-xs-13': 'type-body-small',
    'font-xs-strong-13': 'type-label',
    'font-xxs-12': 'type-caption',
    'font-xxs-strong-12': 'type-label',
    'font-xxxs-11': 'type-micro',
    'font-xxxs-strong-11': 'type-micro',
    # Feature-local uses of palette steps.
    'static-neutral-bluish-400': 'border-strong',
    'static-neutral-bluish-00': 'fg-inverse',
    'static-accent-450': 'status-running-fg',
    'static-blue-450': 'status-running-fg',
    'static-blue-400': 'accent-fg',
    'static-blue-500': 'accent-bg',
    'static-accent-500': 'accent-bg',
    'static-accent-200': 'accent-subtle-border',
}

# Accent names whose role depends on whether the declaration paints text.
BY_PROPERTY = {
    'alias-state-business-primary': ('accent-fg', 'accent-bg'),
    'alias-brand-primary': ('fg-primary', 'accent-bg'),
    'alias-brand-primary-new-colorprimary-new-color': ('accent-fg', 'accent-bg'),
    'workspace-accent': ('accent-fg', 'accent-bg'),
}
TEXT_PROPERTIES = {'color', 'caret-color', 'text-decoration-color', 'fill', 'stroke', '-webkit-text-fill-color'}

NAME = re.compile(r'--clocky-([a-z0-9-]+)')


def rename(name: str, prop: str | None) -> str | None:
    """New role for one legacy name; `prop` is the CSS property when known."""
    if name in SIMPLE:
        return SIMPLE[name]
    if name in BY_PROPERTY:
        text, fill = BY_PROPERTY[name]
        return text if prop is None or prop in TEXT_PROPERTIES else fill
    return None


def substitute(value: str, prop: str | None) -> str:
    return NAME.sub(lambda n: '--clocky-' + (rename(n.group(1), prop) or n.group(1)), value)


def rewrite_css(text: str) -> str:
    # Floating surfaces draw their ring through the elevation token, so the
    # light-transparent/dark-hairline border alias becomes a plain transparent edge.
    text = re.sub(r'var\(--clocky-alias-border-inverted2?\)', 'transparent', text)
    return re.sub(r'([-a-zA-Z]+)(\s*:\s*)([^;{}]*)',
                  lambda m: m.group(1) + m.group(2) + substitute(m.group(3), m.group(1).lower()), text)


def rewrite_other(text: str) -> str:
    return substitute(text, None)


TARGETS = [
    *ROOT.glob('packages/client/*/src/**/*.module.css'),
    *ROOT.glob('packages/*/*/src/client/**/*.module.css'),
    *ROOT.glob('packages/*/*/src/client/**/*.tsx'),
    *ROOT.glob('packages/client/*/src/**/*.ts'),
    *ROOT.glob('packages/client/*/src/**/*.tsx'),
    *ROOT.glob('packages/client/*/tests/**/*.ts'),
    *ROOT.glob('packages/client/*/tests/**/*.tsx'),
    *ROOT.glob('packages/client/*/README*.md'),
    *ROOT.glob('packages/extensions/cordis-client-runner/src/**/*.ts'),
    *ROOT.glob('packages/extensions/cordis-client-runner/tests/**/*.ts'),
    *ROOT.glob('apps/web/tests/*.ts'),
    ROOT / 'packages/client/web/src/base.css',
    ROOT / 'scripts/gen-client-catalog.ts',
]

changed = 0
leftovers: set[str] = set()
for path in TARGETS:
    if not path.is_file() or '/lib/' in path.as_posix():
        continue
    text = path.read_text()
    new = rewrite_css(text) if path.suffix == '.css' else rewrite_other(text)
    for m in NAME.finditer(new):
        n = m.group(1)
        if re.match(r'(alias|specific|static|workspace|navigation|shadow-lv|control-radius|font-(xl|l|m|base|s|xs|xxs|xxxs)-)', n):
            leftovers.add(f'{path.relative_to(ROOT)}: --clocky-{n}')
    if new != text:
        changed += 1
        if not DRY:
            path.write_text(new)
print(f'changed {changed} file(s)')
for item in sorted(leftovers):
    print('LEFTOVER', item)
