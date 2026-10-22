/** Complete test-owned Native/canonical prefixes are read at the actual cut without creating any business fact. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import { simulationInspectionSelectionSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationRunSelection, SimulationEntityId, SimulationEntityBinding } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'

/**
 * Capture real original artifacts for the focused R06 runner; ordinary legacy scenarios have no extra observation.
 * @param ctx - Actual Loader services; reads use existing Native, Team, Channel and Session owners.
 * @param run - Original exclusive run whose stream is only read, including during an append-response barrier.
 * @param selection - Same original provider/spec used to inspect the actual durable prefix rather than a pre-fold callback snapshot.
 * @param cut - Test observation label; filenames also retain the independent process round.
 * @param options - A caller holding the canonical source cut must not re-enter its Team/Channel/Session queues.
 */
export async function recordR06Cut(ctx: Context, run: SimulationRun,
  selection: Pick<SimulationRunSelection, 'provider' | 'spec'>, cut: 'barrier' | 'final' | 'baseline',
  options?: { readonly canonicalCut: 'held' }): Promise<void> {
  const round = process.env.WORLD_R06_ROUND
  if (round === undefined) return
  assert.ok(['0', '1', '2'].includes(round))
  const inspected = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({
    provider: selection.provider, spec: selection.spec, includeRecords: true }))
  assert.ok(inspected)
  const state = inspected.snapshot, team = options?.canonicalCut === 'held' || state.teamReservation === undefined ? undefined
    : await ctx.teams.getTeam({ teamId: state.teamReservation.teamId })
  const channels = await Promise.all((team?.channelIds ?? []).map(async (channelId) => {
    const pages = []; let after = -1
    for (;;) {
      const page = await ctx.teams.readChannelPage({ channelId, afterCursor: after, limit: 32 })
      pages.push(page)
      if (page.nextCursor === undefined) return { channelId, pages }
      assert.ok(page.nextCursor > after); after = page.nextCursor
    }
  }))
  const sources: Array<{ entityId: SimulationEntityId; binding: SimulationEntityBinding }> = []
  for (const entity of Object.values(state.entities)) if (entity.binding !== undefined)
    sources.push({ entityId: entity.id, binding: entity.binding })
  for (const reservation of [...Object.values(state.world?.reservations ?? {}),
    ...Object.values(state.world?.external.representatives ?? {})])
    sources.push({ entityId: reservation.identities.entityId, binding: reservation.identities.binding })
  const unique = new Map(sources.map(value => [value.binding.sessionId, value]))
  const sessions = options?.canonicalCut === 'held' ? undefined : await Promise.all([...unique.values()].map(async ({ entityId, binding }) => {
    const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  }))
  const stream = Reflect.get(run, 'stream') as LogStream, journal = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128)
    assert.ok(page.length); journal.push(...page); after = page.at(-1)!.sequence
  }
  await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, `r06-${cut}-${round}.json`), JSON.stringify({
    pid: process.pid, round, cut, snapshot: state, team, channels, sessions, journal,
    canonical: options?.canonicalCut === 'held' ? 'held-cut-not-reentered' : 'complete',
  }, null, 2) + '\n')
}
