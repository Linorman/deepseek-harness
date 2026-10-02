---
name: dsh-doc-standards
description: Use when writing, moving, reviewing, or auditing deepseek-harness documentation for placement, tutorial progression, duplication, budgets, or validation.
---

# DeepSeek Harness Documentation Workflow

[docs/AGENTS.md](../../../docs/AGENTS.md) owns structure, tiers, budgets, and writing rules. Use [dsh-prose-standard](../dsh-prose-standard/SKILL.md) for required coverage and editorial judgment. This workflow guides placement and audits; length alone is not a defect.

## Establish scope and owners

Ordinary edits cover the requested documents and affected references. A corpus audit covers the requested tree. For PR work, verify and fetch the live base, then run `pnpm --silent run change-scope --base <verified-base-ref>`; after retargeting or merging a changed base, rerun the report and inspect prose introduced by it. Local documentation work needs no PR or remote fetch.

Read the owner before editing: [docs/AGENTS.md](../../../docs/AGENTS.md) for human-facing structure, [Agent Note rules](../../notes/README.md) for decisions, [postmortem rules](../../../docs/postmortem/README.md) for incidents, and [i18n rules](../../../docs/i18n/README.md) for bilingual pairs. Exclude `vendor/` and frozen [archived Agent Notes](../../notes/archived/AGENTS.md) from audits and edits.

## Review structure before prose

Review the [document structure](../../../docs/AGENTS.md#document-structure) for its subject and intended use: keep detail at the owning level, distinguish lookup references from outcome-focused tutorials, and establish prerequisites before dependent concepts. Agent Notes use their own format. Postmortems preserve chronological evidence within an incident-scoped reference.

Before moving or removing a document, search its exact path and heading anchors for inbound references. `verify-md-links` checks Markdown targets and fragments; `verify-doc-refs` checks `docs/*.md` citations in TypeScript comments. Search TypeScript strings manually when their output never reaches gate-scanned Markdown. Update files and inbound links atomically.

Generated catalogs are derivative: edit the generator or source metadata, then regenerate. Bilingual edits update the counterpart and re-record the pair; consider that cost when choosing a home for frequently changing content.

## Audit the corpus

1. Measure with `pnpm run verify-doc-budgets --list` and word counts to find unbudgeted outliers; budgets are guardrails, not deletion targets.
2. Read candidates semantically. Use [dsh-trim-cot-leakage](../dsh-trim-cot-leakage/SKILL.md) for narrated history, dead citations, review choreography, control-flow narration, and planning residue.
3. Search distinctive phrases for duplication. Keep each explanation at its owner and link other locations; preserve essential local contracts and non-obvious rationale.
4. Replace hand-written catalogs, test/status inventories, and JSDoc restatements with authoritative source or generated references.
5. In implemented Agent Notes, remove migration plans and acceptance-task checklists while retaining shipped verification contracts and named gaps. Use [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md) for retention and consolidation decisions.
6. If a removal changes promised behavior, treat it as a design change through [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md), not an editorial deletion.

Do not create another explanation merely to relocate disposable reasoning. For budget failures, follow the owner's [relocate, condense, then raise policy](../../../docs/AGENTS.md#wordcount-budgets).

## Validate

Run `pnpm run doc-sync` and `git diff --check`. Add lint for changed code, JSDoc, or lint configuration; Markdown-only edits need no separate lint/build. JSDoc changes may require catalog regeneration. For each edited pair, update its counterpart through the [routine path](../../../docs/AGENTS.md#writing-rules), then run `pnpm run verify-translation-pairing --write <pair>` before validation. Reuse passing evidence for unchanged inputs.

Report scope, material changes, checks actually run, and any budget exceptions. Include word deltas when the task concerns length.
