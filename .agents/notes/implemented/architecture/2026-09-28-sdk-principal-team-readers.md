# Agent Note: Principal-scoped SDK Team readers

Status: implemented

English | [中文](2026-09-28-sdk-principal-team-readers.zh.md)

## Problem

An authenticated SDK connection identifies a principal but does not grant access to every durable Team. Raw discovery exposes grants and storage positions; selected-Team bodies, channel waits and artifact providers can complete after membership withdrawal.

## Decision

SDK Team discovery uses the Hub's principal reader, safe product summaries and encrypted continuations. `team/list` omits physical scan counts, grants and goal budget bodies. TypeScript and Python accept the same response; continuation expiry requires an explicit first-page request.

Selected-Team management reads retain an exact active-human read proof through provider IO. The binder selects direct or canonical parent authority; the Hub checks an empty finite identity selection before and after the operation, including failure. Selection responses carry the resulting member or parent-inspection access. This grants no mutation, consent or execution authority. Missing/private Teams have the same SDK refusal.

Raw channel reads and waits resolve the attached owner privately, then use that Team authority. Watches combine caller cancellation with credential retirement. Artifact bytes use the same checks and preserve provider verification and byte limits. Task histories, workspace-loss results and workflow results share the Host's pure private-artifact projection in the core selection module.

## Alternatives considered

**Authenticate the connection once and expose every Team.** Possessing a transport credential supplies no durable membership relationship.

**Filter directory rows while retaining provider cursors.** Storage positions and hidden Team identifiers remain observable.

**Separate artifact redaction implementations.** Host and SDK views can disclose different private references as result kinds evolve.

## Consequences

Reader calls may hydrate Team journals; response bounds establish no performance guarantee. The [SDK notification decision](2026-09-29-sdk-principal-notification-ownership.md) owns management streams, exact remote-activation notification authority and credential retirement. The [Session product-reader decision](2026-09-28-team-session-product-readers.md) owns the Web paths.

## Verification

Real-Hub tests exercise principal-filtered discovery, direct selection, cross-principal body refusal and withholding successful/failed results after authority withdrawal. SDK forwarding, media, client/schema and Python regressions cover the protocol changes. The real JSON-RPC Team-final keyless scenario reads safe discovery and authorized selection without additional model requests.

SDK Server tests also cover canonical parent-inspection selection, provider retirement between proof and read, missing channel and artifact owners, artifact verification failures and byte bounds, and bounded page defaults. Direct-channel media tests exercise owner withdrawal, ordinary unkeyed text, older direct-version refusal and text admission without image storage. Activation tests cover JSON-RPC routing and combined Link/Agent cleanup failures.
