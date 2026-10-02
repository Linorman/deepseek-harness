# Agent Note: Team Session reads and retained product observers

Status: implemented

English | [中文](2026-09-28-team-session-product-readers.zh.md)

## Problem

A Team-scoped member link can lead to generic Session APIs and aggregate streams. Filtering Team pages alone leaves Session bodies, projections and queued events readable by another principal. A live header states provenance but cannot prove a durable Team binding. Retained client fibers can also show old data after the authenticated principal changes.

## Decision

`session-content-read` fingerprints the complete Team/member/Session tuple. The human binder selects current direct or canonical parent read authority; the Hub additionally requires an agent member's activation reservation or durable activation binding for that Session. Historical bindings remain readable under current authority. Reading does not activate the member, resume the Team or start a model.

Subagent headers may contain only `parentSession`. Host readers follow immutable headers to the nearest explicit Team owner or standalone root; a missing parent or cycle refuses content access. Current authority is checked on the Team member's exact bound Session, and list rows retain the derived Team identity for revocation cleanup. Explicit Team metadata still requires its own binding and cannot borrow a different ancestor's identity.

Host history, model metadata and image reads retain this proof through IO and check it again before publication, including failed reads. Session listing and search exclude unauthorized Team bindings before projections or cold-body probes. Membership and canonical delegation changes invalidate in-flight aggregate responses. Standalone Sessions retain their existing Host access semantics.

Mux and Host queues capture immutable Session provenance at emission, including disposal, and authorize each frame immediately before delivery. Team/channel events use current Team read authority. One reader lease pins the transport principal and ends the stream on authentication revocation or binder unload, including an idle stream. Count and byte allowances are validated deployment config; overflow clears the backlog and terminates the stream so consumers reconnect and refetch. A denied frame for a previously visible Team emits only its already-known identity as `team/access-revoked`.

Both HTTP read-channel dispatch and WebSocket source opening pass the complete authenticated call. The WebSocket opens the source under that call after upgrade; forwarding only an abort signal would lose its principal. The gateway root exports the shared call context from the same bundle as its API implementation. A separate bundled context would issue facts to an instance the API never reads.

Authentication retirement closes a downlink with protocol code `4001`; the browser discards queued frames and reports structured access loss. HTTP 401/403 and explicit product refusals are distinct from ordinary network failure. The connection controller holds frames until Host description and authorization reset complete, rejects retired-generation frames and reports denial once per generation. That signal clears Session content/fibers, Team data and local first-input drafts, and workspace metadata, fencing their pending responses. Ordinary disconnection retains prior readable content.

Session-owned forwarded events use the same current content authority. Preset changes carry Session identity; activation requests/resolutions, package announcements/retractions and inspect-query settlements derive `agentId` from the retained producer record. Each notification can be checked independently, including after its request is gone. Unknown cold identities require metadata lookup rather than public delivery. Command, credential-reference, adapter and settings notifications keep Host metadata semantics; forwarded names and arguments remain unchanged.

The Session runtime clears related views, retained fibers and caches on Team revocation. A changed Host authorization scope clears all Session state before the next authenticated list is published. Generation checks prevent an older list response from repopulating that state. These rules complement the [directory and byte-read decision](2026-09-28-principal-team-directory-and-readers.md); they do not replace Team mutation or invitation authorization.

Workspace responses and queued snapshots filter Session and archive references using current content authority. Known inaccessible references reject reorder/archive before registry mutation. Client workspace generations fence pending baselines and unary echoes; revoked references remain excluded from late frames until a current authorized baseline restores them. Workspace paths, titles and registration order remain Host metadata.

ZIP preparation checks the root metadata before body IO. Each descendant and media read retains its own Session authority through IO; shared media keeps its first referring Session as a deterministic owner. Each compressed block rechecks that owner after waiting for consumer capacity. Withdrawal fails the archive without publishing a valid partial ZIP. Request/authentication/source retirement cancels production, and completion or cancellation retires the reader. Export failures expose no backend diagnostics.

## Alternatives considered

**Trust Team identifiers in Session headers.** A mismatched or unbound Session would gain content access without the Team's durable relationship.

**Authorize streams only when opened.** Frames already queued before membership withdrawal would publish under expired authority.

**Leave retained views hidden in client state.** Reopening a view after principal replacement could expose the previous principal's cached data.

**Grant the entire archive from its root or image digest.** A descendant or shared media reference can require different current authority; the root and digest cannot supply that relationship.

## Consequences

Historical member records remain inspectable without execution side effects. Per-frame/block authority checks and cold ancestry metadata reads add work; configured queue bounds establish no throughput guarantee. Missing ancestry requires repair before product content access. [SDK Team readers](2026-09-28-sdk-principal-team-readers.md) own authorized directory and selected reads; SDK notifications retain a separate audit. Simulation's dormant frozen Sessions require its separate run-aware product authority. Form-draft retention and discard rules remain owned by the product interaction work.

## Verification

Real-Hub Host tests cover two principals, Session lists/content, queued events, forwarded Session notifications, IO-time revocation, idle retirement and queue overflow. Workspace and ZIP tests cover scoped references, mutation replies, root refusal before IO, legitimate descendants/media, and missing/cyclic ancestry. Carrier/controller tests verify authenticated dispatch, retirement code, explicit denial and holding frames until authorization reset. Client tests cover cache eviction and late baselines/mutation echoes. Current-build real-Host member/child navigation, ZIP and local-provider credential-rotation browser scenarios own the product path.
