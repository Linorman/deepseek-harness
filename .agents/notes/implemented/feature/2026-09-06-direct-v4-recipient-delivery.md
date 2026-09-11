# Agent Note: Direct v4 recipient delivery

Status: implemented

English | [中文](2026-09-06-direct-v4-recipient-delivery.zh.md)

## Problem

Two-party product channels cannot express a message to a selected group or preserve independent delivery progress for several recipients. Treating assistant output as an implicit reply would also send content without an explicit participant command.

## Decision

Direct v4 accepts at least two distinct members and ordered text/image messages addressed to an explicit nonempty subset or to every other member with a null audience. The immutable manifest, Envelope and stateless adapter determine one delivery intent per recipient. Existing channel WAL and recipient receipts persist that progress; no extra mutable delivery map or wire format is required. Hub admission checks all addressed participants are active while holding its Team/channel locks.

The activation-bound Link and Agent Client consume each recipient independently. Inbox admission retains sender and Envelope provenance, preserves content order and delivery treatment, and flushes the Session before receipt. A delayed recipient activation replays its outstanding message without receiving a private subset message or reopening another participant's settled receipt. The local `team_message` tool prepares the v4 text content payload. Ordinary assistant output creates no channel Envelope.

A final is restricted to an exact two-party coordinator/human channel, an actual coordinator Agent sender, an actual human recipient, an explicit singleton audience and turn delivery. Adapter validation checks the manifest roles; the Hub checks their actual Team identities. Accepting the final does not manufacture a human receipt or complete the Team.

## Alternatives considered

**Redefine v3 as a group protocol.** Rejected because stored v3 channels retain their exact two-party interpretation. V4 is explicitly selected; default TeamRun creation stays v3 until its admission and final Consumers support the complete protocol.

**Record a second recipient-intent log.** Rejected because immutable v4 planning and the existing WAL already reconstruct independent pending recipients. A second authority would introduce disagreement during recovery.

## Consequences

Group messaging uses the same claim, Session persistence and receipt machinery as [direct delivery](../architecture/2026-08-28-direct-envelope-admission-and-local-agent-delivery.md). No automatic conversation routing is added. [Durable channel admission](2026-09-06-durable-channel-invitation-admission.md) owns invitations and acknowledgements; an active Team participant is not evidence of invitation consent. Remote text tools without local channel metadata retain their explicit-audience text protocol; callers can select v4 content through the authenticated Link post API.

The keyless headless Loader example uses a fixture-owned initial topology and real activation, tool, Link, Agent Client, attachment and Session providers. JSON and SQLite runs verify an explicit model-tool subset, an ordered image broadcast, delayed activation replay, three independent receipts and no automatic reply. Hub tests additionally verify restart replay, inactive-recipient rejection and exact human final admission.
