# @clocky/clocky-client-ui-sidebar

English | [中文](README.zh.md)

Sidebar shell plugin: the brand row, New Task action, layout-owned collapse control, scroll-aware Team region, and bottom-pinned Settings seat. [ui-team](../ui-team/README.md) owns the Team navigator rendered into `sidebar.teamTasks`; the optional `sidebar.workspaces` seat remains available only to explicit custom compositions that mount the legacy Workspace/Session browser. This package does not derive Team rows or own their view preferences. Collapse into the layout-owned 56px rail remains presentation-local. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The expanded brand row renders `sidebar.brand.mark` and `sidebar.brand.name` as independent single slots, while the collapsed rail renders the same mark slot. Without occupants, the shell uses robot fallback artwork and keeps the build revision separate from the wordmark seat. A deployment package can replace either value without replacing the New Task control or rail geometry; declaration-aware `slots.inject()` lets such a package activate before or after the sidebar.

New Task creates only a page-local Team draft and clears the selected transcript; it creates neither a Team nor a Session until the first input is admitted by `team.start`. Team-specific navigation belongs to ui-team.

`SidebarRootComponentProps` composes the layout owner share, global Session and Workspace hooks, the declared brand, `sidebar.teamTasks`, optional `sidebar.workspaces`, `sidebar.settings`, and footer child slots, plus injected `startTask` and sidebar-toggle callbacks. There is no plugin store.

During a live collapse, the shell holds the expanded content at its current width while it fades out for 150ms. The upper controls—the shell toggle, New Task, and Team rail control—share one 150ms fade and 49px leftward translation into the 56px rail, ending with the layout's 300ms column slide; every 36px control box follows the same path to the rail's 10px left inset. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The scrolling Team region reserves its own gutter, so revealing a thumb never reflows rows.

The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`); ui-settings registers the trigger row and settings panel there.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders browser navigation; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
