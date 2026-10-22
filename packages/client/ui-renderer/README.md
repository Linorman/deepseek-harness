# @clocky/clocky-client-ui-renderer

English | [中文](README.zh.md)

The browser Cordis plugin that owns the React rendering layer. [`clocky-client-web`](../web/README.md) renders a framework-free boot page and loads the complete client plugin roster; after every entry activates, it checks `ctx.uiRenderer.hasRootRegistration()` and calls `mount(container)`. This package provides that service, installs the slot renderer, hydrates the existing boot DOM, switches to the assembled application before the next paint, and returns an idempotent disposer for the mount and its registration subscription. A mount waits through temporary missing-root registration during provider reloads, unmounts a withdrawn root and mounts its replacement. Initial boot still rejects a roster with no root registration.

The client entry also owns the React implementation of slot outlets, session providers, and observable-to-uSES binding. Business plugins pass bare observable sources through typed slot `hooks`; the renderer binds them at the outlet. The plugin activates after `slots` and `sessions`, projects the selected session title, and performs the sole context-level `renderSlot('root')` call. React, React DOM, Cordis, ui-slots, and ui-primitives retain one browser identity through the web shell's static module table; this package arrives as a dynamic client bundle.

## Model Experience

None, as the UI renderer only assembles browser UI and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **The first application frame waits for every client entry** — the boot kernel hands over the mount point only after the loader roster settles. Per-region readiness remains deferred.
- **Slot rendering has no Suspense integration or per-entry lazy loading** — the complete plugin roster settles before the renderer mounts the root.
