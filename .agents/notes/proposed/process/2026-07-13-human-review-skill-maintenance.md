# Agent Note: Periodic human-review maintenance for dsh-code-review

Status: proposed

English | [中文](2026-07-13-human-review-skill-maintenance.zh.md)

## Problem

The [dsh-code-review skill](../../../skills/dsh-code-review/SKILL.md) needs reusable lessons from human review. A comment, merged PR, resolved thread, or author's “fixed” reply does not prove adoption. Promoting every comment would bloat the skill; maintenance needs final-code evidence and independent judgment.

## Proposal

A private maintainer tool scans a refreshed, clean full-history `origin/master` checkout daily with a two-UTC-day overlap. Manual runs accept another `--since` duration or repeated `--pr` selections. The current skill makes overlapping scans idempotent; no repository cursor is stored. This is an unfinished proposal, not a repository-supported command or scheduled service.

### Acquisition and adoption

Admit only PRs whose merge commit is reachable from master, including landed stacks. Reconstruct the landing target parent; log and skip unreconstructible PRs and individual acquisition failures. Reject searches above GitHub's 1,000-result cap. Paginate review comments, submissions, and commits completely. Exclude conversation comments, which cannot be assigned a surviving pre-feedback commit after rewrites.

Eligible feedback comes from a GitHub `User`, with creation and last-edit timestamps strictly before merge; submissions use GraphQL `lastEditedAt`. Exclude the author's own comments. If the review commit survives, choose the latest PR commit strictly before feedback as baseline `B`. Let `T` be the landing target parent and `M` the landing merge: compare the feedback patch `merge-base(B, T)..B` with the final PR patch `T..M`. This excludes target-only changes. Force-pushed reviews, feedback predating surviving commits, and unreconstructible landings are `unclear`.

Two independent adapters must agree that feedback is human-authored and adopted, then classify it against the current skill as candidate, covered, implementation-specific, or not feedback. A singleton may qualify. Re-evaluate disagreement once and preserve unresolved evidence. Two non-candidate verdicts exclude the item even if their reasons differ. Invalid batch output excludes that batch; an adapter with no valid result for any nonempty batch fails the operation rather than reporting “no candidate.”

### Candidate and promotion

Draft only from agreed structured guidance. Adapters return complete candidate text without tools or repository writes; both review the same diff through a bounded revision loop. The tool writes only the target skill, rejects staged or unrelated changes before and after checks, and uses compare-and-swap for its write and rollback so concurrent edits are not overwritten. Failure rollback also unstages its target.

A successful bundle records the source master commit and skill blob, complete candidate/diff, feedback IDs and URLs, landed evidence, reviewer verdicts, and check results. Raw adapter I/O remains private. Analysis never commits, pushes, or opens a PR. A maintainer-authorized promotion helper starts from clean refreshed master, rejects source-skill drift, and opens a draft PR containing the evidence, originating run, checks, and operator edits for normal review.

### Isolation and ownership

Versioned adapter JSON is byte-bounded and schema-validated. Reject byte-identical reviewer executables; the operator must still ensure distinct providers/models. Subprocesses use scrubbed environments, private working directories, abort-aware process-tree cleanup, and feedback marked as untrusted with a 128-bit nonce. These controls do not constitute an OS sandbox; read-only inference remains an adapter contract. Production Git, GitHub, and check commands use the same environment scrubbing.

Tool source, adapters, credentials, and scheduling remain private single-maintainer infrastructure. A second-maintainer handoff requires a follow-up decision about repository ownership or the new private setup.

## Alternatives considered

- **Commit the private tool.** Repository maintenance costs outweigh its current single-maintainer use; reconsider for handoff.
- **Observe every feedback-time head.** Stronger causality requires durable event state, retries, and rewrite reconciliation.
- **Store a processed-PR cursor.** Overlap and current-skill comparison avoid recovery and missed-event state.
- **Run on every comment.** Review waves lack the final artifact needed to establish adoption.
- **Treat merge or thread resolution as adoption.** Feedback can be rejected or superseded before merge.
- **Promote automatically.** The workflow needs useful output and maintainer review before repository publication.
- **Learn from fixed bot findings.** This proposal is limited to human feedback, excluding forwarded automation.
- **Use one author/reviewer.** Independent verdicts check unsupported generalization.

## Acceptance criteria

The recorded 2026-07-15 run scanned 62 merged PRs, skipped 5, considered 426 feedback items, and produced no candidates. Distinct adapters completed adoption/classification in about eight minutes; one invalid batch failed closed. This does not establish scheduler delivery, successful promotion, or the target-only negative control.

Before marking implemented, observe all of the following:

- A clean detached master run produces either a valid no-candidate record or a diff limited to the target skill.
- Independent adapters complete adoption, classification, and candidate review without intervention.
- Noninteractive scheduling delivers durable operator notification.
- A controlled target-only change is excluded while a later PR-owned change remains in adoption evidence.
- Promotion rejects skill drift and opens a current candidate's draft PR with the recorded evidence.
- An operator inspects and lands at least one generated candidate through normal PR review.

## Risks

Committer timestamps retain a clock-skew/rewrite false-adoption window. Byte-distinct adapters do not prove provider independence. POSIX file compare-and-swap is best-effort, unsuitable for truly concurrent editing. Non-candidate disagreements remain excluded without another dispute round. Private infrastructure stops maintenance until its sole operator restores service or documents handoff.
