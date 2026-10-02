# AGENTS.md

Clocky is a plugin-based agent harness on vendored Cordis. Package groups live under `packages/<group>/<pkg>/`; [packages/README.md](packages/README.md) maps them.

Load guidance for the task: [architecture](docs/architecture.md) for runtime structure and extension points; [defensive patterns](docs/defensive-patterns.md) for lifecycle, concurrency, subprocesses, and teardown; [documentation rules](docs/AGENTS.md) for prose. Subtree `AGENTS.md` files own local rules.

## Agent workflow (GPT-6 Astra)

Complete authorized work through relevant verification. Infer routine choices from context; ask only when missing information changes the outcome. User instructions override skill guidance, subject to system/developer instructions. Reviews stay read-only. Load only relevant skills and references; delegate independent work when permitted and useful, with separate ownership and verified results. Preserve existing work and report outcomes, evidence, and blockers in the user's language. [Rationale](.agents/notes/implemented/process/2026-09-05-astra-agent-instructions.md).

## Pre-release stance: foundation over blast radius

Remove this section at the first tagged release. Prefer a sound foundation over compatibility shims; update all references when renaming or repackaging. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `clocky-session` keeps `SESSION_FORMAT_VERSION` at `0` without a compatibility promise.

## Commands

Use pnpm with Node `^22.19.0 || >=24.0.0`. [Development](docs/development.md) owns setup, daily commands, build prerequisites, and Git integrations; [package.json](package.json) owns scripts.

```sh
pnpm install
pnpm run test              # focused Vitest filters accepted
pnpm run test:snapshot     # keyless runnable-example replay
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run doc-sync          # documentation gates
```

### Host sandbox failures

If sandbox restrictions block credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest available host escalation. Require evidence of sandbox interference; do not bypass test failures or the product sandbox under test.

### Run relevant checks locally

[dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md) selects evidence for the actual diff, including before pushes and after `gh stack sync`. Run relevant checks once; repeat for changed inputs, failures, or unresolved risks. Report commands and pending checks accurately. Use `check:windows-wine` only to diagnose a known Windows failure; CI owns the platform matrix.

## Secrets / .env

Never commit credentials. Provider tests and demos may read the gitignored root `.env`; [testing.md](docs/testing.md) defines provider-specific credentials and local-model routes. Cordis configuration allows `!!js` only under plugin `config` and entry `disabled`; other metadata stays literal. Use overlays for conditional composition ([primer](docs/cordis-primer.md#loader-configuration)).

## Conventions

- Packages are `@clocky/clocky-<name>`; harness packages declare `@clocky/cordis` as peer plus dev. Vendored packages are rescoped and private ([mapping](docs/rescope.md)).
- Use ESM, package-name imports across packages, and `.ts` in local imports. The source CLI uses `node --import tsx/esm`; config subprocesses use built `lib/` under plain Node. Follow the declared [launch modes](docs/testing.md#test-subprocess-launch-modes). Bare Cordis plugins must be declared in the resolver manifest's `dependencies`.
- Register contributions through `ctx.effect()` / `ctx.on()`; registry `register()` returns a disposer. Waterfall listeners call `next()` to delegate; omitting it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- Add behavior through plugin extension points. Changes to `agent-loop` update [architecture](docs/architecture.md). Anything model-visible must be reconstructable from the session log; new model inputs require session events.
- Typed events use declaration merging and extensible maps. Event JSDoc includes `@mode` and payload `@param`; absent scoped keys require `@clockyScopeScan unsupported`. Unknown `SessionEventMap` members refuse log reads unless the envelope carries `ignorable: true`; only structural format changes bump the version ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- Switch on discriminants: closed unions end in `assertNever`; extensible unions have a documented default. Opaque cross-boundary IDs use `Branded<B>` from `clocky-brand`.
- A [capability seam](docs/glossary.md#capability-seam) comprises Service Definition, Service Provider, and Consumer roles; split packages when roles evolve independently. Prefer [maintained dependencies](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md) when they remove owned code and tests.
- Resolve defaults explicitly as `resolve(request): Spec` in the owner, not inside `run()`. Deployment-varying choices are validated Cordis `Config` fields; protocol constants and security invariants stay fixed. Misconfiguration fails at load when self-contained, otherwise at the earliest resolvable point.
- Trust typed same-process inputs. Validate parser/config, queued, model/tool JSON, durable/file, worker/process, and wire inputs. Empty catches name the swallowed failure and why nothing else reaches them; keep the `try` to one statement. Prefer symmetric treatment of parallel values.
- Static gates and tests resolve workspace imports to `src`; artifact consumers declare their build prerequisite. Packages use one compiler aggregate except `api/remotes`; repository programs seed an explicit compiler face ([layout](docs/development.md#typescript-project-layout)).
- Tests name behavior. Runtime invariants check owned event/data relationships, not service presence or fixed examples; use a justified empty companion when no relationship exists ([package rules](packages/AGENTS.md)).
- Non-trivial changes add or update the owning [Agent Note](.agents/notes/README.md#when-to-write-one). Frozen archives are historical, never current authority. Non-trivial model/protocol/product-visible changes need a keyless [runnable-example snapshot](docs/testing.md#when-a-snapshot-test-is-required); loop, session-lifecycle, and event-map changes update both SDK owners.
- Decide tool render intent (`generic`/`terminal`/`diff`, `locations`) up front; presentation methods are pure functions of `args` ([cookbook](docs/cookbook/adding-a-tool.md)).
- Split independent PRs and fix the introducing PR before propagating. History rewrites use `--force-with-lease` and abort on remote movement; preserve an in-progress merge checkpoint before taking a newer base ([history policy](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)). Apply one `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).

## Type safety and documentation

Use strict TypeScript; explain unavoidable `any`. Document non-obvious module/export contracts and public parameters and returns; inherited and plugin-protocol members keep docs at their declaration. Update affected README and JSDoc with behavior. [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) defines coverage; [docs/AGENTS.md](docs/AGENTS.md) defines placement and bilingual pairing. Invoke `dsh-translate-docs` only on explicit request.

Enforce mechanically checkable rules in executed gates, test changed rejection paths, and prefer narrow justified exceptions. Files end with one newline; TODO urgency follows [development](docs/development.md#todo-markers).

## Editing these instructions

Root, `packages/`, and `examples/` `CLAUDE.md` files symlink `AGENTS.md`; edit the real file. Keep standing rules concise and link their owners.

## Vendoring policy

Follow [vendor/README.md](vendor/README.md) to sync pinned copies, reapply or retire logged modifications, and run `pnpm run test` plus `pnpm run build`.

## Temp files and storing policy

Keep temporary files and build/test outputs inside the project.

## Design Review Rules

For UI/UX reviews, follow [.design-rules/SKILL.md](.design-rules/SKILL.md) and its relevant HIG references.
