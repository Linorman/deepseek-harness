# Agent Note: Bound channel metadata for remote messages

Status: implemented

English | [中文](2026-09-06-bound-channel-metadata-for-remote-messages.zh.md)

## Problem

Remote message tools need the exact channel protocol to prepare payloads and default audiences. Reconnected endpoints cannot rely on already-acknowledged invitations being replayed.

## Decision

`TeamLink.getChannel()` uses a current activation proof and frame-v7 `channel-get`. The Hub checks binding, Team and active membership under its locks and returns only manifest, phase and cursors. Local and remote `team_message` share protocol-aware text preparation; no parser is widened.

## Alternatives considered

Invitation-only caching cannot reconstruct every reconnect. Trial posts mix protocol discovery with writes and are rejected.

## Consequences

An isolated tool endpoint can send direct-v4 subsets and default broadcasts after reconnect through the real WebSocket path. JSON/SQLite snapshots verify actual model tool calls, fixed recipients and Session receipts; metadata tests reject foreign, nonmember, revoked and offline access.
