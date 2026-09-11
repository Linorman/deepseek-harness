# Agent Note: Authenticated human channel invitations

Status: implemented

English | [中文](2026-09-06-authenticated-human-channel-invitations.zh.md)

## Problem

Authenticated human endpoints need to discover and accept only their own durable channel invitations without gaining channel-creation authority or replaying consent against a changed manifest.

## Decision

Host and SDK discovery return the current principal's own invitation and complete immutable manifest. A membership-only read proof binds `channelId`; it cannot authorize channel creation or consent. Explicit acknowledgement binds the manifest fingerprint, revision and retry key through the existing human consent proof. Closed channels reject acknowledgements, including previously accepted retry keys.

## Alternatives considered

**Use membership as consent.** Rejected because membership does not prove that the endpoint accepted the exact manifest or revision.

**Let the discovery proof create or acknowledge channels.** Rejected because read authority and channel mutation authority must remain separate.

**Accept a retry key without the original manifest fingerprint.** Rejected because a reused key must not acknowledge a different durable invitation.

## Consequences

Host group tests exercise two real Agent recipients. TypeScript and Python runnable SDK examples verify authenticated JSON discovery, explicit acceptance and a durable Session receipt. No invitation or Channel WAL format changes are required.
