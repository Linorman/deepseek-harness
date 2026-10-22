# Community repair workshop opening exercise

English | [中文](README.zh.md)

This World v1 exercise follows independent governance, approved hiring, external contact, transfer, explicit handoff and departure. It tests whether a small organization stops correctly when evidence, approval or settlement is missing; it does not prescribe a successful outcome.

## Files and verification status

| File | Purpose |
|---|---|
| [scenario.json](scenario.json) | Editable World v1 import definition |
| [scenario.yaml](scenario.yaml) | Equivalent safe YAML; import only one representation |
| [deployment.example.json](deployment.example.json) | Runtime profiles, finite personas, pinned domains and explicit bounds |
| [validate.mjs](validate.mjs) | Compilation, format equivalence, rejection checks and configuration assembly |

Validation requires current build artifacts and does not depend on repository test fixtures.

No Agent storyline or real model has been executed. The example model route is a placeholder with `available: false`; real preflight must report `model-unavailable`. Validation changes availability only in a private in-memory catalog copy to test the remaining semantics. It neither installs a provider nor establishes actual readiness.

## Actors and authority

| Role (stable ID) | Responsibility | Prohibited shortcut |
|---|---|---|
| Workshop lead `ceo` | Propose/enact the service charter, vote independently, accept separately handed-off work | Vote for the reviewer or declare undelivered tools received |
| Resident reviewer `peer` | Independently review the charter and exact hire | Alter frozen proposal text or substitute discussion for ballots |
| Personnel coordinator `hr` | Request a colleague and inventory duties before transfer/departure | Allocate Person/Session directly or rewrite the original debtor |
| Director `director` | Validate original requests and bounded plans | Vote for others or publish private review notes as facts |
| New colleague (allocated ID) | Handle external contact, then records and handoff | Read director-private notes or invent stock |
| Supply representative (allocated on expansion) | Respond through an independent persona and Session | Inherit workshop secrets or make real supplier commitments |

Newly allocated IDs must be read from actual results.

Everything is simulated. The hiring account starts at 10 credit, with a one-off 3 credit hiring fee; a committed hire leaves balances 7/3, while rejected or uncommitted work cannot debit funds. These are neither wages nor real money nor model charges. Supply inventory starts unknown. The exercise does not implement actual tool delivery or repair of physical objects.

The initial `initial-hiring-approval` norm is validated by an installed policy: one hire for the contact position, with exact committee approval. The later `opening-service-charter` is a separate advisory document; its prose is not an arbitrary Native policy program. Grants and position permissions define authority; goals cannot extend it. The director-only `REPAIR-PRIVATE-ONLY` note must not enter newcomer or representative context.

## Timeline

Times are simulated minutes, not wall-clock waits. Goals and calendars offer decision opportunities rather than writing successful outcomes in advance. Missing prerequisites must remain waiting, blocked or rejected.

| Time | Action | Evidence |
|---|---|---|
| 1 | Propose the opening service charter | Original text/hash and frozen two-member electorate |
| 2, 3 | Independent ballots | Separate voter provenance; no/abstain remain valid outcomes |
| 4 | Request enactment only if passed | One resolution and matching norm |
| 5, 6 | Request a colleague and exact hire approval | Original request, position and fee |
| 7, 8 | Independently vote on recruitment | Two yes votes required; no forced approval |
| 10 | Contact `qiaobei-tools` | Stable external identity, independent representative and original channel evidence |
| 14 | Request transfer to the handoff position | Same person/Session, non-overlapping assignments |
| 15, 16 | Establish and explicitly settle a handoff task | Acceptance by its actual assignee; original cancellation followed by separately accepted replacement work |
| 18 | Request departure | Unsettled duties block departure; history remains |

The definition schedules one initial external contact. To test repetition, add a bounded calendar, retain the same external key/generation, synchronize YAML, and preflight again. Display names are not identities.

## Validate and deploy

From the repository root:

```sh
pnpm run build
node examples/simulation-company/scenarios/community-repair/validate.mjs
```

Skip the build only when artifacts already match source. The script writes `.local/scenarios/community-repair/validation.json` and `world-options.json` inside the project. The latter is a complete `administration.world` option object, not a standalone Cordis configuration or a portable world import. No run is opened and no inference occurs.

Configure the existing `@clocky/clocky-simulation-product/administration` plugin's `world` field with that object, retaining other deployment settings. Install the actual local/Team owners, World execution providers, Simulation preset, three tools and model service; see the [existing composition](../../cordis.yml) and [example guide](../../README.md). Model provider/name/version must match installed metadata. Set availability only after verification and advance catalog generation. Token and Team cost-unit limits are not currency guarantees; real trials still need separately agreed provider pricing and hard budgets.

In a World v1-enabled Web Host, open Simulation → New world, import either definition, inspect actual preflight, and create a paused run. Review roles, committee, initial validated norm, simulated funds and effective bounds before explicitly starting. With no configured real model, this delivery stops at validated design. The existing `complete-world` scripted adapter recognizes its own test storyline, not these new natural-language goals.

## Observe and vary

Retain the four request/plan/execution/notification states, original Decision/Envelope sources, assignments, resources and obligation inventory. Pause before checkpointing; explicit recovery must remain paused without duplicating identities or effects.

Use separate newly preflighted runs for dissent, unknown inventory, outstanding handoff duties and same-command retries. Asking the reviewer to dissent does not guarantee a model vote; judge actual ballots. Verify unknown stock does not become assets, accepted unresolved tasks block departure, and exact retries do not hire or pay twice. Inspect newcomer/representative contexts for the private marker. Filtering fields alone cannot prove that free text from a role previously exposed to private data never leaks it.

The baseline has four initial cognitive people, one newcomer and at most one external representative, two resident slots and limits of sixteen entities/historical participants. The 50,000-token Native/Team example bounds may stop a real model before the storyline finishes; record that outcome instead of automatically raising limits. Keep both authoring formats synchronized: validation rejects mismatches.
