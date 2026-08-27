import { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import LocalFileSystem from '@clocky/clocky-fs-local'
import * as FsPolicy from '@clocky/clocky-fs-observation-policy'
import * as ToolFs from '@clocky/clocky-tool-fs'
import * as LlmPiAi from '@clocky/clocky-llm-pi-ai'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } })
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
