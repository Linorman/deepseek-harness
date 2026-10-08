# 令牌对比度测量表

由 `tools/contrast-table.ts` 从 `packages/client/ui-theme/src/styles/tokens.css` 生成（WCAG 2.x 相对亮度）。`packages/client/ui-theme/tests/tokens.client.spec.ts` 以同一算法把下限作为门禁。这是令牌层测量；组件实际叠放（如悬停底色、禁用态）的抽查在 WP10 中另行进行。

| Foreground | Background | Floor | Light | Dark |
|---|---|---|---|---|
| `fg-primary` | `bg-canvas` | 4.5:1 | 16.12 | 15.15 |
| `fg-primary` | `bg-surface` | 4.5:1 | 17.28 | 13.94 |
| `fg-primary` | `bg-sunken` | 4.5:1 | 15.14 | 15.71 |
| `fg-primary` | `bg-sidebar` | 4.5:1 | 15.14 | 15.71 |
| `fg-secondary` | `bg-canvas` | 4.5:1 | 7.58 | 9.38 |
| `fg-secondary` | `bg-surface` | 4.5:1 | 8.13 | 8.63 |
| `fg-secondary` | `bg-sunken` | 4.5:1 | 7.12 | 9.73 |
| `fg-secondary` | `bg-sidebar` | 4.5:1 | 7.12 | 9.73 |
| `fg-tertiary` | `bg-canvas` | 4.5:1 | 5.25 | 6.64 |
| `fg-tertiary` | `bg-surface` | 4.5:1 | 5.63 | 6.11 |
| `fg-tertiary` | `bg-sunken` | 4.5:1 | 4.93 | 6.89 |
| `fg-tertiary` | `bg-sidebar` | 4.5:1 | 4.93 | 6.89 |
| `accent-fg` | `bg-canvas` | 4.5:1 | 6.09 | 8.25 |
| `accent-fg` | `bg-surface` | 4.5:1 | 6.53 | 7.59 |
| `accent-fg` | `bg-sunken` | 4.5:1 | 5.72 | 8.56 |
| `accent-fg` | `bg-sidebar` | 4.5:1 | 5.72 | 8.56 |
| `status-running-fg` | `status-running-bg` | 4.5:1 | 5.87 | 6.53 |
| `status-waiting-fg` | `status-waiting-bg` | 4.5:1 | 5.90 | 6.78 |
| `status-needs-you-fg` | `status-needs-you-bg` | 4.5:1 | 5.19 | 8.15 |
| `status-blocked-fg` | `status-blocked-bg` | 4.5:1 | 5.13 | 7.35 |
| `status-done-fg` | `status-done-bg` | 4.5:1 | 5.22 | 7.76 |
| `status-failed-fg` | `status-failed-bg` | 4.5:1 | 5.83 | 7.62 |
| `status-idle-fg` | `status-idle-bg` | 4.5:1 | 5.89 | 6.48 |
| `tint-teal-fg` | `tint-teal-bg` | 4.5:1 | 5.69 | 8.27 |
| `tint-fuchsia-fg` | `tint-fuchsia-bg` | 4.5:1 | 6.15 | 7.70 |
| `tint-olive-fg` | `tint-olive-bg` | 4.5:1 | 5.85 | 9.28 |
| `tint-slate-fg` | `tint-slate-bg` | 4.5:1 | 7.12 | 7.73 |
| `fg-on-accent` | `accent-bg` | 4.5:1 | 5.77 | 4.67 |
| `border-strong` | `bg-surface` | 3:1 | 3.72 | 3.81 |
| `border-focus` | `bg-surface` | 3:1 | 4.67 | 5.50 |
