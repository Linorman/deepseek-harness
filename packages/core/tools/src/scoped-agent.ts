import type AgentRegistry from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import type { Context } from '@clocky/cordis'
import type { ToolRunContext } from './index.ts'

/** Generic caller-authentication refusal; the owning tool supplies its stable error code. */
export type ScopedToolAgentFailure = 'AGENT_REQUIRED' | 'DRIVER_REQUIRED'

/**
 * Require the exact resident Agent that owns a scoped tool, executing inside its active driver.
 * @param registry - Live Agent lookup and initiator boundary owned by the runtime.
 * @param execution - The caller identity supplied by the tool runtime.
 * @param expected - Agent whose scope installed this tool.
 * @param toolName - Owning tool's name used in the existing caller diagnostics.
 * @param failure - Tool-owned factory retaining its stable error vocabulary.
 * @returns The verified calling Agent.
 * @throws The factory's error when the caller is absent, substituted, retired, idle or outside its driver.
 */
export function requireScopedToolAgent(
  registry: Pick<AgentRegistry, 'get' | 'currentInitiator'>,
  execution: Pick<ToolRunContext, 'agent'>,
  expected: Agent,
  toolName: string,
  failure: (message: string, kind: ScopedToolAgentFailure) => Error,
): Agent {
  const agent = execution.agent
  if (agent === undefined) throw failure(`${toolName} requires a calling Agent`, 'AGENT_REQUIRED')
  if (agent !== expected || registry.get(agent.id) !== agent || agent.status !== 'running'
    || registry.currentInitiator() !== agent) {
    throw failure(`${toolName} requires its exact live scoped Agent inside an active driver`, 'DRIVER_REQUIRED')
  }
  return agent
}

/**
 * Bind installed scoped-tool disposers to Agent retirement and the owning plugin lifetime.
 * @param ctx - Plugin context owning the listener and teardown effect.
 * @param registrations - Consumer-owned installations in their existing disposal order.
 * @param label - Consumer's existing effect label.
 * @returns No value; the context owns both cleanup paths.
 */
export function bindAgentToolDisposal(ctx: Context, registrations: Map<Agent, () => void>, label: string): void {
  ctx.on('agent/disposed', ({ agent }) => {
    registrations.get(agent)?.()
    registrations.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of registrations.values()) dispose()
    registrations.clear()
  }, label)
}
