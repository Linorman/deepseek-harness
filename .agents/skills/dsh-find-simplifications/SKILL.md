---
name: dsh-find-simplifications
description: Use when finding evidence-backed deepseek-harness simplifications, writing proposals or local TODOs, consolidating superseded Agent Notes, or incorporating candidates from another PR.
---

# Finding DeepSeek Harness Simplifications

Find removals, folds, or demotions that reduce owned code or public API while preserving required behavior. This is guidance, not a checklist; prefer a few proven candidates over thin guesses.

## Establish context

Read the applicable `AGENTS.md` rules and owning documentation. Read [architecture](../../../docs/architecture.md) before judging `packages/`, [defensive patterns](../../../docs/defensive-patterns.md) for lifecycle work, and [testing policy](../../../docs/testing.md) for affected evidence. Use the [Agent Note tree](../../notes/README.md) to understand intentional decisions; tests and notes provide evidence, not automatic vetoes.

Treat dual LLM adapters and dual persistence backends as intentional. Do not propose deleting either twin/backend unless the user explicitly overrides that constraint. Removing an unused method inside a protected seam can qualify without collapsing the design.

## Survey and prove candidates

Strong candidates include unused public methods, events, config fields, helpers, packages, or test artifacts; duplicated representations of one fact; unsupported speculative generality; and hand-rolled infrastructure a maintained dependency or engine-floor builtin can replace. Slight behavior differences can be acceptable when explicit, reasonable, and simpler to explain. A typo, complexity impression, or `knip` result alone does not justify an Agent Note.

For a broad request, use bounded parallel subagents when permitted and useful, assigning separate domains and requiring call-site evidence. Otherwise survey locally. Cover the loop/session log, ACP/UI, LLM/tools/prompts, tool execution, and package/example/test infrastructure as relevant. Start with large production deltas; unused-symbol searches alone can miss duplicated lifecycle machinery.

Classify consumers before proposing a removal:

- **Production:** `packages/*/*/src`, runtime configurations, scripts, and Loader paths.
- **Non-production:** tests, docs, Agent Notes, recorded outputs, and comments.
- **Inspect individually:** examples and scripts that may serve product smoke paths.

Use `rg` for exact symbols, event/wire strings, package names, config keys, and both `.name(` and `name(` call forms; read each call site. `knip` supplements this work but cannot prove dynamic Loader or event usage absent.

Reject or downgrade a candidate when a production caller makes it a feature decision, existing rationale or defensive evidence still justifies it, or unrelated churn exceeds the actual reduction. A useful local cleanup too small for a decision record belongs in an inline marker.

## Check ownership and lifecycle

For defensive copies, freezes, validators, and captured callbacks, trace origin and ownership. Apply the root rule for typed same-process calls versus parser/config, queued, model/tool JSON, durable/file, worker, process, and wire inputs. Hostile-getter or fake-typed-object tests do not themselves establish a production requirement.

Map sentinels, readiness promises, cancellation paths, disposers, and state flags to distinct owners and transitions. Propose one controller when several mechanisms mirror one liveness or settlement fact. Preserve machinery needed for publication/rollback, callback containment, first terminal outcome, process ownership, and disposal to quiescence.

## Evaluate a dependency replacement

Follow the [dependency policy](../../notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md). For parsers, framers, backoff, glob matching, diffing, and similar infrastructure:

- Identify the exact implementation the dependency replaces and any residual semantics it cannot cover.
- Check maintenance, adoption, transitive footprint, and availability at the engine floor; prefer a suitable builtin.
- Compare recorded decisions for schemastery, vendored Cordis, twin adapters, and other settled seams before proposing their replacement.
- Count net deletion across implementation, tests, and docs after remaining glue. Relocating the same complexity into a wrapper does not qualify.

## Consolidate Agent Notes

Audit notes when requested or when an implemented simplification supersedes their decision; do not expand every code survey into a corpus audit. Use [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md) for retention and frozen archives, and the [consolidation rule](../../notes/README.md#when-to-write-one) for deletion prerequisites.

Establish the current owner from code, configuration, formats, generated catalogs, docs, newer notes, and inbound links. Dates and titles are clues. Classify full versus partial supersession, transfer unique decision facts before consolidation, and repair inbound links and the full bilingual triplet. Never edit archived notes.

For an added-then-removed feature, check production code, configuration, schemas, durable/wire formats, migrations, compatibility, documentation, and supported-behavior tests. Surviving data or removal of only one transport, default, implementation, or presentation makes supersession partial. The removal owner must retain the original motivation, why it lost, alternatives, capability given up, reintroduction conditions, and verification of absence. Obsolete implementation inventories are not current evidence.

Search exact filenames, symbols, keys, events, and wire strings after consolidation; keep partial supersessions cross-linked and current.

## Record the result

Use the canonical [proposed-note format](../../notes/README.md#proposed), including genuine alternatives. State current API and consumer evidence in Problem; specify removals and affected tests/docs/catalogs in Proposal; make Acceptance criteria observable; explain costs and risks. Reuse an existing proposal when it already owns the topic.

Inline `TODO`/`FIXME`/`XXX` markers use the [repository urgency semantics](../../../docs/development.md). Keep a stable smell tag, why revisiting is safe, and the concrete action. Do not use them for speculative complaints or decisions that need an Agent Note.

When incorporating another PR, compare that branch with its verified base (`origin/master` for a trunk-based PR), not with the current PR branch. Port only substantiated independent candidates; consolidate overlaps. Update the PR body to reflect actual scope. Close another PR only when the user authorized it or the housekeeping is already yours.

## Validate and report

For Markdown-only notes or skills, run `pnpm run doc-sync`, applicable skill metadata validation, and `git diff --check`. Add lint for changed code or comments. Use [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) for additional evidence; do not duplicate its typecheck hook.

Report surveyed areas, exclusions, added/local/consolidated/deleted candidates, partial supersessions, and checks run. For each consolidation, name the old/current owners and evidence of full supersession; if none qualify, state that and representative partial cases. Keep a PR draft while scope, review responses, or validation remain unsettled.
