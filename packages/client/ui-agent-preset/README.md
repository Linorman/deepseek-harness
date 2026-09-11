# clocky-client-ui-agent-preset

English | [中文](README.zh.md)

The agent-preset surfaces: a General-settings row choosing which [preset](../../preset/agent-presets/README.md) later Team coordinators use, a read-only label in a coordinator Session header, and a settings section that manages the roster — copy, delete, default, and the way into a preset's own files.

## Why it is a Team-start preference

A coordinator Session's preset is fixed when the Team starts, because its history is produced under that preset's tools. Changing the default applies to later Teams and never switches an active coordinator.

## The session-header label

A read-only surface beside the coordinator Session title names the preset that Session runs. It reads the preset from the Session summary and resolves the display name against the same roster the General row reads.

## What it reads and writes

Options and the current default both come from one `agentPreset.list` call. The write targets the `agent-presets` settings namespace's `default` field, which the Host resolves when a Team starts.

A locally authored preset is exactly as privileged as the plugins it names, so the list marks `user` rows rather than presenting every preset as shipped and vetted.

Preset files publish one unlocalized `name` and `description`, which Web uses for every `user` row and unknown `system` row. For the four shipped ids (`standard`, `code`, `minimal`, and `cordis`), Web resolves both fields from its active locale only when the roster marks the row `system`; an identically named `user` preset keeps its file metadata.

The row re-reads on `settings/changed` for its own namespace and on `connection/reset`: the roster is a live directory and the default is a settings field, so an external edit or a reconnect can both move it.

## The management section

A third surface, its own settings page (`settings.section` id `agent-presets`, ordered after Models — choosing a model is routine, composing an agent is the deployment-shaping act behind it): the roster as cards, a copy dialog as the only way a preset is created, and a read-only viewer over the shipped compositions.

The browser edits no composition text. Editing YAML in a web textarea was a weak surface (no completion, no highlighting, no diff), so a new preset is a host-side copy of an existing one — the dialog collects an id (it becomes the directory name, which is why it must be named up front and cannot change later) and an optional display name, and `{ from, id, name? }` is all that crosses the wire. Everything else — description, composition, skills — is edited in the preset's own files, and the page's other job is getting the user TO those files: the copy completes by opening the new directory, and every custom row keeps a location action. Where the host has no desktop opener (`hasDocument: false` on the roster; remote and container deployments), the same actions answer the directory as text on the row instead of offering a button that would spawn into nothing.

A preset publishes its own description, of any length, and the grid sizes every card row alike — so an unbounded description would set the height of the whole roster. Cards clamp it to four lines and offer the rest in a tooltip, attached only while the text is actually cut off. The clamp is CSS, so the whole description stays in the accessibility tree whatever the card shows.

A shipped preset opens in the read-only viewer. It is the known-good composition a copy starts from, so reading it is the point; it offers no location and no delete — its install is overwritten by upgrades and is not the user's to manage. The intro carries the guidance a create button used to imply: duplicate an existing preset and make it yours, or let the agent draft one in Creator mode.

Beside copying sits the conversational entry: when the roster carries the self-referential `cordis` preset, a dashed add-card creates a Team draft carrying that preset and clears the selected transcript. The first composer input calls `team.start`, which creates its coordinator with `cordis`.

The dialog mirrors the host's own containment rule (`[a-z0-9][a-z0-9-]*`) and refuses a name already in use — a copy never overwrites. Both checks are conveniences: the host re-applies them and its answer is what the dialog reports on failure.

Deleting removes the preset directory. Coordinators already composed from it keep running — a composition is mounted once at Team start and nothing re-reads the file.

A roster row carrying `broken` (the host's shape check found the composition missing or unloadable) renders as a marked card: red border, a "Failed to load" badge (what discovery observed, not a claim that the files are damaged — the usual cause is a composition the user just edited or deleted), the reason verbatim, the body disabled — it cannot become the default — and duplication disabled, since a copy of a broken preset is another broken preset. A broken custom row keeps its location and delete actions, because the files are where it gets fixed and deleting is how a ghost directory (composition deleted by hand, directory still blocking the id) is cleared; a broken shipped row withholds the viewer too — there is no readable composition to show. The General selector drops broken presets entirely because it chooses a later Team's coordinator composition.

Setting the default writes the `agent-presets` settings namespace, which the host exposes to configuration clients through the registered settings seam ([`clocky-apiproxy`](../../host/apiproxy/README.md) does not maintain a product-wide namespace allowlist).

`agentPreset.read`, `copy`, `openDocument`, and `remove` are loopback-pinned ([`clocky-client-connection`](../connection/README.md)): a composition names the plugins a session runs, so reading one is reconnaissance, and the rest manage the roster and drive the host desktop. `agentPreset.list` is not — it carries ids, trust, and the two path-free capability flags, and a LAN client's picker needs it.

## When the surfaces are absent

A deployment that composes no presets answers with an empty roster, and the row, label, and section all render nothing — every Team then shares the Host composition, and there is nothing to choose between or manage. A deployment that configures no writable root answers `authorable: false`, and the section stays a read-only browser: the shipped compositions still open in the viewer, but every copy action is disabled with the reason as its tooltip rather than offering a dialog whose create always fails.

## Model Experience

Indirectly, through the preset a later Team coordinator is composed from; [`clocky-agent-presets`](../../preset/agent-presets/README.md) owns what that composition puts in front of the model.

#### KV Cache effect

No direct invalidation. Changing the default never touches an active coordinator's prefix; a later Team establishes its own prefix from its own composition.

## Known Limitations and Deferred Work

- **A preset without metadata is listed by id** — display text is optional, and a copy given no name deliberately falls back to its directory name rather than presenting itself identically to its source.
- **A revealed path is display text, not a link** — where the host has no desktop opener the row shows the directory to copy by hand; the browser cannot open a host filesystem location itself.
- **Composition edits are invisible to the page** — the files are edited outside the browser and nothing on the wire announces a file change, so the roster re-reads on its own actions, `settings/changed`, and `connection/reset`, not on every disk edit.
