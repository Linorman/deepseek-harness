# AGENTS.md — Web client stack

Rules for `packages/client/*` and `apps/web`, supplementing [package rules](../AGENTS.md). Packages use `@clocky/clocky-client-<name>`. Consult the [slot standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) for composition and the [client architecture](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) for loading and service ownership.

## Slot and props discipline

Compose through `ctx.slots.register({ name, children?, store?, inject? }, Component)`. `children` declares and authorizes rendered slots; only the shell renders `root`. Use `ctx.slots.inject` to wait for another entry's declaration; service injection does not order slot declarations.

Derive props from `PropsRuntime`, `PropsRenderSlots`, `PropsStore`, and the inject face. Components receive props, never `ctx`, services, or React contexts. Inject JSON-compatible data and callbacks from declared dependencies; reserve its `hooks` compartment for bare observables bound by the renderer. Route ReactNode content through slots; existing composer `accessory`, `overlay`, `leftItems`, and `rightItems` fields remain exceptions until moved to slots.

## Reactive read and contract-currency discipline

1. Read externally mutable render data through framework hooks; event handlers may read snapshots.
2. Keep subscriptions in `ui-renderer`; business source has no renderer value imports, and components never mirror external snapshots into local state or stores.
3. Parent-owned data uses owner props; component-private data uses local state; shared/remount-surviving viewing state uses a registered store. Business data stays in the React-free object layer.
4. Export store factories; instantiate only in `apply` in production. Read through `props.useStore`, mutate through `props.actions`; derive data from framework hooks without another subscription.
5. Keep observable source identity stable, and snapshot identity stable between changes.
6. Publish rebuilt values through their owning source immediately; late registration notifies existing consumers. User-gesture echoes use `notifyNow`; structural updates use `markDirty`, streaming uses `markFrameDirty`.

## Export discipline

UI-plugin browser APIs expose Loader exports, store factories used for prop types, and shared types. Components, helpers, constants, and handles stay internal; tests import internals directly. Communicate across feature plugins through slots/services. A new public capability requires a current consumer and an owning design decision; do not add exports merely to bypass composition or support a test.

## Loading and dependencies

Follow [verify-client-packages](../../scripts/verify-client-packages.ts): Cordis and dynamic workspace relationships are peer plus dev; static inputs and test-only workspace dependencies are dev-only; ordinary installed libraries are dependencies. Peer/dev ranges match. Published `files` cover relative runtime imports and assets.

Browser and Node faces declare externality independently. Browser baseline modules come from [platform.ts](web/src/platform.ts); declare exact non-baseline shared value imports in `clocky.client.external`. Private copies need no request. Synchronous module cycles fail; Cordis service cycles are separate. `clocky.client.inject` is informational, never activation ordering.

New packages register in the Client compiler aggregate, Web composition, and resolver dependencies; follow [adding a package](../../docs/cookbook/adding-a-package.md). Rebuild bundles before probing servers that serve `lib/client.js`. `CLOCKY_CLIENT_*` build values are public; use runtime configuration for post-build choices.

## Feature boundaries and presentation

Keep sibling feature domains independent; `apply.ts` assembles them. Register Conversation Nodes and keyed renderers through the [cookbook](../../docs/cookbook/adding-a-conversation-node.md); folds replay by `seq`, and hot paths never scan the full event window. RPC initiators mint `rpcId`, responders echo it; business APIs use `RpcRequest<P>`.

Presentation stays out of session logs. Use [semantic CSS tokens](../../docs/web-styling.md), CSS Modules, and `clsx`; no literal colors, Tailwind, or component library. Product copy is Chinese; comments are English.

## Verification

Component tests assert visible behavior through realistic props; jsdom specs use a first-line environment pragma. Follow [testing policy](../../docs/testing.md) and [focused check selection](../../.agents/skills/dsh-pre-push-checks/SKILL.md). Assembled browser/output changes also run `CLOCKY_SNAPSHOT=replay pnpm run test:web`; report unrelated failures without silently changing their owners.
