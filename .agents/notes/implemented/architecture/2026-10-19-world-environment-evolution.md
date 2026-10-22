# Agent Note: Separate environment and experience state

Status: implemented

English | [中文](2026-10-19-world-environment-evolution.zh.md)

## Problem

Supply dynamics and learning require durable evolving state without changing birth Persona, authority, or already consumed context. Replay must not introduce new random outcomes.

## Decision

The [domain contracts](../../../../packages/simulation/simulation/src/world-environment.ts) install supply-step and experience operations through the existing Native and execution registries. Their state lives in separate non-cognitive entities; Native's original mutation journal owns both actual sample records and atomic profile updates. The installed supply algorithms are deterministic and retain implementation identity. A fresh experiment selects a model; there is no in-place model migration operation. Experience requires an original committed personal intent and an explicit reader audience, with bounded values and per-period changes. It does not publish world facts or modify the person entity.

## Alternatives considered

**Mutable Persona fields** would mix birth identity with acquired state and allow learning to overwrite original inputs. Separate versioned state preserves both.

**Driver-specific environment branches** would couple scheduling to one model. Existing domain factories already provide immutable pins and the single Native commit owner.

## Consequences

[Integration and evaluation tests](../../../../packages/simulation/simulation-local/tests/world-environment.spec.ts) cover both storage backends. [Evaluation evidence](../../../plans/2026-10-16-world-post-mvp/evidence/implementation/c3.md) distinguishes deterministic invariant checks from uncollected human and model-judge ratings. State history remains bounded at 256 versions; unsupported migrations and richer learning models require separate designs.

Portable v1 scenarios author strict initial environment and person-state entities through the shared compiler. Initial experience versions must be empty and environment lastTime must be null; subject/audience references are validated. Native initialization consumes those compiled profiles without driver-specific logic. TypeScript and Python accept the same initial-state shapes.

The [registered evaluator](../../../../packages/simulation/simulation/tests/environment-registered-evaluation.ts) freezes fixed/holdout inputs, controls and rubric before publishing a resource comparison. Shortage and production are reported together; no efficiency or cognitive-quality improvement follows from shortage alone. The CLI hashes sources relative to its own project, never an arbitrary working directory, and accepts only project-local output directories. Write-once registration/results and deterministic verification preserve original evidence; actual CLI regression tests cover misleading directories, source mismatch, tampering and overwrite refusal. Reports keep arithmetic/privacy parser probes separate from unexecuted model judging and user-deferred human ratings. Full Session privacy and human credibility require their own evidence.
