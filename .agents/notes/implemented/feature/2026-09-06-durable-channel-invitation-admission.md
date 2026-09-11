# Agent Note: Durable channel invitation admission

Status: implemented

English | [中文](2026-09-06-durable-channel-invitation-admission.zh.md)

## Problem

An active logical Participant or registered channel adapter does not prove the receiving endpoint supports a newly opened protocol. Immediate channel activation allows dispatch before that endpoint accepts its manifest. Optional participants also make broadcast recovery ambiguous if recipient membership is recomputed after later consent or expiry.

## Decision

Channel creation commits opened, pending and per-member invitations atomically. The Hub freezes role, channel visibility, required status, deadline, endpoint expectation, revision and canonical manifest fingerprint. A current activation, authenticated human call or named endpoint owner supplies a short-lived proof for the complete acknowledgement payload. The last required acknowledgement and active phase share one WAL append. A notification, callback return or plugin registration never substitutes for durable acknowledgement.

Each Envelope record stores its actual ordered `DeliveryIntent[]`. Commit and replay compare that array against the retained adapter's plan and the admission state at that exact WAL position. Recipient ids must be unique manifest members, reference that Envelope and retain its protocol delivery treatment. Historical pending delivery uses those stored intents; later optional acknowledgements cannot add an old broadcast recipient. Only direct-v4 broadcast can omit optional endpoints that have not acknowledged. Other protocols require every planned recipient to have consented.

Optional invitation expiry requires an explicit retained-adapter `allowParticipantRemoval()` decision. Direct v4 permits it while at least two invitation members remain; fixed-role protocols without that capability fail explicitly. Channel close enters closing, ends pending invitations, then writes its terminal record. Late acknowledgements cannot reactivate a terminal channel. Required expiry records a structured reason and an expired channel. Recovery and checkpoint data retain invitations separately from message receipts.

The admission Consumer scans bounded durable pages using its current clock and exact expiry proofs, and exposes cancellation-aware active-channel waits. Local and WebSocket v6 Links replay only unacknowledged endpoint invitations. Agent Client validates its actual binding and supported manifest before acknowledging. Scheduler wake/review operations and TeamRun creation/workflow compilation wait before dispatch. No lock is held across endpoint waiting.

TeamRun accepts a runtime-only `admitHumanChannel` capability for a principal-owned human. Host and SDK Consumers retain their current authenticated call, validate the exact direct-v3/directed-v1 product manifest, and issue a payload-bound human proof. The capability never crosses JSON and is excluded from the start fingerprint. Failure follows creation cleanup; an accepted same-key start returns its original result. The system result Consumer confirms its own supported human endpoint independently.

## Alternatives considered

**Activate from adapter registration.** Rejected because Hub code availability proves nothing about the actual receiving Agent, human transport or service.

**Modify the manifest after optional expiry.** Rejected because it would change historical broadcast recipients and protocol interpretation. The manifest stays immutable; invitation transitions and fixed per-Envelope intents carry the changes.

**Wait for browser acknowledgement before returning start.** Rejected because the browser cannot inspect the still-unreturned channel. The authenticated Host/SDK endpoint confirms supported admission within that call; display acknowledgement remains separate.

## Consequences

New channel storage rejects older WAL/checkpoint formats, and remote peers use frame v6. Default TeamRun remains direct v3 until its remaining product and remote-tool Consumers support direct v4. Generic Host/SDK invitation methods and the human display/final inbox remain separate integrations; this decision does not mark the whole channel work package complete. [Direct v4](2026-09-06-direct-v4-recipient-delivery.md) retains its explicit message/final rules.

Keyless JSON/SQLite Loader runs exercise actual local and WebSocket endpoint acknowledgement, blocked pre-admission dispatch, ordered image messages and Session receipts. Existing default TeamRun, worker, workflow and worker-pool examples also cross the admission wait. Host fetch and authenticated SDK creation exercise the principal callback. Public Hub tests verify deadline recovery, optional removal, late consent without historical recipients, restart persistence and close-before-ack behavior.
