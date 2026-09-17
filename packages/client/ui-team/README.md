# @clocky/clocky-client-ui-team

English | [中文](README.zh.md)

`@clocky/clocky-client-ui-team` renders the Team navigator and operational workspace from `ctx.teamTasks`. Selecting a Team or child Team uses read-only inspection; the explicit Resume action owns execution recovery. The overview summarizes complete-Team task counts, subtree usage, human attention, members, bounded recent activity, and visible artifacts. It never reconstructs Team authority from Session transcripts.

The plugin contributes to `sidebar.teamTasks` and `team.workspace` through declaration-aware `slots.inject()`. Tasks, channels, members, artifacts, workflow plans, and audit records have separate views. A task table opens one compact inspector; complete instructions, attempt history, review, integration, stop, and deletion remain explicit operations. Mutation failures retain the current form and authoritative revision checks.

A registration-owned viewing store retains Team-local filters, task selection, scroll positions, and channel drafts. URLs contain only view identifiers and filters; browser navigation restores them through read-only Host projections and rejects task, channel, or Session identifiers belonging to another Team. Session inspection opens on demand in the layout-owned subpage. Task attempt links resolve their recorded Participant through its immutable Session binding, and stale asynchronous requests cannot select a Session after a later navigation or dismissal.

The detail forms invite and manage members, create direct channels, post addressed messages, edit task prerequisites, record review decisions, and create artifact integration tasks through authenticated Host commands. Failed commands retain drafts; task edits and reviews require explicit confirmation after the task revision changes. Team lists, channel records, and audit records expose explicit continuation controls, with prior records retained after a failed read.

Selected-Team collections are read independently through bounded member, task, workflow-plan, and artifact pages. Each collection owns its cursor, loading state, continuation state, error, and newer marker; Next page replaces the current window, First page returns to the beginning, and Refresh rereads the current page. Each collection retains at most one server-capped page; selected task inspection and unsent input survive navigation. A late response from a previous selection is discarded. Failure preserves loaded rows and newer markers; cancellation clears loading, and failed initial pages expose Refresh. Task forms use the inspected record and bounded attempt choices; Team-wide form choices still use the Team projection. The artifact view exposes only provider-approved non-private references.

Child task details show the durable execution/delegation phase, failure, admitted result text, and visible result artifacts. `openTeam(childTeamId)` opens the child read-only and never resumes it. Task rows use browse summaries; current task fields and histories load separately with revision checks. Workflow rows accept newer same-id revisions from the Team snapshot. Off-page workflow tasks open the inspector and focus its close control without fabricating a list row. Workflow plans are read-only projections of phase, bounds, ordered templates, bindings, dependencies, result count, and failure; `team_workflow_*` tools remain the authoring owner.

Member details read exact identity, role and non-secret placement hints plus one capability page through `team.member.inspect`. Continuation uses the observed Team cursor; a conflict requires refresh. The page never includes grants, startup configuration or attempt statistics, and remains subject to the Hub response byte allowance.

Retained channel drafts default to 32 entries and 8 MiB of serialized draft records across Teams. Public browser options `maxDrafts`, `maxDraftBytes` and `maxViewStates` are configured through `client-modules.browserConfig["@clocky/clocky-client-ui-team"]`. View preferences default to 128 entries and evict only old views without drafts; `maxViewStates` must exceed `maxDrafts`. Capacity rejection preserves the previous draft and blocks sending if retry identity cannot be stored. Confirmed sends and explicit confirmed discard release the draft slot. Image batches are checked against `maxDraftBytes` before file reads, including base64 expansion, existing content and filename metadata; admitted files encode sequentially. The store still checks the combined retained quota before publishing a draft.

## Model Experience

None, as this UI only reads durable Team projections and sends management mutations through authenticated Host commands.

#### KV Cache effect

Channel messages use the existing logged delivery projection. Navigation and unsent forms do not rewrite model history. The channel form sends authored text through the durable Team Envelope path; its selected audience and context, turn, or steer delivery determine which Participants receive logged input. Other management forms change durable Team state through their owning Host commands.

## Known Limitations and Deferred Work

- **Artifact providers** — integration requires a configured workspace provider and a valid source attempt; provider-less references stay metadata-only, and private artifacts are not listed.
- **Approval/question routing** — the page lists live and durable requests with provenance; answer controls remain owned by the Host interaction APIs and coordinator transcript.
- **Transport/browser verification** — collection races, remote transport, and full child/workflow mutation journeys still require the separate browser and multi-host evidence lanes.
