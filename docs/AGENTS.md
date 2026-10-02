# AGENTS.md — The documentation standard

This file owns placement, document structure, Markdown rules, and word budgets. [dsh-prose-standard](../.agents/skills/dsh-prose-standard/SKILL.md) owns prose coverage and editorial judgment; [dsh-doc-standards](../.agents/skills/dsh-doc-standards/SKILL.md) supplies the audit workflow. [Agent Notes](../.agents/notes/README.md) have their own lifecycle and format.

## Document structure

A document explains its own subject. Summarize direct children by purpose and responsibility; link their owners for deeper detail, including tests and fixtures. References define a lookup scope and current behavior. Tutorials lead through ordered actions to an observable outcome, establishing prerequisites before dependent concepts. Separate substantial tutorial and reference material; label a small secondary section. [Postmortems](postmortem/README.md) are incident references whose chronology preserves evidence.

## The tier taxonomy: one home per fact

Keep each explanation at its owner; elsewhere retain only the local contract and link the detail.

| Tier | Owns |
|---|---|
| Root `AGENTS.md` | Brief standing rules and task-specific guidance links. |
| Subtree `AGENTS.md` | Local rules that supplement the root. |
| [architecture.md](architecture.md) | Runtime composition, core roles, loop, and extension points. |
| [subsystems/](subsystems/README.md) | Subsystem types, semantics, and generated Cordis APIs. |
| [Agent Notes](../.agents/notes/README.md) | Decision rationale, alternatives, consequences, and verification. |
| [postmortem/](postmortem/README.md) | Incident evidence, causes, and prevention. |
| [cookbook/](cookbook/adding-a-package.md) | Procedures with prerequisites and observable verification. |
| [user/](user/index.md) | Product guides published on the documentation website. |
| Package README | Configuration, behavior, failures, limitations, extension points, and [Model Experience](cookbook/adding-a-package.md#4-write-the-package-readme). |
| [development.md](development.md) | Contributor setup, daily workflow, and CI overview. |
| Generated references | Source-derived API, tool, config, persistence, and graph inventories. |
| `.agents/skills/` | Reusable specialized workflows. |

Do not copy JSDoc or generated catalogs into READMEs, move package details into architecture, or present an unimplemented proposal as a working cookbook. Standing instructions link procedures rather than embedding tutorials.

## Writing rules

- State current behavior. Keep change stories in commits/PRs, decision rationale in Agent Notes, and incident chronology in postmortems. Implemented notes use present tense; archived notes remain frozen.
- Non-trivial decisions add or update the owning [Agent Note](../.agents/notes/README.md#when-to-write-one); mechanical/local edits are exempt.
- Use one physical line per paragraph and editor soft-wrap. Code blocks, tables, and lists keep their structure; code comments follow lint limits.
- Fenced `ts` examples compile. Source declarations with original JSDoc use `ts type-equiv`; body-stripped public classes use `ts public-api`. Register each primary block in the manifest ([mechanics](development.md#documenting-types-verbatim-ts-type-equiv)).
- Changes to documented types update their declaring group's subsystem page. `verify-type-equiv` detects stale declarations, not missing documentation.
- Update bilingual counterparts together. Load [terminology](i18n/terminology.md), patch only affected prose in one pass, preserve first-use annotations, and re-record confirmed pairs with `pnpm run verify-translation-pairing --write <pair>`. Invoke the extended translation skill only on explicit request ([pairing contract](i18n/README.md)).
- Keep generated English sources and regions generator-owned. Update the source, regenerate, then maintain reviewed Chinese counterparts through pairing; generators that own both sides regenerate both.
- Preserve behavior, failure, timing, ownership, exceptions, and non-obvious rationale. Remove code restatement, control-flow/test narration, duplicate explanations, and design-session residue. Name exact actors and APIs; reserve `seam` for the defined capability. Use [dsh-prose-standard](../.agents/skills/dsh-prose-standard/SKILL.md) for judgment.

## Wordcount Budgets

[doc-budgets.manifest.json](../scripts/doc-budgets.manifest.json) sets ceilings; `verify-doc-budgets` rejects excess or missing files. When over budget, relocate descendant-owned content first, then condense. Raise a ceiling only when required content needs the space, with a justified manifest diff.

Budgets are guardrails, not deletion targets. Retain at least 5% headroom when within target; freeze an over-target ceiling until relocation or condensation brings it under target. Targets: root `AGENTS.md` ≤1,600 words; architecture ≤1,800; subtree instructions ≤600, except packages ≤650 and this file ≤1,250; packages map ≤600. Review governs unbudgeted documents.

## The slop checklist

Use the [corpus audit workflow](../.agents/skills/dsh-doc-standards/SKILL.md) to find duplicated rules, stale history, hand-restated inventories, misplaced detail, reasoning transcripts, and excessive emphasis. Length and age alone do not justify deletion. Exclude vendored sources and frozen archives; preserve unique technical rationale and named coverage gaps.

## Cross-reference with machine-checkable links, never free prose

Use relative Markdown links for repository references. `verify-md-links` checks targets and heading/explicit anchors; `verify-doc-refs` checks document references in TypeScript. Search inbound links before moving or deleting a document and repair them in the same change.
