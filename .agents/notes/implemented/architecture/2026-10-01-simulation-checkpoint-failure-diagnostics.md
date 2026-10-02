# Agent Note: Public Simulation checkpoint failure references

Status: implemented

English | [中文](2026-10-01-simulation-checkpoint-failure-diagnostics.zh.md)

## Problem

A generic checkpoint/restore failure cannot identify the retained owner that needs attention. Native provider errors may contain private file paths or messages; interpreting their prose as a public category leaks data and changes semantics when a provider changes its wording. A primary validation failure and unconfirmed cleanup can coexist.

## Decision

The [Native diagnosis](../../../../packages/simulation/simulation/src/checkpoint-diagnostics.ts) defines fixed stages/categories and one canonical subject. Type-only and parser entries include no Cordis service. Rule checks produce categories at their actual check; the [cross-owner IO helper](../../../../packages/simulation/simulation-team/src/checkpoint-failure.ts) attributes unknown reads to their caller-selected owner and recognizes typed cursor/source movement. Collection/recovery retain their existing bounded movement retry. Session subjects use the run's canonical binding, including when persistence headers are optional or inconsistent.

Failed Native checkpoints preserve private error text and optional safe metadata independently, leaving the latest successful manifest intact. JSON/SQLite replay and exact terminal retries preserve the original diagnosis. Recovery cleanup failures retain both private original errors in an AggregateError subclass and separately mark cleanup unconfirmed; neither error can authorize execution.

The [product command journal](../../../../packages/simulation/simulation-product/src/creation-book.ts) retains only safe metadata for failed checkpoint/restore requests. Terminal folding validates the complete receipt family before publication. Native checkpoint detail and original request queries return the recorded diagnosis without provider prose, paths or payloads. Public parsers refuse additional properties and diagnoses on success or unrelated request families. Command queries, cold reads and diagnosis navigation do not acquire an execution owner, infer, roll back or repair a source; referenced Team/Session bodies still require independent authorization.

## Alternatives considered

**Parse provider messages.** Private paths can leak, and identical wording does not prove identical failure rules.

**Hide all source information.** Operators cannot distinguish an unavailable Session from a mismatched checkpoint implementation or owner conflict.

**Replace the primary error with cleanup failure.** That discards an independent reason why recovery was refused.

## Consequences

Exact canonical identities remain useful navigation targets without granting content access. Unknown failures use an unavailable category; missing metadata is not a guessed cause. Safe diagnoses remain historical after the source is repaired. Explicit new checkpoint/recovery requests revalidate current facts and cannot overwrite an original failed result.

## Verification

Native and cross-owner tests retain diagnoses through JSON/SQLite replay, refuse private extra fields, preserve both cleanup/validation errors, and retain source movement retries. Product tests inject a real Session reference read failure, preserve the precise source through terminal journal reload, retain the successful anchor, and prove original queries do not open a run or request models. Transport and browser tests belong to their consumers.
