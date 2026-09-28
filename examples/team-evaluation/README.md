# Team evaluation cases

English | [中文](README.zh.md)

Six local cases exercise Team coordination and social or company simulation at simple, medium, and difficult levels. Every case owns its prompt, input, and acceptance checklist. Work from the repository root with Node and pnpm installed. None of the cases requires internet search. The simple and medium company cases use scripted Simulation runs; the difficult cases leave Team organization and outcomes open.

| Level | Team coordination | Simulation |
|---|---|---|
| Simple | `simple/01-ticket-triage/` | `simple/02-buyer-supplier/` |
| Medium | `medium/03-order-reconciliation/` | `medium/04-procurement-exceptions/` |
| Difficult | `difficult/05-company-emergence/` | `difficult/06-community-response/` |

For a simple or medium task case, run its `run.sh` with a configured Headless model or submit `PROMPT.txt` to a Web Team. Run `verify.mjs` where present, then inspect Team participation using `CHECKS.txt`. For a simple or medium company case, run its `run.sh`, then submit `PROMPT.txt` for analysis of the recorded Simulation run. For a difficult case, submit its short `PROMPT.txt` to a Team or run its `run.sh` with a configured model. The Team chooses roles, work and decisions; `CHECKS.txt` evaluates evidence and constraints without fixing the outcome. The social case requires a distinct Simulation run and documents the opt-in runtime in `RUNTIME.txt`.

Headless Team cases use the default shared workspace and require a configured model. The simple and medium company scripts use local scripted behavior and run without an API key. A case's `output/` is ignored by Git. Keep `CHECKS.txt` out of the prompt sent to the evaluated Team.
