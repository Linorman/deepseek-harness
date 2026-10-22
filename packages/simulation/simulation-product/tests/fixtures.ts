/** Durable product directory with a native inspection provider; no model or execution owner is mounted. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import Simulations, { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationProvider } from '@clocky/clocky-simulation'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import SimulationProducts from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { simulationProductImportSchema } from '../src/directory.ts'

const spec = simulationRunSpecSchema.parse({ runId: 'native-run', tickUnit: 'minute', origin: '9007199254740993',
  maxTime: '100000000000000000000', rulesVersion: '1', policyVersion: '1', relationRules: [],
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000,
  tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000,
  maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
  maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 8,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '1000000',
})

export function registration(id = 'public-run', owner = 'reader', name = 'Registered simulation') {
  return simulationProductImportSchema.parse({ id, name, ownerPrincipalId: owner, provider: 'local', spec: { ...spec, runId: `native-${id}` } })
}

export function call(controller = new AbortController(), id = 'reader'): AuthenticatedProductCall {
  return { principal: { id: id as never, issuer: 'test', subject: id, assurance: 'test', credentialGeneration: 1 },
    credentialGeneration: 1, signal: controller.signal }
}

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

export async function fixture(backend: 'json' | 'sqlite' = 'json', options: Partial<Config> = {}) {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'simulation-product-'))
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'directory.sqlite') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(Simulations)
  const inspect = vi.fn<NonNullable<SimulationProvider['inspect']>>(async () => undefined)
  const open = vi.fn<SimulationProvider['open']>()
  const unregister = ctx.simulations.registerProvider({ name: 'local', open, inspect })
  const config: Config = { directoryStream: 'simulation-products', imports: [registration()], recoveryPageSize: 1, ...options }
  const mount = async (next: Config = config) => {
    const fiber = ctx.plugin(SimulationProducts, next)
    await fiber
    return { fiber, products: ctx.simulationProducts }
  }
  return { ctx, root, config, mount, inspect, open, unregister }
}
