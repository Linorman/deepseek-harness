# @clocky/clocky-client-ui-layout

English | [中文](README.zh.md)

`simulation.workspace` is an independent root seat. `ctx.layout.showWorkspace('team' | 'simulation')` changes transient viewing selection only; it does not start or cancel execution. The `workspace` URL key restores this selection, and an absent Simulation occupant renders a localized return action. Session and Team subtrees retain their existing owners. See the [Simulation UI](../ui-simulation/README.md).

`ctx.layout.navigate(href)` pushes a same-origin viewing URL without reloading memory drafts and notifies the destination route owner. Browser Back/Forward restores product visibility. `teamInspectionUrl()` builds exact Team/task/channel/Session read links, clears inherited forms and unrelated filters, and preserves application settings. Session targets always include the original participant and Session; the Team owner rechecks their current binding and access.

Source return stores one same-document route with whitelisted view parameters and its exact Team target in browser history. After the source owner revalidates, Back or the return action restores the invoking link, falling back to its heading. Hidden workspaces cannot consume that focus marker. A requested Team route suppresses the initial conversation surface until a Session is explicitly selected, including when the target read fails.

Workspace frame plugin: `AppFrame` registers into `root` and declares `sidebar`, `team.workspace`, `conversation`, `details`, and `shell.overlay`. Team content is independent of Session selection. A stable native dialog container presents the conversation as a named inline region before Team creation and as an in-page modal during Team inspection; its return action clears viewing selection without cancelling execution. Session context, expansion, keyboard dismissal, and focus restoration belong to this frame. A collapsed tool-details subtree stays mounted but is hidden from keyboard and accessibility navigation.

The transient layout store starts with a 224px sidebar and closed details. The sidebar is draggable between 208px and 420px and collapses to a 56px rail. The conversation and tool-details occupants retain fixed component positions inside the Session container. Details width remains a preference: absent or blank Sessions render it at zero width, and selecting a different non-blank Session closes it before paint. The concession solver shrinks details before sacrificing conversation width.

The theme presenter consumes resolved `ctx.theme` snapshots and updates native color scheme, the body theme attribute, aliases, and its owned theme-color metadata. Disposal removes these writes. Business values reach frame occupants through standard framework hooks and their own injected callbacks. AppFrame, SessionStage, the layout store, and the column solver remain package-internal; the public client face contains loader entries, the layout service, and owner-share types.

The sidebar owner share includes the active product workspace. The Session title distinguishes an authorized current coordinator conversation from execution-record inspection; worker, historical and Simulation-managed views do not acquire authoring authority from their presentation.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
