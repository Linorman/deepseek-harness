# Agent Note: clocky-hook-protocol — the shared Claude Code / Codex hook wire-protocol core

Status: implemented

English | [中文](2026-06-30-hook-protocol-lib.zh.md)

## Problem

The hooks subsystem needs a shared library for bridge implementations that run external shell hooks. The reference implementations (`~/repos/refs/claude-code`, `~/repos/refs/codex`) show a decisive fact: **Codex deliberately reimplements a SUBSET of the CC hook protocol.** Its engine reads the same `hooks.json`, uses the same matcher-group shape, the same exit-code/structured-stdout output contract, and the same command-hook execution model — Codex's source even names the engine after Claude's and comments where it "intentionally diverges." A shared library keeps those protocol primitives in one place.

This Agent Note introduces `@clocky/clocky-hook-protocol`, a **library** (not a plugin — it registers and injects nothing) holding dialect-neutral protocol primitives. The split between shared and per-dialect behavior is the design's center of gravity.

## Decision

The `packages/hooks/` group contains `hook-protocol` as a pure library. It owns four primitive families and the `hook/*` session events; a bridge implementation owns what genuinely differs.

**Shared (here):**
- **Matcher** — `matcherDiagnostic(pattern, mode)` and `matchesMatcher(pattern, query, mode)`. The ONE axis dialects differ on is collapsed to the `mode` parameter: each bridge chooses the mode it implements, validates runnable groups, and treats an invalid regex as a whole-config load failure with a stable diagnostic. Runtime matching still contains an invalid regex as a non-match, so a direct library caller never throws into the loop.
- **Execution** — `runHook(bash, hook, options)`. Runs a command hook through the `ctx.shell` seam rather than a bespoke `spawn`: the executor already provides the scrubbed-but-overridable env, process-group kills, and timeout the protocol needs, and `clocky-shell`'s `stdin`/`env` fields (added for exactly this) are the trusted-plugin API an in-process bridge is allowed to use. It serializes the bridge-built payload to stdin (trailing newline iff CC), honors the hook's `timeoutSec` (else `DEFAULT_HOOK_TIMEOUT_MS`, the 10-minute reference default both dialects share), and never throws (an executor rejection becomes a non-blocking-error `HookOutput`).
- **Decode** — `parseHookOutput(exit, stdout, stderr)`, the exit-code + structured-stdout codec, producing a dialect-neutral `HookOutput`. Exit `0` → lenient JSON parse of stdout; exit `2` → blocking error with `stderr` as the reason (surfaced as `decision: 'block'` so no caller needs a separate exit-code branch); other → non-blocking error. Parses the CC structured-stdout fields that have a consumer on some path (`continue`/`stopReason`/`decision`/`hookSpecificOutput.{permissionDecision,additionalContext,updatedInput}`/`systemMessage`); the bridge honors only the subset meaningful for its dialect. Fields with no consumer on any path are not parsed at all (CC's `suppressOutput` — hook stdout never enters a transcript here, so there is nothing to suppress; see [the archived tighten-hook-protocol-contract Agent Note](../../archived/simplification/2026-07-04-tighten-hook-protocol-contract.md)).
- **Merge** — `mergeHookOutputs(outputs)`, folding multiple matched hooks into one most-restrictive `MergedHookOutcome`: permission precedence **deny > ask > allow**, halt sticky on the first `continue:false`, block reasons joined `\n\n`, context/system-messages accumulated in order.
- **`hook/*` session events** — `hook/invoked` / `hook/result`, declaration-merged into `SessionEventMap` (log-only, like `compaction/*` — NOT `SurfaceEventType`s), with `appendHookInvoked`/`appendHookResult` helpers so the invoked/result pairing and owner-defined execution relation stay consistent across bridges. `appendHookResult` also owns the durable record's semantics — the decision string (the hook's parsed decision, else `'stop'` on `continue:false`, else `'pass'`) and the 500-character `stderrSummary` truncation derive from the `HookOutput` here, not per-bridge.

**Per-dialect (a bridge implementation):** building each event's stdin payload, the dialect's environment, and mapping the neutral `HookOutput`/`MergedHookOutcome` onto the harness's extension-point-specific typed Decisions (`PreToolDecision`, `PreStepDecision`, `ContinuationDecision`, `PostToolDecision`).

## Alternatives considered

**One parameterized engine.** Rejected because payload construction and decision mapping genuinely differ by dialect. Matchers, codecs, execution, merge rules, and events remain shared; each bridge keeps its payload and mapping explicit so its wire behavior is readable in place.

## Consequences

Bridge implementations parse config atomically, build their dialect payload, invoke the shared runner and merge logic, map the decision, and append `hook/*`. Protocol tests cover every matcher mode and diagnostic, exit-code and codec field, runner plumbing, merge precedence, and audit helper at per-file 100%; `updatedInput` is parsed but only logged and warned until the [input-rewrite proposal](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md) lands.
