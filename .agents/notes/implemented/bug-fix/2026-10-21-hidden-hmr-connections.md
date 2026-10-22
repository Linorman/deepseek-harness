# Agent Note: Hidden HMR connection lifetime

Status: implemented

English | [中文](2026-10-21-hidden-hmr-connections.zh.md)

## Problem

Each WebUI tab holds an HTTP/1 EventSource even without a rebuild. Repeated local launches can occupy the browser's per-origin connection pool and leave ordinary page reads queued. Closing the spare test tabs releases those reads.

## Decision

The [HMR browser plugin](../../../../packages/client/hmr/src/client/index.ts) closes its EventSource while hidden and reopens it when visible. Retired sources cannot deliver frames. The first graph frame establishes a baseline; later connections compare original entry revisions and queue missed builds through the existing reload path. Successful reloads update the observed revision, preventing duplicates. Known frames are validated before changing this baseline. Disposal closes the stream and removes its visibility listener.

## Alternatives considered

**Keep every background stream open.** This retains the connection-pool pressure observed during WebUI testing.

**Close streams without reconciling missed updates.** Returning tabs could retain stale bundles indefinitely. The reconnect graph supplies the current revisions without a new host protocol.

**Reload the whole page on return.** This would discard unrelated in-memory UI state; the existing entry reload path provides narrower behavior.

## Consequences

This addresses ordinary hidden tabs, not arbitrary numbers of simultaneously visible windows. The first graph establishes the baseline again after self-reload, avoiding a loop caused by comparing a replacement HMR bundle against the immutable boot manifest. The existing race before that first baseline and changes to graph membership still require separate handling.

## Verification

The [assembled browser snapshot](../../../../apps/web/tests/hmr-visibility.snapshot.ts) boots real built plugins, closes hidden streams, rejects retired-source messages, reconciles a missed self-rebuild, and verifies the replacement does not loop. Simulation continues independently on the Host while its browser connection is suspended.
