/** Real in-process owners used after a subprocess has left durable recovery state. */
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as Controller from '@clocky/clocky-team-activation-controller'
import Simulations from '@clocky/clocky-simulation'
import * as SimulationLocal from '@clocky/clocky-simulation-local'
import SimulationTeams from '../src/index.ts'

/** Mount real owners over the same media as the Loader subprocess. */
export async function createContext(root: string, backend: 'json' | 'sqlite', maxContextBytes = 65536, maxCoordinationRounds = 16, maxConcurrentModels = 2, maxQueuedModels = 16) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root: join(root, 'team-json') })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'team.sqlite') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(AgentRuntime)
  const runtimeFiber = ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await runtimeFiber
  await ctx.plugin(Controller)
  await ctx.plugin(Simulations)
  await ctx.plugin(SimulationLocal, { name: 'local', root: join(root, 'simulation'), backend, replayPageSize: 4 })
  const serviceFiber = ctx.plugin(SimulationTeams, {
    maxContextBytes, deliveryPageSize: 32, maxCoordinationRounds, maxConcurrentModels, maxQueuedModels,
  })
  await serviceFiber
  return { ctx, runtimeFiber, serviceFiber }
}
