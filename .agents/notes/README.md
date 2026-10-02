# Agent Notes

English | [中文](README.zh.md)

Agent Notes record decisions and proposals: rationale, alternatives, consequences, and required verification that code and API documentation cannot carry. This file defines their lifecycle, placement, and format.

## Layout and naming

Use `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle:**
  - `proposed/` — work not yet or only partly implemented.
  - `implemented/` — shipped decisions, kept factually current with code in the same change; see [implemented/AGENTS.md](implemented/AGENTS.md).
  - `rejected/` — declined proposals retained only while their rationale prevents a plausible, meaningful mistake.
- **Class:** the kind of decision, defined below.

The filename date is when the topic was first proposed, established from Git history. Cross-references use relative Markdown links, never bare names or numbers. Browse the lifecycle/class tree or search the repository; do not add a centralized `INDEX.md`, which duplicates discovery and makes unrelated branches contend over one file.

## Classification

The closed class set lives in [scripts/agent-note-tree.ts](../../scripts/agent-note-tree.ts). Adding a class requires updating that set and this table.

| Class | What it covers |
|---|---|
| `feature` | A new user- or model-facing capability. |
| `bug-fix` | Corrects a defect or a gap identified by a postmortem. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | Structural decisions about shipped source: package relationships and runtime vocabulary. |
| `process` | Tooling, policy, and workflows around the code, including gates, package management, and vendoring. |
| `testing` | Test infrastructure and strategy. |

`architecture` concerns shipped source; `process` concerns surrounding tools and workflows. `refactor` is excluded because it overlaps `simplification`.

## Archiving and deletion

Keep implemented notes active while their alternatives, ownership boundaries, negative guarantees, durable or wire semantics, security rules, or reintroduction conditions can guide future changes. Archive completed decisions whose rationale has little future value. Never archive proposals: reject obsolete ones. Delete a rejected note's complete triplet when it no longer prevents a plausible mistake, and repair its inbound links. Apply [dsh-archive-agent-notes](../skills/dsh-archive-agent-notes/SKILL.md); age, length, and quotas are not criteria.

Archive only implemented notes, at `archived/{class}/yyyy-mm-dd-topic-title.md`. Move the English, Chinese, and sidecar files together; retain `Status: implemented`, insert the same `Archived: YYYY-MM-DD` immediately below it on both sides, re-record their hashes, and repair or delete inbound links. No other body changes are permitted during archival.

Sealed triplets are permanently frozen: never edit, translate, reformat, update, move, or delete them, or treat them as current authority. Documentation checks skip archived sources and outbound links; active prose may cite them explicitly as history. [verify-archived-agent-notes](../../scripts/verify-archived-agent-notes.ts) enforces the class tree, triplets, metadata, sidecar hashes, and append-only seals. The [archive-policy decision](implemented/process/2026-07-26-frozen-agent-note-archive.md) records the rationale.

## When to write one

Every non-trivial change must add or update an Agent Note in the same PR. This includes behavior, architecture, shared contracts, process or tooling, testing strategy, on-disk, wire, or configuration formats, and other decisions a maintainer may reasonably revisit. Substantial future work starts in `proposed/`; decisions already made start in `implemented/`. Only mechanical or local edits without changes to behavior, contracts, structure, process, or rationale are exempt.

Update the existing owner instead of creating a duplicate. Keep its factual realization current; a different decision requires a new note and cross-links unless the old record qualifies for consolidation.

A fully superseded implemented note may be consolidated into the current owner and deleted only after that owner preserves every unique rationale, alternative, consequence, required verification, and named coverage gap. Repair every inbound link and delete the complete triplet in the same change. Partial supersession requires keeping both notes cross-linked and updating current facts. Never rewrite the old decision into its opposite or leave Git history as the only copy of its rationale.

A feature-addition note may be consolidated into its later removal note only when the feature is absent from production code, configuration, schemas, durable or wire formats, migrations, and compatibility behavior; no current documentation presents it as available; and no test exercises it as supported behavior. Preserve the original motivation, why it ceased to justify the feature, alternatives to full removal, capability given up, reintroduction conditions, and verification of complete absence. Removal rationale and absence tests may remain; obsolete implementation inventories and tests of deleted behavior are not current evidence. Removing only one transport, default, implementation, or presentation is partial supersession, as is surviving durable data or compatibility handling.

## The file format

[verify-agent-note-format](../../scripts/verify-agent-note-format.ts), run by `doc-sync`, enforces the active-note format. Archived notes retain their sealed format plus the archive-date line.

### The header block

Start with these exact three lines, followed by a blank line:

```markdown
# Agent Note: <title>

Status: <status>
```

The status must match the lifecycle folder:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

No dates or parentheticals belong on the status line. The filename records the first-proposed date; Git records subsequent history. Amendments belong in the body.

### The body skeleton

Begin with `## Problem`, stating the motivation independently of the solution. Use the canonical recurring headings below; bespoke technical sections may appear between them.

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

The proposal may contain plans, migration steps, and open questions. Acceptance criteria describe observable completion; risks include failures and capabilities given up.

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

Describe shipped reality in the present tense. Consequences cover costs and benefits. `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` are forbidden; `## Testing`, `## Deferred`, and `## Related` may state current facts.

#### `rejected/`

Keep the frozen proposal body, including its original sections, and put the verdict on `Status:`. The header, `## Problem` opener, `## Proposal`, and alternatives requirement still apply.

### Alternatives considered — mandatory

Record genuine alternatives and why they lost in `## Alternatives considered`, using one bold-led paragraph per alternative or a `### Why not <X>?` subsection. Never invent alternatives. Notes dated before 2026-07-05 whose alternatives cannot be reconstructed use this exact comment instead:

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### Moving between lifecycles

Update `Status:` and satisfy the destination skeleton in the same change. For `proposed/` → `implemented/`, replace the proposal and plans with the shipped decision, and fold acceptance criteria and risks into consequences or current verification. For `proposed/` → `rejected/`, add the rejection reason and freeze the proposal body.

### Chinese counterparts

The `.zh.md` sibling mirrors the English structure under the [i18n contract](../../docs/i18n/README.md). Keep `# Agent Note: ` and `Status:` tokens in English. The format gate skips Chinese files; the pairing gate checks their consistency.
