# Simulation decision tools

English | [中文](README.zh.md)

`resource/reserve` freezes an exact transaction, one-use grants and a simulated expiry without changing account balances. Available funds exclude all active holds. `resource/commit-reservation` and `resource/cancel-reservation` require the original actor and reservation revision. Commit rechecks account revisions, units, authority and grants, then transfers funds and settles the hold atomically. Expiry is a Native scheduled deadline; paused wall time does not release funds. Terminal history remains under the required `maxResourceReservationHistory` limit, so new IDs cannot refund quota. These local resource actions do not implement hiring fees or release unknown cross-owner I/O reservations.

The stage schema includes `world/request`, `world/resolve` and `world/evidence` for installed pinned domains. Requests require the consumed authorized World context and carry domain/operation/version, business key, expected time, evidence and a domain payload; Native derives the subject and validates the installed strict schema and authority at acceptance. A request decision contains one unmixed logical request. Ordinary requests expand their canonical private notification; authored environment requests retain their original calendar source. Director resolutions carry an installed apply payload, structured rejection or bounded evidence question. Evidence answers bind the original challenge, input revision and consumed notification. Generated-hire payloads select installed finite Persona options; other operations retain their own typed payloads. Private rationale is not a public description. Submit returns pending effects and never reports business success before execution. The tools expose no world configuration, identity allocation, maintenance, arbitrary patch or executor entry point.

`simulation_observe` returns only the current decision's frozen authorized sections. `simulation_stage` replaces the complete proposal list without world effects. Its description directs the model to submit a final staged list rather than repeatedly restage it. `simulation_submit` journals a window proposal as `submitted`, or accepts a serial decision, then concludes the turn. Submitted proposals await ordered acceptance; accepted operation ids await execution. The model-facing stage schema includes participant-owned `task/create` and `task-completed` fulfillment; creator and Team identities come from the current decision, not proposal fields.

`simulation-team` derives the run, entity, writer and decision from the actual Agent and its consumed prepared input. Its execution guard denies other tools for Simulation actors. Staging is local to one writer epoch. Writer replacement cancels unaccepted decisions; collected window proposals remain in run history. Accepted decisions and operations survive independently of the old writer.

The scoped `@clocky/clocky-tool-simulation/role` entry registers the three native Simulation tools inside the role preset and restricts inherited capabilities when an Agent joins, with native presentation. It filters the final assembled request schemas even when actor-owned tools are registered later. Standard Web does not register these capabilities in the global tool catalog. The native model owner separately rejects advertised capabilities outside its decision authority before dispatch or token admission; its execution guard still rejects foreign tool calls. Load the base tools and system-prompt owners first. The [company preset](../../../examples/simulation-company/presets/simulation/agent.cordis.yml) supplies a complete Simulation persona without filesystem variables or unrelated runtime context. Pass this preset through `agent.preset` for fresh and resumed activation.

For a World pinned to `bounded-v1`, `simulation_observe` defaults to its current context inputId/hash reference and empty sections; `detail: full` repeats the complete body. The current complete context already reaches the model through a replayable Session event. Hiring requests require `expectedTime: null` and empty evidence during staging, with an independent Native admission check.

`simulation_observe` accepts `sections: ["input", "authority"]` for selected frozen chapters, mutually exclusive with `detail: full`; invalid, empty or duplicate selections refuse without exposing other chapters. `simulation_submit` accepts `notification: {resultId}` only for the current result decision, resolving its exact Native notification instead of asking the model to reproduce its JSON. This route still verifies consumed context and cannot submit another result or override conflicting staged proposals. Canonical context failures stop inference with a retained internal diagnostic, rather than requesting model retries.

For `communication/post`, `recipient` is a simulation Entity ID, not a Team Participant ID. Use the recorded `replyTarget` entity/channel mapping. Invalid recipient bindings or delivery times fail during staging, allowing correction before submission concludes the turn. Final Native acceptance independently rechecks the same preconditions.

Staging checks request and apply-plan payloads against the exact domain pin authorized in the current frozen context. It allocates no request or execution lease. A rejected replacement preserves the previously valid staged list; bounded diagnostics report at most eight paths and eight allowed values per issue, without echoing proposed private text. Corrected submission still runs Native authority, timing and business validation.

## Model Experience

### Simulation decisions

#### What the model sees

`simulation_observe`, `simulation_stage` and `simulation_submit` expose authorized observation, complete proposal replacement and submission. Tool results distinguish staged, submitted and accepted proposals and never claim world success before execution. Cards use generic read/action presentation without filesystem locations.

#### Token effect

The schemas and requested observations consume tokens. Observations repeat only stored selected sections; the tools do not retrieve hidden world state.

#### KV Cache effect

Tool results append to the Session. They do not replace prior history or alter the prepared context prefix.

## Known Limitations and Deferred Work

- Retry context and knowledge selection remain caller-owned; the tools do not replay prior proposals.
