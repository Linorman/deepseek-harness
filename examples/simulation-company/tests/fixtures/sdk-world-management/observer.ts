/** Observe actual Loader paths and writable seams without supplying a business result. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'

export const inject = ['simulations', 'simulationTeams', 'worldDriverProbe', 'teams', 'teamActivations', 'agentRuntimes',
  'agents', 'sessions', 'sessionPersistence', 'llm', 'tools']
/** @param ctx - Real services; counted calls delegate to their existing business owners. */
export async function apply(ctx: Context): Promise<void> {
  await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, `runtime-${process.pid}.started.json`),
    JSON.stringify({ pid: process.pid }) + '\n')
  let opens = 0, attaches = 0
  const open = ctx.simulations.open.bind(ctx.simulations), attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
  ctx.simulations.open = (...args) => { opens++; return open(...args) }
  ctx.simulationTeams.attach = async (...args) => {
    attaches++
    try { return await attach(...args) }
    catch (cause: unknown) {
      await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, `attach-error-${process.pid}.txt`),
        String(cause instanceof Error ? cause.stack : cause) + '\n')
      throw cause
    }
  }
  ctx.effect(() => async () => {
    await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, `runtime-${process.pid}.json`), JSON.stringify({
      pid: process.pid, execArgv: process.execArgv, argv: process.argv, opens, attaches,
      modelCalls: ctx.worldDriverProbe.requests.length,
      modules: Object.fromEntries(['@clocky/clocky-simulation-product', '@clocky/clocky-simulation-local',
        '@clocky/clocky-simulation-world/providers', '@clocky/clocky-sdk-jsonrpc-server'].map(name => [name, import.meta.resolve(name)])),
    }, null, 2) + '\n')
  })
}
