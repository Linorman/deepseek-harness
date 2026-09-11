---
version: 1
name: "Clocky Web"
description: "A compact, transcript-centred agent workspace with quiet chrome and durable Team navigation."
colors:
  primary: "#0F1115"
  accent: "#4176E6"
  surface: "#F9FAFB"
  border: "#E1E5EE"
  danger: "#EC1313"
  success: "#22C55E"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif"
  mono:
    fontFamily: "SF Mono, JetBrains Mono, Fira Code, Consolas, Liberation Mono, Menlo, Courier, PingFang SC, Microsoft YaHei"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  sidebar-inline: "12px"
  sidebar-rail: "56px"
  control-height: "36px"
  task-row-min-height: "44px"
components:
  sidebar: { }
  composer: { }
  task-list: { }
  toast: { }
---

# Clocky Web Design System

## Overview

### Creative North Star

Desktop-native concentration: a quiet technical notebook where the transcript owns the screen and navigation stays compact, tactile, and low-contrast until the user needs it.

### Product context and register

- **Audience and primary job:** people directing and inspecting durable agent work.
- **Target markets:** global developer tooling; no Japan-market behavior is implied by the Chinese locale.
- **Locales:** Simplified Chinese and English share equal product coverage. Copy, aria labels, dates, and visible state labels route through the locale service.
- **Usage scene:** long-running desktop or browser sessions with dense technical text, a persistent sidebar, and frequent task switching.
- **Register:** product workspace, not a marketing surface or a dashboard.
- **Memorable signature:** the resident composer and transcript remain spatially stable while navigation or a task changes.
- **Restraint:** Team information is concise; objective, lifecycle, and selection are visible without turning the sidebar into a project-management board.
- **Anti-references:** glossy gradient dashboards, high-chrome kanban boards, and decorative motion that competes with the transcript.
- **Token ownership/runtime mapping:** [`packages/client/ui-theme/src/styles/design-platform.css`](packages/client/ui-theme/src/styles/design-platform.css) is canonical. Feature CSS consumes `--clocky-alias-*` and `--clocky-specific-*` aliases; it does not introduce literal colors.

## Colors

The visual hierarchy comes from neutral bluish surfaces, low-contrast borders, and dark primary text. `--clocky-alias-state-business-primary` is the one active accent; success, warning, and error remain semantic states rather than decoration. Theme sheets define both light and dark values, so feature CSS uses aliases only.

## Typography

The system stack in [`base.css`](packages/client/ui-theme/src/styles/base.css) prioritizes native desktop rendering and CJK fallbacks. Body copy is compact and readable; sidebar objectives use 13px/18px, state metadata uses 11–12px, and code uses the dedicated mono stack. Labels are sentence case in English and natural Chinese in Chinese; neither locale relies on forced uppercase.

## Layout

The sidebar is a 56px collapsed rail or an expanded column with 12px inline padding. Its New Task control is 38px high; task rows are at least 44px so objective and phase remain legible without a second detail panel. The center column owns the resident transcript/composer frame. Scrollable regions keep their own flex/min-height chain and stable scrollbar gutter; no feature sets viewport height on a shared shell.

## Elevation & Depth

Hierarchy uses tonal surfaces, thin borders, and hover fills. Cards and menus may float, while routine sidebar rows and transcript content stay flat. Overlay depth belongs to shared primitives, not individual Team rows.

## Shapes

Rows use 8px corners, primary controls use 12px, and compact lifecycle badges use pills. Borders are subtle; icon-only rail controls remain circular and always have accessible labels.

## Components

### Foundational visual states

Interactive rows provide hover, selected, disabled, and busy states. Team loading and empty states retain the list region's geometry. Errors appear inline beside the task list; transient notices use the shared toast surface.

### Buttons and actions

New Task is the primary sidebar action. Team rows are semantic buttons and selection is reflected with `aria-current="page"`. Busy selection disables competing rows without changing their layout.

### Navigation and data display

The Team list is the product-level navigation surface. A coordinator Session remains a descendant transcript, not a second top-level task identity.

### Forms and overlays

The existing resident composer remains the single first-input surface. Its text area stays stable across draft-to-transcript transitions, supports IME composition, and shows retryable failures without losing the draft. Dialogs, menus, tooltips, and toasts use shared primitives. Modal forms use the native dialog layer for focus and background isolation, with long form bodies scrolling between a persistent title and action row.

### Iconography

Use the existing 16px outline icon set. Icons complement labels; the collapsed Team control remains labeled for assistive technology.

### Motion

Use the existing `--ds-ease-in-out` timings: short feedback around 100–200ms and sidebar layout movement at 300ms. Motion communicates selection or layout change and respects the application reduced-motion behavior.

## Do's and Don'ts

- **Do:** make Team objective and lifecycle immediately scannable in the sidebar.
- **Do:** preserve the transcript/composer frame when a Team opens its coordinator transcript.
- **Don't:** color-code a lifecycle state without its text label.
- **Don't:** add a dashboard, a second composer, or screen-local color tokens for Team navigation.
