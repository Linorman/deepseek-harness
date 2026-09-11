# Agent Note: SDK post-bind Team Link enrollment

Status: implemented

English | [中文](2026-08-29-sdk-post-bind-team-link-enrollment.zh.md)

## Problem

An SDK-placed remote Agent has no shared Team Hub or Session store. Its activation can become durable before a remote Link is authorized, but starting delivery before that binding commits would deadlock against the Hub's attach check. A process-wide capability environment variable also cannot safely distinguish concurrent child activations.

## Decision

`ctx.teamLinks` has a separate effect-scoped enrollment-issuer registry. A trusted activation owner reserves an opaque credential for one exact current binding only after the Team controller commits it. The issuer returns endpoint, remote Link provider name, credential, and a revoker. Credential plaintext never enters configuration, the Team journal, Session logs, or diagnostics; the [durable WebSocket enrollment ledger](2026-09-01-durable-websocket-enrollment-ledger.md) retains only its SHA-256 digest, generation, and revocation state.

The SDK runtime provider observes the matching durable `activation/changed` event, reserves the credential, and calls strict `activation/link-enroll` on its child. The request repeats the complete activation target and provider-bearing binding. The SDK server accepts only its current live Agent and that exact binding, treats identical enrollment as idempotent, installs an activation-local WebSocket provider from an in-memory credential closure, and starts `FixedBindingTeamAgentLinkDelivery` for the Agent.

Child shutdown closes that delivery and unregisters its provider before remote activation disposal. The placement owner revokes the credential after the remote side closes, then reaps the SDK process. Revocation removes the Hub credential and closes an attached socket.

## Alternatives considered

**Pass a static environment credential to every SDK child.** Rejected because concurrent activations would share mutable process-level authority.

**Attach before durable binding.** Rejected because the WebSocket Hub correctly refuses an attach without a current binding, while the activation controller cannot commit that binding until placement publishes.

**Add a second SDK Envelope-delivery protocol.** Rejected because it would duplicate Link authentication, claims, receipt ordering, reconnect, and task-start semantics.

## Consequences

An SDK child can admit direct or task-assignment delivery and write a durable receipt without shared Hub memory. Same-process listener/issuer HMR and full local Hub restart recover a current dynamic credential from the durable ledger. Remote workers can report outcomes and remote coordinators can send an atomic direct final through their borrowed fixed Link. Same-host cold replacement is owned by the [SDK remote placement decision](2026-08-28-sdk-remote-agent-runtime-placement.md).

## Verification

Core registry, WebSocket Hub, WebSocket client, SDK protocol/client/server, remote placement, and fixed-delivery tests cover issuer registration, invalid/revoked credentials, post-bind ordering, exact target/binding checks, duplicate enrollment, child teardown, receipt admission, task reporting, and atomic final delivery. A real two-process SDK child receives a direct Envelope through a dynamic credential, records its Hub receipt, renews after listener/issuer HMR, and can post a human-addressed final.
