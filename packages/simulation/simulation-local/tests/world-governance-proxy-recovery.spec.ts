/** Actual Native acceptance and cold replay of routes and proxy authority on both durable backends. */
import { it } from 'vitest'
import { runPostMvpProxy, runPostMvpRoute } from './world-post-mvp-flow.ts'
it.each(['json', 'sqlite'] as const)('%s retains actual grant, proxy ballot and revocation across cold replay', async (backend) => {
  await runPostMvpProxy(backend)
})
it.each(['json', 'sqlite'] as const)('%s freezes two committee decisions, enacts the original institution and restores its hash', async (backend) => {
  await runPostMvpRoute(backend)
})
