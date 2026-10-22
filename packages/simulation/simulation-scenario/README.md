# Simulation Scenario

Structural limits are explicit catalog defaults/ceilings and optional portable overrides: `maxBirthsPerInterval` and `maxExternalExpansionsPerInterval` are nonnegative safe integers, with zero disabling dynamic births or external expansion. `maxPendingMutations` accepts only `1`; unsupported concurrency, missing resolved bounds and overrides above ceilings reject. Compiler `9` freezes every bound in the resolved definition and review commitment; no compatibility default repairs old output. The [Native provider](../simulation-local/README.md) owns charges, retries and cleanup occupancy.

English | [中文](README.zh.md)

`@clocky/clocky-simulation-scenario` compiles `clocky.world/v0` JSON or safe YAML into immutable inputs for a new paused world. Its root entry is browser-compatible: it reads only its arguments, uses standard Web Crypto SHA-256, and performs no profile loading, storage, network, model invocation or identity allocation. The separate `./invariant` entry registers diagnostic ownership.

## Consumer contract

Call `compileWorldScenario(input, catalog, format)` with file text or an already-decoded definition and a complete installed metadata snapshot. `format` defaults to `json`; YAML text requires `yaml`, with no fallback after invalid JSON. Success returns `{ ok: true, resolved, preview }`; failure returns field diagnostics with `source`, `path`, `code` and `message`, without partial creation inputs. File structural diagnostics also retain `format` and available one-based `line`/`column`. `parseWorldScenario(input, format)` performs only strict structural parsing. `decodeScenarioInput(text, format)` performs only bounded syntax decoding and returns the JSON value with a path-to-location lookup; `serializeScenarioDefinition(definition, format)` writes JSON or safe YAML. Browser authoring uses both so its syntax checks and source text match the Host. Unknown fields reject at every object boundary. Web Crypto must be available; digest failures reject the promise rather than becoming validation diagnostics.

Both syntaxes enter the same definition parser and canonical hash. The maintained YAML parser uses YAML 1.2 core scalars; times must be strings, and date-like text never becomes a Date. Duplicate keys (including JSON), explicit/custom tags, directives, merge keys, anchors/aliases, non-string mapping keys, hexadecimal/octal and nonfinite scalars, unsafe prototype keys and multiple documents reject before catalog resolution. Includes and executable fields are unsupported. Decoded inputs reject cycles, accessors, hidden properties and non-JSON values without invoking custom serializers.

`WORLD_SCENARIO_INPUT_LIMITS` fixes file and serialized input/catalog ceilings at 262,144 UTF-8 bytes, depth at 32 (root depth zero), aggregate nodes at 16,384, each collection at 2,048 entries, identity/reference strings at 4,096 and the complete serialized successful compilation at 1,048,576 bytes. Object/array entries and values count toward nodes; `id` and keys ending in `Id`/`Ids` count references. Text is byte-checked before parsing, YAML ASTs before conversion, and decoded values before recursive schema validation. These parser ceilings are independent of execution quotas. Capacity violations use `invalid-shape` diagnostics.

Before accepting a creation command, call `verifyWorldScenario(input, currentCatalog, preview, format)` using the original file syntax and the hash and catalog generation that were reviewed. The compiler resolves again and rejects a changed generation or hash. The owner must keep the catalog stable through acceptance and persist the original command plus the complete successful resolved result before any creation IO. Retrying an accepted command reuses that result; compilation does not manage commands, reserve identities or make creation transactional.

The SHA-256 definition hash covers canonical parsed JSON: object keys are sorted, JSON formatting whitespace is ignored, string contents are preserved and array order is retained. The preview hash also covers the compiler version, catalog generation, frozen policy, selected template and model versions, clocks, effective limits and all resolved inputs. Outputs are deeply frozen and detached from caller-owned objects. The catalog owner must advance its generation whenever installed policy, versions or availability changes.

## Portable definition

A definition contains `apiVersion`, metadata, one organization, positions with capacities, a default versioned runtime profile, selected versioned persona templates, initial actors, assignments, hiring authorizations and initial events. `limits` and per-actor profile/persona overrides are optional; successful resolution makes their effective values explicit.

Exactly one actor has role `director`; all others have role `member`. Names and every persona selection come from the chosen installed template. An actor without a profile override inherits the definition's default profile. Omitted persona fields come from the installed template's explicit default persona. The default profile must permit members because it also supplies future generated actors. Actor profiles must permit their selected roles, and both profile and model must be available.

Entity identities are unique across organization, positions and people. Assignment and authorization identities share one relation namespace; a person has at most one initial assignment. An authorization selects an initial member and a declared position; directors cannot authorize their own requests. An initial `hire-request` contains an application identity, requester, position, simulated time and description, and requires its matching authorization. Initial occupancy, entity/history/channel limits, initial event count and clock bounds are checked before success. Model text and template descriptions confer no authority.

## Installed metadata and resolved outputs

The strict catalog contains `generation`, `policyVersion`, explicit Native clock/protocol settings, installed runtime profiles with model versions and availability, persona templates with complete default personas, and complete Native/Team/world limit defaults and ceilings. Portable input contains only references to installed runtime profiles and templates; it cannot supply provider paths, Session identities, runtime proofs, credentials, code or endpoints.

Explicit limit requests above deployment ceilings reject with field diagnostics. Omitted values resolve to the minimum of the catalog default and its ceiling; permitted explicit values remain unchanged. The preview preserves those effective values. Native limits include model, decision, residency, ingress, event, retry and operation bounds; Team limits include historical participants/activations, channels, delivery, tasks and lifetime budgets. Every field is explicit in the catalog, including zero where the underlying Native limit permits it. These values are metadata; the creation owner must actually apply the resulting limits to the Native run and Team.

`resolved.native` contains creation fields without a run identity or storage route, including fixed `assignment` and `can-hire` relation rules. `resolved.world` is the strict Native world definition. `entities` and `relations` are initial command inputs using the definition's symbolic identities: people start `preparing`, while noncognitive organization and position entities are `ready`. `actors` retains complete runtime, model, template and persona selections; `generatedActorRuntime` retains the default for future members. `channels` describes a private director channel for each member without assigning Channel identities. `initialEvents` retains scheduled business-application inputs without assigning HireIntent identities. Native still validates live identity, authority, capacity and readiness when these inputs are consumed.

## Complete v1 authoring

The explicit `parseWorldScenarioV1`, `compileWorldScenarioV1`, `verifyWorldScenarioV1` and `exportWorldScenarioV1Text` APIs accept `clocky.world/v1`. The strict definition covers runtime profiles and installed domains, cognitive/noncognitive entities, organization units and temporal assignments/grants, committees and authored institutions, facts, private beliefs, resources, channels, simulated external identities, ordinary goals and finite calendars. Semantic diagnostics retain field paths; shape diagnostics also locate the original text source. Compiler version `9` freezes the original complete definition, declared `catalog` with all defaults/ceilings and template default Personas, independently observed `teamCeilings`, effective models/limits, domain pins and `bootstrap` data without allocating identities or calling models. Native preparation consumes these data through the original retained initialization book and a single atomic application. The original default compiler APIs remain explicitly v0. Product preflight/create/export also accept v1, revalidate actual Native domain pins and retain the full compilation before canonical preparation. `resolvedWorldScenarioV1Schema` reconstructs every retained field from the complete original catalog and Team observation; it neither substitutes effective limits for defaults/ceilings nor fabricates template defaults. Explicit Team requests above either ceiling reject; omitted values use the stricter bound. Pure compilation and verification accept a fourth/fifth `teamCeilings` argument respectively, with explicit null when no Host observation exists. Compiler versions other than `9` and missing metadata reject without consulting the current deployment; the creation owner separately verifies definition and preview commitments. Director declarations require an explicitly installed `directorEvents` capability, the original finite calendar, exact World root scope/target and a positive `maxRequests` no larger than the occurrence count. Missing capability, invalid references and unsupported future permission installation reject with field diagnostics. The v1 workbench and the TS/Python SDKs consume these endpoints. The [distribution example](../../../examples/simulation-company/README.md) covers source TS/Python, plain Node compiled TS and an installed Python wheel over the actual stdio Host; read-only recovery does not construct a writable owner.

## Definition export

`exportWorldScenario(resolved)` returns a detached portable definition for a new run. Recompiling it against the same catalog preserves the resolved semantics and preview. It excludes resolved deployment metadata, actual runtime bindings, logs and credentials. A changed catalog requires a new preview; an export is not a running-world backup. `exportWorldScenarioText(resolved, format)` emits that definition as JSON or safe YAML; both recompile to the same definition hash.

The [company](../../../examples/simulation-company/scenarios/world-company.json) and [laboratory](../../../examples/simulation-company/scenarios/world-laboratory.json) definitions use the same compiler and only change organization, position, persona references and names. Their installed catalog fixtures are supplied separately by consumers.

`metadata.description` becomes the Team objective and must contain non-whitespace text. Compilation returns an `invalid-shape` diagnostic at `metadata.description` for whitespace-only input before creation can be accepted. Valid descriptions retain their original text, including surrounding whitespace, in exports and definition hashes.

`limits.world.maxRequestsPerActorPerInterval` is an optional authored reduction and a required catalog default/ceiling. Compiler9 retains its resolved value with Native `budgetInterval`; invalid or excessive values reject before creation. Native counts each actual accepted requester once per business identity in its original decision interval, including terminal cases, while the independent `maxRequests` history bound covers every new intent.

Organization graph and keyboard list edits use closed `ScenarioDraftCommand` variants for units, positions, capacity and assignments. `stageScenarioDraftCommand` creates an inert candidate; callers must pass it through Host preflight before publishing it. `applyScenarioDraftCommand` performs that validation against an explicit installed catalog. Both use the same v1 compiler as source imports, so unknown references, hierarchy cycles and capacity failures remain authoritative. Layout coordinates are not part of these commands or the portable definition.

## Model Experience

### Compilation

#### What the model sees

`compileWorldScenario()` produces no model input. It returns frozen template and actor metadata to creation owners.

#### Token effect

Compilation, preflight verification and export make no model calls and consume no model tokens.

#### KV Cache effect

This package neither creates model requests nor mutates Sessions. Consumers own any later context construction and cache behavior.

## Known Limitations and Deferred Work

- This compiler does not create a product, Native run, Team, participant, Session or Channel; product authorization, accepted-command recovery and paused bootstrap remain consumer responsibilities.
- The `clocky.world/v0` definition supports only one organization, one director, initial assignments and bounded generate-and-hire requests; it does not include arbitrary domain operations, governance, transfers or departure. Arbitrary domain operations, governance, transfers and departure workflows are outside this definition version.
- Capacity checks describe initial metadata. Future reservations, live authorization changes and cross-owner recovery require Native and Team enforcement; successful preflight does not authorize execution.

Optional `organization.hiringFees` strictly compiles explicitly priced generated/existing hires. Charge account identities, money kinds/units, operation/position references, quantity and positive simulated validity are checked during pure preflight. All terms remain in original definition/resolution commitments. Compiler9 rejects prior v1 resolutions rather than reconstructing missing financial behavior.

Version 1 calendars optionally declare `recurrence: { version: 1, clock: "simulation", shifts, exceptions, additions }`. All entries are canonical simulated ticks; shifts lie within the declared period. Expansion requires a finite `endsAt`, at most 4096 cycles/occurrences and the existing run horizon. Duplicate entries, contradictory added/excluded times and host-local date/timezone interpretation reject before initialization. The original portable definition retains these fields through export.

Portable `clocky.world-template/v1` packages wrap a complete v1 definition and a strict manifest: package ID/version, explicit license identifier/notice, attribution, exact domain schema/implementation generations, allowed runtime profiles, finite templates and policy version. `parseWorldTemplatePackage()` uses the bounded inert JSON/YAML decoder and rejects unknown fields or incomplete dependency inventories. `verifyTemplateDependencies()` rejects unavailable or changed pins against the installed catalog; Product checks them during both preflight and creation. Import never installs code. The manifest is separate from world facts and private author layout.

Portable v1 `entities` may include `kind: object` with `cognition: none` and the existing identity/name/description fields. This is a plain display object, not a Persona or authorization owner; its supported name mutation uses an explicitly installed domain operation.
