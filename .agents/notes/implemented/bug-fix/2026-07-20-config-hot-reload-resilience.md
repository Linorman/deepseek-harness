# Agent Note: A config hot-reload must not kill or degrade a live app

Status: implemented

English | [中文](2026-07-20-config-hot-reload-resilience.zh.md)

## Problem

An invalid `cordis.yml` edit must not kill a running agent, but preserving the process is insufficient when a valid-looking update partially replaces the Loader tree before a later entry fails. Callers also need to observe a rejected live update without treating the same error as an unhandled boot failure. Personal configuration adds a second requirement: HMR must observe one exact file outside its module roots, including a file or parent directory created after startup.

## Decision

The vendored Cordis lifecycle and Loader plugins provide an awaited, compensating config transaction, logged as local modifications 6, 8, 9, and 19 in [vendor/README.md](../../../../vendor/README.md).

`Fiber.update()` returns its `internal/update` waterfall result. Config validation remains synchronous, while the default continuation returns the restart promise. Loader entry updates can therefore distinguish validation, import, application, and rollback failure from successful lifecycle settlement. `EntryTree.await()` rechecks service-gated fibers after Loader tasks drain and rejects settled failures; a fiber waiting on an absent service remains a valid pending entry rather than making settlement hang.

Concurrent `EntryTree.await()` callers recheck active tasks after awaiting fiber outcomes and before notifying Loader-dependent consumers. A previous waiter may have started a consumer in that interval. A stale notification would treat the consumer's own initialization as unfinished Loader work, withdraw its dependency, and repeatedly cancel and restart it without allowing timers to run. The recheck joins the actual work and preserves settled failure propagation.

The shipped headless and Web compositions declare `inject: [loader]` with `intercept.loader.await: true` on workspace recovery. Loader finishes asynchronous provider registration before the recovery scan can interpret missing providers as cleanup failures. Standalone Context compositions retain explicit provider-before-recovery mounting; no Loader dependency is added to the recovery plugin itself. Entry-level intercept configuration is separate from dependency names because Loader adds entry `inject` metadata after Cordis constructs the fiber's static intercept configuration.

Loader imports a changed module name before disposing the active fiber. Candidate application is awaited; a failure disposes candidate effects and restores the prior plugin or config. Group reconciliation starts candidates concurrently, awaits every outcome, and restores changed entries, additions, removals, and moves before rejecting. Persistence occurs only after successful programmatic mutation. This is a compensating transaction: lifecycle effects may be briefly visible, and a failed rollback is reported as an `AggregateError` rather than misrepresented as a retained tree.

Include reads and validates detached candidate content, applies patches to a clone, reconciles the Loader tree, and only then commits cached content and parsed data. `refresh()` rejects to its caller after a parse, validation, application, or rollback failure. Initial load remains fail-loud; only an absent file may use `initial`. A non-array YAML/JSON result is invalid, and both file refresh and Include-config update re-apply patches without mutating the cached parse.

HMR contains live refresh rejection. Its `registerConfig(filename, refresh)` method watches one exact path from the nearest existing ancestor, serializes and coalesces refreshes, and returns an async disposer that closes the watcher and drains active work. Both exact-path and ordinary config-file refreshes use that queue. A failure is normalized to `Error`, logged, and broadcast through the parallel `hmr/config-update-failed(filename, error)` event; rejecting observers are logged without stopping later refreshes. Creation, change, and removal are observed. Exact config paths additionally compare device/inode, size and nanosecond modification/change timestamps every configured `configPollIntervalMs` (default 1000 ms). Native events and metadata checks use one serialized, deduplicated refresh path. Initial absence is inert; creation, modification and removal still converge if native notifications are lost. Closing a registration stops new checks and drains accepted refresh work.

An HMR instance shares one cancellation signal between main-watcher startup and exact config registration. Owner removal closes admission before asynchronous cleanup and cancels pending readiness; Chokidar does not emit `ready` after a watcher closes. Registrations recheck owner and caller lifetimes after directory lookup, publish caller-owned cleanup before awaiting readiness, and remain tracked until publication or cleanup finishes. Disposal closes actual watchers and drains admitted registrations and refreshes. The early fiber-disposal notification also cancels a main watcher whose `Service.init` is still waiting, because Cordis waits for setup before running ordinary teardown. Cancelled registrations reject with `INACTIVE_EFFECT`, preserving the app launcher’s normal shutdown handling.

## Alternatives considered

**Contain failures inside `Include.refresh()`.** Rejected because it prevents an HMR host from broadcasting the failure and still permits Loader reconciliation to hide partial application. Include owns candidate parsing and commit; HMR owns containment and observation.

**Restart the process for every config edit.** Rejected because Cordis effects already provide reversible plugin lifecycle, and a syntax error or failed optional plugin must not discard live sessions merely to recover the prior composition.

**Promise invisible atomic replacement.** Rejected because arbitrary plugin effects cannot be snapshotted. Awaited application plus explicit compensation provides a stable final result without claiming that observers cannot see intermediate lifecycle transitions.

## Consequences

- A failed live refresh rejects internally, retains or restores the last-good tree when compensation succeeds, and broadcasts one typed failure without becoming an unhandled rejection.
- A rollback failure is visible and may leave an entry unavailable; the event and log do not claim otherwise.
- Fibers waiting on declared dependencies remain valid pending entries: lifecycle settlement means no current work failed, not that every dependency exists.
- Exact config watchers add filesystem resources only for admitted paths and release them with either their caller or the HMR owner. A retained service cannot create a watcher after its owner is removed.
- The vendored Loader, Include, HMR, and core event typing diverge further from upstream; the complete divergence is maintained in the vendor manifest.

## Testing

`packages/boot/app-boot/tests/loader-await.spec.ts` isolates the double-waiter microtask-spin regression in a subprocess and requires one initial consumer activation, one explicit restart, and complete effect cleanup. `packages/boot/app-boot/tests/workspace-recovery-order.spec.ts` executes both shipped composition rows with actual provider directory lookup delayed, rejects provider directory failure, and checks explicit recovery/provider restarts without extra scans. `examples/headless-agent/tests/workspace-release-restart.snapshot.ts` requires actual provider release, failed confirmation, SIGKILL, and independent Loader recovery on JSON and SQLite.

`packages/boot/app-boot/tests/config-reload.spec.ts` boots real temporary Loader/Include trees and covers parse and shape rejection, import-before-dispose, plugin/config restoration, multi-entry rollback, ancestor disablement, overlay convergence, option identity, failed direct-update persistence, and failed programmatic moves. `packages/boot/app-boot/tests/hmr-config.spec.ts` covers existing and missing exact paths, add/change/removal, serialized coalescing, disposal drainage, non-`Error` normalization, failure broadcast, and rejecting-observer containment. `packages/boot/app-boot/tests/hmr-lifecycle.spec.ts` delays real filesystem results while retaining real Chokidar watchers to cover owner removal, caller removal, directory lookup, readiness cancellation, and main-watcher initialization. `examples/headless-agent/tests/final-restart.snapshot.ts` requires separate Loader processes to recover finals after SIGKILL and then exit naturally on JSON and SQLite; its JSON completion windows expose late profile watchers that survive `appExit(0)`. `packages/host/webserver/tests/webserver.spec.ts` proves a service-gated startup failure rejects Loader composition with its bind diagnostic, `packages/typert/loader/tests/loader.spec.ts` exercises awaited programmatic removal through a real Loader consumer, and the ACP `pty-tools` snapshot guards concurrent composition from reordering equal-priority prompt sections.
