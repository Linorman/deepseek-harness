# Agent Note: World authoring keyboard controls

Status: implemented

English | [中文](2026-10-15-world-authoring-keyboard-controls.zh.md)

## Problem

Definition tables need keyboard editing without changing a retained value merely because its editor opens. Closed choices and draft references need the same selection and focus behavior. A popup inside a scrollable table can be clipped, while source indentation must leave an accessible keyboard path out of the editor.

## Decision

The feature's [ReferencePicker](../../../../packages/client/ui-simulation/src/client/WorldReferencePicker.tsx) owns both declared-reference suggestions and closed table choices. The current value starts highlighted, including when it lies beyond the ordinary 50-option prefix. Arrows change the active descendant; Enter commits it, Tab commits and moves through the grid, and Escape cancels and restores the cell. Closed choices do not commit unmatched text; blur cancels that edit. Undeclared values already in a source draft remain available for explicit correction rather than being silently erased.

The list is portaled into its nearest open dialog or the document body. The shared anchored-position hook measures and clamps it, tracks scrolling and resize, and avoids the table's clipping region. The input keeps focus and its listbox relationship. Active options scroll inside the list without scrolling the page.

Form textarea sizes follow explicit rows, and the source editor follows its pane. Content scrolls inside those bounds. The source pane supplies a visible focus ring and describes its shortcuts: Tab indents, Escape then Tab leaves, Ctrl/Cmd+Enter checks and F8/Shift+F8 moves between diagnostics.

Table action columns have a complete localized column heading instead of an empty row-number label. Preview key/value tracks share the available width, letting long keys wrap while keeping each numeric allowance on one readable line. Browser checks exercise both persistence backends, light/dark themes and desktop/narrow viewports.

## Alternatives considered

Native selects give table cells a separate interaction model and cannot share reference lookup behavior. Unbounded suggestion lists increase work and obscure coverage. Keeping the list inside the table does not solve clipping with a larger z-index.

## Consequences

These controls change draft presentation and editing only. They do not fetch authoritative business state, infer, create a run or submit a management command. Component tests own retained-value and focus behavior; real browser evidence owns popup geometry, keyboard exit, themes, narrow layout and reduced motion. [DESIGN.md](../../../../DESIGN.md) and [UX-CONTRACT.md](../../../../UX-CONTRACT.md) retain the product-level rules.
