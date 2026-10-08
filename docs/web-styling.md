# Web UI style reference

English | [中文](web-styling.zh.md)

This reference defines styling ownership and component rules for browser client packages. The current token values live in [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/); this document does not duplicate that inventory.

## Ownership

[`ui-theme`](../packages/client/ui-theme/README.md) owns the one palette and the shared scales in `tokens.css`: color roles, agent-state roles, type roles, space, radius, elevation, layers, and motion, plus the markdown type composites, scrollbar styles, syntax palette, and light/dark preference. [`ui-layout`](../packages/client/ui-layout/README.md) applies the resolved theme snapshot to the document. Feature packages consume role tokens and do not define another global theme.

Global style sheets belong in `ui-theme/src/styles/`. Component styles live beside their component as CSS Modules. A component may define a local custom property when its value is part of that component's layout or presentation contract; shared colors, typography, elevation, layers, and motion belong to the theme package.

## Role tokens

| Family | Tokens | Use |
|---|---|---|
| Surface | `--clocky-bg-{canvas,surface,raised,sunken,overlay,sidebar,control,inverse}`, `--clocky-bg-{hover,active,scrim}` | Page canvas, cards, nested and floating surfaces, interaction washes |
| Text | `--clocky-fg-{primary,secondary,tertiary,disabled,on-accent,inverse}` | Text and glyphs |
| Line | `--clocky-border-{subtle,default,strong,focus}` | Separators, control bounds (`strong` meets 3:1), focus rings |
| Accent | `--clocky-accent-{fg,bg,bg-hover,subtle,subtle-border}` | The one brand ramp: links, primary actions, selection |
| Agent state | `--clocky-status-<state>-{fg,bg,border}` for `running`, `waiting`, `needs-you`, `blocked`, `done`, `failed`, `idle` | Badges, lanes, sidebar glyphs, tool rows |
| Categorical tint | `--clocky-tint-{teal,fuchsia,olive,slate}-{fg,bg,border}` | Identity of a role or record kind (avatars, trajectory kind chips); never a state |
| Type | `--clocky-type-<role>` and `-size`, `-line-height`, `-weight` for `display`, `title`, `heading`, `body`, `body-strong`, `body-small`, `body-reading`, `label`, `caption`, `micro`, `mono`, `mono-small` | `font: var(--clocky-type-label)` or the parts |
| Space | `--clocky-space-{0,1,2,3,4,5,6,8,10,12}` (4px base) | Gaps and padding |
| Radius | `--clocky-radius-{xs,sm,md,lg,xl,full}` | Corners |
| Elevation | `--clocky-elevation-{0..4}` | Flat, card hairline, popover, dialog or sheet, toast |
| Layer | `--clocky-layer-{base,sticky,dropdown,overlay,modal,popover,toast,tooltip}`, `--clocky-layer-local-{1..8}`, `--clocky-layer-behind` | Page stacking; `local-*` orders siblings inside one stacking context |
| Motion | `--clocky-duration-{instant,fast,base,slow,deliberate,fade,spin,shimmer,sweep,dwell,orbit,flow,celebrate}`, `--clocky-ease-{standard,enter,exit,spring,emphasized,linear}`, `--clocky-stagger-step` | Transitions, animations, and the motion tiers below |
| Mode identity | `--clocky-mode-{team,simulation}-{fg,bg,subtle,glow,gradient}` | Which workspace is active, on chrome only: backdrop, mode switch, header glow |
| Glow | `--clocky-glow-{running,needs-you,failed,done}` | Live-state halos composed from the status roles |
| Material | `--clocky-surface-glass`, `--clocky-blur-glass` | Floating panels and overlays over a visualization |
| Visualization | `--clocky-viz-{grid,edge,edge-active,edge-ghost,node-ring,halo}` | Graph grid, edges, ghost references, node rings |
| Expressive type | `--clocky-type-{hero,metric}` | Banner numbers and gauges; `metric` uses tabular monospace numerals |

Light values sit on `body` and dark overrides on `body[data-ds-dark-theme]`. Palette steps such as `--clocky-neutral-*` and `--clocky-blue-*` exist only so `tokens.css` names each color once; feature CSS never reads them. Under `prefers-reduced-motion: reduce`, every movement duration collapses to `0.01ms`, loops run once, and only `--clocky-duration-fade` keeps its timing, so components inherit reduced motion through the tokens.

## Component rules

- Use CSS Modules and `clsx`; do not add a component library or Tailwind.
- Use role tokens in feature components. Do not write literal colors, font sizes, radii, z-indexes, or durations there; `pnpm run verify-client-style-tokens` enforces this with a shrinking allowlist and rejects references to undefined `--clocky-*` names.
- Keep theme selectors out of feature component CSS. Light/dark overrides belong to the theme owner.
- Pair font sizes with line heights through one type role.
- Keep source text, terminal output, and diff lines unwrapped when their component contract requires column preservation; use the shared scrollbar styles rather than component-specific scrollbar selectors.
- Put presentation in CSS. Inline React styles may pass component-local custom-property values but must not encode theme branches.
- Animate only `transform` and `opacity`, except the `grid-template-rows` height pattern, and use the duration and ease tokens so reduced motion applies.
- Give controls that appear for an action, such as dialogs and menus, an opacity-only entrance: a moving box delays pointer actionability until it settles. Under reduced motion, remove non-fade entrances with `animation: none` instead of relying on collapsed durations.
- Mode identity tokens mark the active workspace on chrome. A selector that encodes a domain state (`[data-status]`, `[data-phase]`, `[data-state]`, or a `status`/`phase`/`state` class) never reads them; the gate rejects it.
- Do not animate a theme switch. The theme presenter suspends transitions for one frame while a snapshot lands (`data-clocky-theme-switching` on the root), so color transitions run only for state changes.
- Preserve keyboard focus visibility; controls that appear on hover also appear on `:focus-within`.

## Motion tiers

Motion that follows live data uses one of four tiers. An element that runs tiered motion carries `data-motion-tier="L0|L1|L2|L3"`, so tests can find its animations.

| Tier | Examples | Timing | Cap | Reduced motion |
|---|---|---|---|---|
| L0 ambient | Static mode backdrop and directory glyphs | No continuous animation | One backdrop per screen | Static |
| L1 live signal | Running-node halo, channel message particles, running-card sweep | One flight per `--clocky-duration-flow` | 24 concurrent particles; the excess merges into one "+N" pulse | One opacity flash |
| L2 state transition | Board card moving between columns, node phase change, odometer, progress ring | `--clocky-duration-base` to `--clocky-duration-deliberate` with `--clocky-ease-spring` | One choreography at a time; interruptible | Immediate change |
| L3 moment | Assemble, converge, ignite, seal, stall | At most `--clocky-duration-celebrate`, once | Only on a live observed transition; any input skips it | Fade only |

- Only observed live deltas animate. Initial hydration, reload, replay, and navigation render the settled state without L2 or L3 motion, because a historical change performed as if it were happening now misstates when it happened.
- React renders on data changes only. Per-frame work goes through refs and the Web Animations API, and stops while the document is hidden or the element is off-screen.
- `needs-you` pulses once rather than looping, running indicators are static under reduced motion, and dialogs and menus keep their in-place fade.
- SVG edge draw-in inside [`ui-viz`](../packages/client/ui-viz/README.md) may animate `stroke-dashoffset`. This is the one exception to the `transform`/`opacity` rule; `verify-client-style-tokens` rejects `stroke-dashoffset` transitions and keyframes in every other package.

## Changing the system

Add or change a shared token in `ui-theme/src/styles/tokens.css`, then consume it from feature packages. Third-party themes override role tokens through `ThemeRuntime.overrideTokens`, which writes them as inline custom properties on `body`. Update the owning package reference when a public styling contract changes. Visual behavior follows the [testing policy](testing.md); `apps/web/tests/ui-baseline.snapshot.ts` captures the light/dark state matrix for review. The [styling-system Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.md) records framework rationale, and the [role-token Agent Note](../.agents/notes/implemented/process/2026-10-02-web-role-tokens.md) records the token decision.
