# Agent Note: Web role tokens — one palette and role-based scales

Status: implemented

English | [中文](2026-10-02-web-role-tokens.zh.md)

## Problem

The Web client had two parallel palettes. `--clocky-workspace-*` colored Team and Simulation pages, `--clocky-alias-*` colored everything else, and a `[data-team-workspace-page]` scope remapped one onto the other, so a Team page and a Session page drew different canvas, ink, border, and accent values. A graphite `--clocky-navigation-*` palette made the sidebar look like a separate product. The dark block repeated the static palette verbatim, export residue such as `brand-primary-new-colorprimary-new-color` and `accent-700-delete` survived, and type tokens were named by size (`xs-13`, `m-18` meaning 16px). There were no space, radius, elevation, layer, or motion scales, so 99 feature CSS Modules carried 776 literal font sizes, radii, z-indexes, durations, and colors, and ten `var(--clocky-*)` references named tokens that nothing defined. The [redesign proposal](../../proposed/feature/2026-10-02-web-ui-redesign.md) requires one system before any page-level change.

## Decision

`packages/client/ui-theme/src/styles/tokens.css` is the single semantic layer and the single palette:

- **Color roles:** `bg-{canvas,surface,raised,sunken,overlay,sidebar,control,inverse}`, interaction washes `bg-{hover,active,scrim}`, `fg-{primary,secondary,tertiary,disabled,on-accent,inverse}`, `border-{subtle,default,strong,focus}`, and one accent ramp `accent-{fg,bg,bg-hover,subtle,subtle-border}`. Light values sit on `body` and dark overrides on `body[data-ds-dark-theme]`. Palette steps (`--clocky-neutral-*`, `--clocky-blue-*`) exist only inside the sheet.
- **Agent states:** `status-<state>-{fg,bg,border}` for `running`, `waiting`, `needs-you`, `blocked`, `done`, `failed`, and `idle`.
- **Type roles:** `display 28/36`, `title 20/28`, `heading 16/24`, `body 14/22`, `body-strong`, `body-small 13/20`, `body-reading 15/26`, `label 13/20 500`, `caption 12/18`, `micro 11/14`, `mono 13/20`, and `mono-small 12/18`, each as a `font` shorthand plus `-size`, `-line-height`, and `-weight`. `body-strong` and `body-small` were added to the proposal's ramp because existing surfaces use regular 13px and medium 14px text that no proposed role matched without a weight change.
- **Scales:** space on a 4px base, radius `xs`–`xl` plus `full`, elevation 0–4, and layers `base`, `sticky`, `dropdown`, `overlay`, `modal`, `popover`, `toast`, and `tooltip`. `popover` sits above `modal` because portaled menus and panels opened from a dialog must stay on top. `local-1`…`local-8` and `behind` order siblings inside one stacking context and never compete with page layers.
- **Motion:** durations `instant 80`, `fast 140`, `base 200`, `slow 280`, `deliberate 400`, plus `fade`, `spin`, `shimmer`, `sweep`, and `dwell`; easings `standard`, `enter`, `exit`, `linear`, and a `linear()` `spring`. Under `prefers-reduced-motion: reduce`, every movement duration becomes `0.01ms`, `animation-iteration-count` is forced to 1, and only `fade` keeps its timing.

Every legacy family is deleted with its consumers in the same change, following the pre-release stance: `design-platform.css` (static, alias, specific, workspace, and navigation palettes and the scoped remaps), the size-named type tokens, `--clocky-shadow-lv*`, `--clocky-control-radius`, and the `--ds-ease-in-out` / `--ds-transition-duration*` motion variables. The sidebar is tonal: one step darker than the canvas in light mode and one step deeper in dark mode. `ThemeRuntime.overrideTokens` and registered themes override role tokens, and the inspectable token inventory lists role tokens.

`pnpm run verify-client-style-tokens` enforces the system mechanically. It scans feature CSS Modules under `packages/client/*/src` and `packages/*/*/src/client`, rejects literal colors, font sizes, radii, z-indexes, and durations above a per-file allowlist, fails when a count falls until `-- --write` records it, and rejects `var(--clocky-*)` references to undefined names. It runs in `hygiene` and the CI static and artifact gates. The two one-off migration scripts that mapped literals and legacy names to roles live beside the [development plan](../../../plans/2026-10-02-web-ui-redesign/development-plan.md) in `tools/`.

## Alternatives considered

**Keep role-correct `--clocky-alias-*` names as the public layer.** The proposal allowed this. It would have kept two names for one role, because the new scales and agent states have no alias counterparts, and third-party overrides of an alias would not reach consumers that read the role. Renaming every consumer once leaves one vocabulary for authors, reviewers, and theme overrides.

**Define role tokens as references to aliases.** This keeps old override names working, but it preserves the alias layer as the real palette and makes every role an indirection that reviewers must resolve.

**Leave font sizes and spacing untokenized, as the [styling-system note](2026-07-19-web-styling-system.md) decided.** The paired-line-height discipline did not converge: feature CSS held 361 literal font sizes against 89 typography-token uses and a flat hierarchy followed. Roles give the mechanical gate something to require.

**Map every z-index onto the proposal's seven page layers.** Components use small integers to order siblings inside their own stacking context; collapsing those onto `sticky` would break their relative order, so the `local-*` steps carry them explicitly.

## Consequences

Team, Session, Simulation, settings, and sidebar surfaces draw from one palette in both themes, and brand accent is one ramp. Feature CSS literals fell from 776 to 4; the remaining entries (an 8px sidebar badge, two 8–9px trajectory minimap labels, and a relative `0.875em` inline-code size in headings) belong to the sidebar, conversation, and trajectory work packages. `tests/tokens.client.spec.ts` asserts role completeness in both themes, scale order, the reduced-motion mapping, and contrast floors (text roles ≥ 4.5:1 on every surface, control bounds and focus ≥ 3:1).

Costs: the graphite sidebar look is gone; primary buttons that used the near-black brand fill now use the accent; the migration rounded some values to the nearest step (for example 24px radii to 16px and 18px text to the 20px title role), which the light/dark baseline review accepted. Third-party themes written against alias names must rename their keys.
