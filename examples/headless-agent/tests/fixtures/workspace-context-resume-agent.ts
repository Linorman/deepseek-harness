/**
 * Loader fixture that resumes the seeded agent-instructions session.
 * @module workspace-context-resume-agent
 */

import type { Context } from '@clocky/cordis'
import type { SessionId } from '@clocky/clocky-session'

/** Fixture plugin name. */
export const name = 'workspace-context-resume-agent'
/** Services that must exist before the fixture resumes its agent. */
export const inject = ['agents', 'agentLoop', 'sessionPersistence']

/**
 * Resume the seeded session and bind its handle to this fixture's lifetime.
 * @param ctx - settled agent and persistence services from the Loader tree.
 * @returns after the resumed agent is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const handle = await ctx.agents.resume({
    resumeSessionId: 'workspace-context-resume' as SessionId,
    agentOptions: { provider: 'test-provider', model: 'test-model' },
  })
  ctx.effect(() => () => handle.dispose(), 'workspace-context-resume-agent.handle')
}
