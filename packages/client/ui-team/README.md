# @clocky/clocky-client-ui-team

English | [中文](README.zh.md)

`@clocky/clocky-client-ui-team` renders the Team task navigator in the sidebar and a frame-wide, Environment-style detail popover in the upper-right corner. The popover starts compact, remains hideable from its trigger or close control, and supports viewport-clamped pointer or keyboard resizing with a reset action. It reads the browser-owned `ctx.teamTasks` projection, shows durable Team objectives and phases, and opens a selected Team's coordinator Session only as its transcript descendant. It does not derive Team state from Session rows.

The plugin contributes to `sidebar.teamTasks` and `shell.overlay` through declaration-aware `slots.inject()`. Selection first resolves the Team through `ctx.teamTasks.open()`, refreshes the Session projection, and then opens the coordinator Session returned by the Team state. The sidebar keeps only the workspace list and add-workspace action; the selected detail is rendered in the floating popover. It keeps objective, lifecycle diagnostics, worker assignments, task results, channel records, visible artifacts, and audit entries compact; raw limits, channel payloads, and audit facts open on demand. Lease-free tasks can be deleted and assigned/running tasks can be stopped through authenticated confirmation flows, while a failed mutation keeps its dialog open. Reads are owner-provided and cancellable; a failed read stays inline without replacing the selected Team.

The collapsed rail uses one labeled button that expands the sidebar; the wide list keeps familiar sidebar rows and token-backed states. `TeamPage` is available for a durable detail view with objective, roster, task graph, channels, stall diagnostics, and lifecycle controls. The runtime emits Team/channel change frames and the browser owner also runs a bounded refresh loop, so a second host or remote activation converges without scraping Session transcripts.

The detail forms invite and manage members, create direct channels, post addressed messages, edit task prerequisites, record review decisions, and create artifact integration tasks through authenticated Host commands. Failed commands retain drafts; task edits and reviews require explicit confirmation after the task revision changes. Team lists, channel records, and audit records expose explicit continuation controls, with prior records retained after a failed read.

Selected-Team collections are read independently through bounded member, task, workflow-plan, and artifact pages. Each collection owns its cursor, loading state, continuation state, error, and newer marker; Load more and Refresh actions are explicit. A late response from a previous selection is discarded. Failure preserves loaded rows and newer markers; cancellation clears loading, and failed initial pages expose Refresh. The authoritative Team snapshot remains the mutation fallback. The artifact view exposes only provider-approved non-private references.

Child task details show the durable execution/delegation phase, failure, admitted result text, and visible result artifacts. `openTeam(childTeamId)` opens the child read-only and never resumes it. Loaded task and workflow rows accept newer same-id revisions from the Team snapshot. Workflow task and dependency links reveal and focus at most one off-page task at a time. Workflow plans are read-only projections of phase, bounds, ordered templates, bindings, dependencies, result count, and failure; `team_workflow_*` tools remain the authoring owner.

## Model Experience

None, as this UI only reads durable Team projections and sends management mutations through authenticated Host commands.

#### KV Cache effect

Channel messages use the existing logged delivery projection. Navigation and unsent forms do not rewrite model history. The channel form sends authored text through the durable Team Envelope path; its selected audience and context, turn, or steer delivery determine which Participants receive logged input. Other management forms change durable Team state through their owning Host commands.

## Known Limitations and Deferred Work

- **Artifact providers** — integration requires a configured workspace provider and a valid source attempt; provider-less references stay metadata-only, and private artifacts are not listed.
- **Approval/question routing** — the page lists live and durable requests with provenance; answer controls remain owned by the Host interaction APIs and coordinator transcript.
- **Transport/browser verification** — collection races, remote transport, and full child/workflow mutation journeys still require the separate browser and multi-host evidence lanes.
