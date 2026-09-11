/**
 * Built-artifact guard that direct-subagent lifecycle remains absent from the
 * SDK server wire even when both built bundles share one scope carrier.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const jsonrpcBundle = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const execFileAsync = promisify(execFile)

const builtRuntimeProbe = String.raw`
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = (path) => import(pathToFileURL(resolve(path)).href);
const [
  { Context },
  agentCore,
  { default: SubagentRuntime },
  { default: JsonlSessionPersistence },
  { HarnessSdkJsonRpcServer },
  { SessionId },
] = await Promise.all([
  load("vendor/cordis/lib/index.js"),
  load("packages/examples/agent-spine-demo/lib/index.js"),
  load("packages/subagent/subagent/lib/index.js"),
  load("packages/session/session-persistence-jsonl/lib/index.js"),
  load("packages/sdk/server/lib/index.js"),
  load("packages/core/session/lib/index.js"),
]);

const storageRoot = await mkdtemp(join(tmpdir(), "jsonrpc-built-scope-"));
const ctx = new Context();
try {
  await ctx.plugin(agentCore, { workspaceContext: false });
  await ctx.plugin(SubagentRuntime);
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot });
  await new Promise((ready) => setTimeout(ready, 50));

  const notifications = [];
  const server = new HarnessSdkJsonRpcServer(ctx, {
    request() { return Promise.reject(new Error("unexpected host request")); },
    notify(method, params) { notifications.push({ method, params }); },
  });
  const parent = await ctx.agents.create({
    sessionId: SessionId("built-parent"),
    meta: { cwd: storageRoot },
    agentOptions: { model: "test" },
  });
  const child = await parent.agent.ctx.agents.create({
    sessionId: SessionId("built-child"),
    meta: { cwd: storageRoot, parentSession: SessionId("built-parent") },
    agentOptions: { model: "test" },
  });
  const result = Promise.withResolvers();
  const unregister = ctx.subagents.registerProvider({
    name: "built-local",
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start() {
      return Promise.resolve({
        id: child.agent.id,
        localAgent: child.agent,
        result: result.promise,
        dispose() { return Promise.resolve(); },
      });
    },
  });
  const run = await ctx.subagents.start("built-local", {
    parent: parent.agent,
    prompt: [],
    signal: new AbortController().signal,
  });
  await child.dispose();
  result.resolve({ output: [], stopReason: "completed" });
  await run.result;
  await Promise.resolve();

  console.log(JSON.stringify(notifications.filter(({ method }) => method.startsWith("subagent."))));
  await run.dispose();
  unregister();
  await parent.dispose();
  await server.shutdown();
} finally {
  await ctx.fiber.dispose();
  await rm(storageRoot, { recursive: true, force: true });
}
`

describe.skipIf(!existsSync(jsonrpcBundle))('clocky-sdk-jsonrpc-server BUILT scope carrier', () => {
  it('does not project direct-subagent completion after child disposal', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', builtRuntimeProbe], {
      cwd: repoRoot,
      timeout: 15_000,
    })

    expect(stderr).not.toContain('listener threw')
    expect(JSON.parse(stdout) as unknown).toEqual([])
  })
})
