# Agent Note: GPT-6 Astra contributor instructions

Status: implemented

English | [中文](2026-09-05-astra-agent-instructions.zh.md)

## Problem

Contributor workflows can interrupt authorized work when they require a separate scope parameter, return only a readiness message, or pause for a selection the user did not reserve. Broad audit procedures can also turn a local Markdown edit into remote PR discovery or unrelated compiler checks. Conflicting instructions become especially consequential for models that follow skill wording closely.

## Decision

The [root instructions](../../../../AGENTS.md#agent-workflow-gpt-6-astra) tune contributor behavior using the [official GPT-6 Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#prompting-best-practices), consulted on 2026-09-05. They establish task completion, existing authorization, contextual scope, bounded delegation, concise communication, and relevant verification. System and developer instructions remain authoritative; user instructions take precedence over skill guidance.

Specialized workflows define the applicable operation. Prose skills infer the requested scope without inventing a corpus audit. Animation audit requests remain read-only, planning requests produce supported plans without an intermediate selection prompt, and explicit implementation requests proceed through the relevant animation skill. Prototype promotion still requires a user choice unless the user has delegated selection. Review formats scale to the findings and the user's requested output.

Documentation edits retain `doc-sync` and whitespace validation. Lint applies when code, JSDoc, or lint configuration changes; archive-verifier tests apply when that implementation changes. Contributor instruction edits use skill metadata and Markdown validation; product-visible prompts retain their runnable-example snapshot requirements. Passing evidence is reused only while its inputs remain unchanged.

The explicit-only prototype, library-selection, and animation-review skills carry `policy.allow_implicit_invocation: false` in their Codex metadata, matching their existing frontmatter and descriptions under the [official skill policy](https://developers.openai.com/codex/skills/#optional-metadata).

This policy complements the [routine translation decision](2026-08-08-lightweight-routine-documentation-translation.md) and the [explicit change-scope report](2026-07-27-explicit-change-scope-report.md). Both remain active: routine translation stays local, and the scope command still requires a verified base when it is used. No existing decision is fully superseded. These instructions govern contributors; they do not select a runtime provider, change a model default, or migrate Clocky's API requests.

## Alternatives considered

**Copy the complete model guide into every skill.** Repetition increases context cost and gives shared rules multiple owners. Root instructions own common behavior; skills retain only task-specific decisions.

**Remove all pauses and checks.** This would erase read-only review scope, deliberate prototype selection, external-action authorization, and required verification. Autonomy applies within the task's existing authority.

**Only add a root override.** Conflicting local stop instructions and inconsistent invocation metadata would remain. The owning skill must express the intended workflow directly.

## Consequences

Contributors can finish ordinary work with fewer procedural interruptions while preserving project-specific invariants and publication protections. Optional advice carries less formatting and orchestration overhead. Explicit-only skills remain available on request.

Metadata and Markdown checks establish structural consistency, not model adherence. Behavioral improvement requires observing representative Astra sessions; no live-model evaluation is claimed. A future model update warrants a targeted instruction audit, not a runtime migration inferred from this note.
