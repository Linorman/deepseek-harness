import type { TeamActionResponseResult, TeamInboxPage } from '../../src/client/contract/team-tasks.ts'
/** Source-launched GC probe for browser-owned Team history retention. */
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@clocky/cordis'
import type { MuxFrame, TeamId } from '@clocky/clocky-client-connection/client'
import { TeamTaskRuntime } from '../../src/client/teams/service.ts'
import { FakeApiClient, ok } from '../fake-api.client.ts'

const ctx = new Context()
const api = new FakeApiClient()
const runtime = new TeamTaskRuntime(ctx, api)

/** Drop all strong references to the first returned business state when this function exits. */
async function firstSelection() {
  const selected = await runtime.open('gc-first' as TeamId)
  return {
    refs: [new WeakRef(selected.state), new WeakRef(runtime.list.getSnapshot().collections!)],
    teamId: selected.teamId, sessionId: selected.coordinatorSessionId,
    participantId: selected.state.coordinator.kind === 'bound' ? selected.state.coordinator.binding.activation.participantId : undefined,
  }
}

/** Capture only weak references so subsequent pages must release the first page and its rows. */
async function firstListWindow(): Promise<WeakRef<object>[]> {
  const response = await api.onTeamGet({ teamId: 'gc-page-base' as TeamId })
  if (!response.result.ok) throw new Error('Missing fixture Team')
  const base = response.result.value.team
  api.onTeamList = async (input) => {
    const index = input.afterCursor === -1 ? 0 : Number(input.afterCursor)
    const id = `gc-page-${index}` as TeamId
    return ok({ items: [{ ...base, id, goal: { ...base.goal, teamId: id } }], scanned: 1,
      nextCursor: String(index + 1) as NonNullable<import('../../src/client/contract/team-tasks.ts').TeamTaskListState['nextCursor']> })
  }
  await runtime.refresh(true)
  const items = runtime.list.getSnapshot().items
  return [new WeakRef(items), new WeakRef(items[0]!)]
}

/** Inbox pagination releases its pending previews and their question bodies. */
async function firstActionWindow(): Promise<WeakRef<object>[]> {
  api.teams.inboxRead = async (input) => {
    const sequence = (input.afterCursor ?? -1) + 1
    const action = { id: `action-${sequence}`, teamId: 'gc-actions', participantId: 'human', sessionId: 'session',
      kind: 'question', phase: 'pending', createdAt: 1, updatedAt: 1, sourceId: `question-${sequence}`,
      details: { questions: [{ id: 'question', question: `Question ${sequence}` }] },
    } as unknown as TeamActionResponseResult['action']
    const item = { kind: 'action', sequence, principalId: 'principal', recipientId: 'human', teamId: action.teamId, action, text: 'Question' } as TeamInboxPage['items'][number]
    return ok({ items: [item], displayCursor: -1, cursor: sequence, nextCursor: sequence })
  }
  runtime.handleMuxEnvelope({ rpcId: 'question-0' as never, payload: { type: 'question/requested', sessionId: 'session', teamId: 'gc-actions',
    questions: [{ id: 'question', question: 'Question 0' }] } as MuxFrame })
  await runtime.refreshInbox()
  const preview = runtime.list.getSnapshot().pendingHumanActions![0]!
  assert.equal(preview.kind, 'question')
  const action = runtime.list.getSnapshot().inbox.items[0]!
  return [new WeakRef(action), new WeakRef(preview),
    new WeakRef(preview.kind === 'question' ? preview.questions : preview)]
}

/** Allow completed JavaScript jobs to release WeakRef keep-alive roots before forcing collection. */
async function requireCollected(references: readonly WeakRef<object>[], message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await setImmediate()
    globalThis.gc!()
    if (references.every(reference => reference.deref() === undefined)) return
  }
  assert.fail(message)
}

try {
  assert.equal(typeof globalThis.gc, 'function', 'GC probe requires --expose-gc')
  const first = await firstSelection()
  for (const teamId of ['gc-second', 'gc-third', 'gc-fourth']) await runtime.open(teamId as TeamId)
  await requireCollected(first.refs, 'previous Team state and collection arrays remain strongly retained')
  const current = new WeakRef(runtime.list.getSnapshot().selected!.state)
  runtime.startDraft()
  await requireCollected([current], 'draft entry retains the previous Team state')
  const firstPage = await firstListWindow()
  for (let index = 0; index < 32; index++) await runtime.loadMore()
  assert.equal(runtime.list.getSnapshot().items.length, 1)
  await requireCollected(firstPage, 'previous Team list page or its rows remain strongly retained')
  const firstAction = await firstActionWindow()
  for (let index = 0; index < 32; index++) await runtime.loadMoreInbox()
  assert.equal(runtime.list.getSnapshot().pendingHumanActions!.length, 1)
  await requireCollected(firstAction, 'previous inbox action or its pending preview remains strongly retained')
  assert(first.participantId !== undefined)
  const route = await runtime.resolveCoordinatorSession(first.sessionId, { teamId: first.teamId, participantId: first.participantId })
  assert.equal(route?.teamId, first.teamId)
  process.stdout.write('released previous Team state and arrays; historical Session routing resolved on demand\n')
} finally {
  await ctx.fiber.dispose()
}
