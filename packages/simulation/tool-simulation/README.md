# Simulation decision tools

English | [中文](README.zh.md)

`simulation_observe` returns only the current decision's frozen authorized sections. `simulation_stage` replaces the complete proposal list without world effects. `simulation_submit` journals a window proposal as `submitted`, or accepts a serial decision, then concludes the turn. Submitted proposals await ordered acceptance; accepted operation ids await execution. The model-facing stage schema includes participant-owned `task/create` and `task-completed` fulfillment; creator and Team identities come from the current decision, not proposal fields.

`simulation-team` derives the run, entity, writer and decision from the actual Agent and its consumed prepared input. Its execution guard denies other tools for Simulation actors. Staging is local to one writer epoch. Writer replacement cancels unaccepted decisions; collected window proposals remain in run history. Accepted decisions and operations survive independently of the old writer.

The scoped `@clocky/clocky-tool-simulation/role` entry selects the three installed Simulation tools, forces native presentation and filters the final assembled request schemas even when actor-owned tools are registered later. The native model owner separately rejects advertised capabilities outside its decision authority before dispatch or token admission; its execution guard still rejects foreign tool calls. Load the base tools and system-prompt owners first. The [company preset](../../../examples/simulation-company/presets/simulation/agent.cordis.yml) supplies a complete Simulation persona without filesystem variables or unrelated runtime context. Pass this preset through `agent.preset` for fresh and resumed activation.

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
