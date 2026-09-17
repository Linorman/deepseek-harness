# apps/web browser e2e

English | [中文](README.zh.md)

These tests boot the real web composition in-process and drive it with a real
Chromium over real HTTP. The lane's mechanics — modes, fixtures, goldens, and
the deliberate composition divergences from `clocky web` — are documented in
[`scaffold.ts`](scaffold.ts) and the
[browser e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md).

The shipped-composition scenarios begin from a Team draft or selected Team coordinator transcript. Direct subagent and workflow-run UI scenarios are not part of this lane. Legacy Workspace/Session browser owners pass `legacyWorkspaceSurface: true`; that option disables the adaptive native picker and mounts the browse-only Workspace client/Host rows solely for explicit custom-composition tests, while the default scaffold remains the shipped Team-first roster.

Real-model record/smoke runs may use a local OpenAI-compatible server by setting `CLOCKY_LOCAL_MODEL_BASE_URL`, `CLOCKY_LOCAL_MODEL_ID`, and `CLOCKY_LOCAL_MODEL_API_KEY` (use `EMPTY` for the unauthenticated local route). Set the optional `CLOCKY_LOCAL_MODEL_REASONING_EFFORT` when needed; the Qwen profile maps canonical `high` to the endpoint's `xhigh` spelling. The local route is explicit and wins over the DeepSeek route; keyless replay remains the default for this lane.

## These are Host-face tests

They type-check in the root `tsconfig.host.json`, not in the Client aggregate,
because they read Host services directly: `ctx.apiProxy`, the Host
`SessionStore`, `ctx.sessionProjectionCache`. Driving a browser at runtime does
not make a file part of the Client program — the two faces merge cordis
`Context` under the same keys with different services, so one program cannot see
both. Moving these files into the Client aggregate makes every Host-service
access fail to compile.

## Do not import `@clocky/clocky-client-*` here

Importing a Client package — a value or a type — pulls its whole TypeScript
project, and every project it references, into the **Host build graph**. That has
bitten this lane once already: four Client consumer packages reference
`api/remotes`' Client face, which cannot compile until Host tsdown has generated
`@clocky/clocky-compat-goal/remote`, so the Host build phase ended up waiting on an
artifact it produces itself.

When a scenario needs a Client-owned constant or pure function, mirror it here
instead, next to the commented-out import that names the source module. A drift
then surfaces as a missed selector or a stale mirrored value — a loud failure,
never a silent pass. `scaffold.ts` follows this rule for the welcome-notice
namespace, acknowledgement field, version, and asserted Chinese copy.

Two kinds of Client import stand. `assembled-boot.ts` drives the shell itself, so
it imports `AppWebEntry` from `@clocky/clocky-client-web` and the boot-manifest
type from `@clocky/clocky-client-modules/client`: booting the real shell is what
that harness is for, and both packages are already in the Host graph. Separately,
the chat scenarios import `conversationContextKey` from
`@clocky/clocky-client-runtime/client` because the Web bundle declares that
runtime for its browser roster. If that reachability leaves the graph, mirror the
helper like the rest.

Nothing mechanically enforces this rule; keep it in review.
