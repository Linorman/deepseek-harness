/**
 * SessionManager orchestration: lazy resident instances, list lifecycle, host
 * frame routing, and the pending-frame buffer for uninstantiated sessions.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@clocky/clocky-api-remotes/client'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { FakeApiClient, deferred, err, fakeRemote, ok } from './fake-api.client.ts'
import { entries, ev, plainTurn } from './event-script.client.ts'

const S1 = 'fk-m1' as SessionId
const S2 = 'fk-m2' as SessionId

type SummaryOver = Partial<{
  updatedAt: number
  running: boolean
  blank: boolean
}>

function summary(sessionId: SessionId, over: SummaryOver = {}) {
  return { sessionId, updatedAt: 100, running: false, blank: false, ...over }
}

describe('instances', () => {
  it('lazily builds one resident instance per id and syncs the running bit from the list', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1, { running: true })] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    const session = manager.get(S1)
    expect(manager.get(S1)).toBe(session) // resident: same instance forever
    expect(session.getSnapshot().running).toBe(true) // list preceded instantiation
  })

  it('replays buffered approval frames on instantiation and drops ordinary frames for uninstantiated sessions', () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    // Uninstantiated: approval buffers, plain session/event drops.
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    manager.handleMuxEnvelope({ rpcId: 're' as never, payload: { type: 'session/event', sessionId: S1, event: plainTurn(0, 0, 'x', 'y')[0] as never } })
    const session = manager.get(S1)
    expect(session.getSnapshot().pending).toMatchObject([{ kind: 'approval', payload: { approvalId: 'ap1' } }])
    // Buffer cleared: a second instantiation of another id gets nothing.
    expect(manager.get(S2).getSnapshot().pending).toEqual([])
  })

  it('retains every live answerable request and compacts resolutions before instantiation', () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    for (let i = 0; i < 40; i++) {
      manager.handleMuxEnvelope({ rpcId: `q${i}` as never, payload: { type: 'question/requested', sessionId: S1, questions: [] } })
    }
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('question')
    for (let i = 0; i < 40; i++) {
      manager.handleMuxEnvelope({
        rpcId: `r${i}` as never,
        payload: { type: 'question/resolved', sessionId: S1, questionRpcId: `q${i}` as never, outcome: 'answered' },
      })
    }
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()
    expect(manager.get(S1).getSnapshot().pending).toEqual([])
  })

  it('drops buffered answerable requests on session removal', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    // Removed session: buffered frames must not replay on a future instantiation.
    manager.handleMuxEnvelope({ rpcId: 'qz' as never, payload: { type: 'question/requested', sessionId: S2, questions: [] } })
    manager.handleHostEnvelope({ rpcId: 'hz' as never, payload: { type: 'host/session-removed', sessionId: S2 } })
    expect(manager.get(S2).getSnapshot().pending).toEqual([])
  })
})

describe('list lifecycle', () => {
  it('single-flights refreshList and preserves the Host baseline order', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onList']>>>()
    api.onList = () => gate.promise
    const manager = new SessionManager(api, fakeRemote())
    const first = manager.refreshList()
    const second = manager.refreshList()
    expect(manager.getListSnapshot().state).toBe('loading')
    gate.resolve(ok({ items: [summary(S2, { updatedAt: 200 }), summary(S1)] as never[] }))
    await Promise.all([first, second])
    expect(api.callsOf('session.list')).toHaveLength(1)
    const snapshot = manager.getListSnapshot()
    expect(snapshot.state).toBe('idle')
    expect(snapshot.items.map(i => i.sessionId)).toEqual([S2, S1])
  })

  it('replays incremental frames over hydration and never batch-reorders established ids', async () => {
    const api = new FakeApiClient()
    const first = deferred<Awaited<ReturnType<FakeApiClient['onList']>>>()
    api.onList = () => first.promise
    const manager = new SessionManager(api, fakeRemote())
    const hydration = manager.refreshList()
    manager.handleHostEnvelope({
      rpcId: 'during-first' as never,
      payload: { type: 'host/session-added', blank: true, sessionId: S2 },
    })
    first.resolve(ok({ items: [summary(S1)] as never[] }))
    await hydration
    expect(manager.getListSnapshot().items.map(item => item.sessionId)).toEqual([S2, S1])

    api.onList = () => Promise.resolve(ok({
      items: [summary(S1, { updatedAt: 900 }), summary(S2, { updatedAt: 800 })] as never[],
    }))
    await manager.refreshList()
    expect(manager.getListSnapshot().items.map(item => item.sessionId)).toEqual([S2, S1])
  })

  it('advances list activity only for direct user messages', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1)] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()

    // Both a new prompt and an admitted steer land as a user-sourced message.
    const activity = { ...ev.user(10, 'new'), time: 500 }
    manager.handleMuxEnvelope({
      rpcId: 'activity' as never,
      payload: { type: 'session/event', sessionId: S1, event: activity },
    })
    expect(manager.getListSnapshot().items[0]?.updatedAt).toBe(500)

    manager.handleMuxEnvelope({
      rpcId: 'older' as never,
      payload: { type: 'session/event', sessionId: S1, event: { ...activity, time: 400 } },
    })
    manager.handleMuxEnvelope({
      rpcId: 'assistant' as never,
      payload: { type: 'session/event', sessionId: S1, event: { ...ev.assistant(11, 0, 'reply'), time: 600 } },
    })

    const injected = ev.user(12, 'context')
    if (injected.type !== 'user/message') throw new Error('user builder returned another event type')
    manager.handleMuxEnvelope({
      rpcId: 'injected' as never,
      payload: {
        type: 'session/event',
        sessionId: S1,
        event: {
          ...injected,
          time: 700,
          data: { ...injected.data, source: { kind: 'plugin', plugin: 'test' } },
        },
      },
    })
    expect(manager.getListSnapshot().items[0]?.updatedAt).toBe(500)
  })

  it('keeps the error in the list snapshot on failure', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(err({ code: 'internal', message: 'boom', details: {} }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    expect(manager.getListSnapshot()).toMatchObject({ state: 'error', error: { code: 'internal' } })
    // A failed pull does not step the arrival phase: still pending.
    expect(manager.getListSnapshot().phase).toBe('pending')
  })

  it('phase steps pending → ready on the first successful pull and never returns', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    expect(manager.getListSnapshot().phase).toBe('pending')
    await manager.refreshList()
    expect(manager.getListSnapshot().phase).toBe('ready')
    // Sticky across later failures: the pull-activity axis reports the error,
    // the arrival phase holds.
    api.onList = () => Promise.resolve(err({ code: 'internal', message: 'down', details: {} }))
    await manager.refreshList()
    expect(manager.getListSnapshot()).toMatchObject({ state: 'error', phase: 'ready' })
    // And across an empty re-pull (empty-with-ready = truly no sessions).
    api.onList = () => Promise.resolve(ok({ items: [] as never[] }))
    await manager.refreshList()
    expect(manager.getListSnapshot()).toMatchObject({ state: 'idle', phase: 'ready' })
    expect(manager.getListSnapshot().items).toEqual([])
  })

  it('retains title projections before list arrival, keeps last-wins by seq, and clears them on removal', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    const titleFrame = (rpcId: string, title: string, seq: number) => {
      manager.handleMuxEnvelope({
        rpcId: rpcId as never,
        payload: { type: 'session/projection', sessionId: S1, key: 'title', value: title, seq } as never,
      })
    }
    titleFrame('title-new', 'Newest', 4)
    titleFrame('title-stale', 'Stale', 3)
    titleFrame('title-equal', 'Equal', 4)
    api.onList = () => Promise.resolve(ok({
      items: [summary(S1), summary(S2, { updatedAt: 200 })] as never[],
    }))
    await manager.refreshList()

    const titled = manager.getListSnapshot()
    expect(titled.items.map(item => item.sessionId)).toEqual([S1, S2])
    expect(titled.items[0]?.title).toBe('Newest')
    expect(titled.items[1]?.title).toBeUndefined()

    manager.handleHostEnvelope({ rpcId: 'removed' as never, payload: { type: 'host/session-removed', sessionId: S1 } })
    manager.handleHostEnvelope({ rpcId: 'readded' as never, payload: { type: 'host/session-added', blank: true, sessionId: S1 } })
    expect(manager.getListSnapshot().items.find(item => item.sessionId === S1)?.title).toBeUndefined()
  })

  it('seeds cold titles from the list rows\' projections block under higher-seq-wins', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    // A push frame landed before the list (S2's title is newer than the block's cut).
    manager.handleMuxEnvelope({
      rpcId: 'push-newer' as never,
      payload: { type: 'session/projection', sessionId: S2, key: 'title', value: 'Pushed', seq: 9 } as never,
    })
    api.onList = () => Promise.resolve(ok({
      items: [
        { ...summary(S1), projections: { asOfSeq: 4, values: { title: 'Cold cached' } } },
        { ...summary(S2, { updatedAt: 200 }), projections: { asOfSeq: 5, values: { title: 'List stale' } } },
      ] as never[],
    }))
    await manager.refreshList()
    const items = manager.getListSnapshot().items
    // Cold row: title surfaces straight from the list block — no open, no history.
    expect(items.find(item => item.sessionId === S1)?.title).toBe('Cold cached')
    // The stale list block (seq 5) cannot overwrite the newer push frame (seq 9).
    expect(items.find(item => item.sessionId === S2)?.title).toBe('Pushed')
  })

  it('drops a projection row beyond the subscription baseline before accepting its durable replay', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1)] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    const frame = (rpcId: string, payload: object) => {
      manager.handleMuxEnvelope({ rpcId: rpcId as never, payload: payload as never })
    }
    frame('title-unflushed', { type: 'session/projection', sessionId: S1, key: 'title', value: 'Unflushed', seq: 4 })

    // The durable baseline says the host only knows up to seq 2: the phantom
    // row rode lost state and must drop, or last-wins pins it forever.
    frame('subscribed-recovered', { type: 'session/subscribed', sessionId: S1, lastSeq: 2 })
    expect(manager.getListSnapshot().items[0]?.title).toBeUndefined()

    frame('title-durable', { type: 'session/projection', sessionId: S1, key: 'title', value: 'Durable', seq: 2 })
    expect(manager.getListSnapshot().items[0]?.title).toBe('Durable')

    // A baseline at or past the row's seq keeps it (nothing phantom to drop).
    frame('subscribed-current', { type: 'session/subscribed', sessionId: S1, lastSeq: 2 })
    expect(manager.getListSnapshot().items[0]?.title).toBe('Durable')
  })
})

describe('search', () => {
  it('returns bounded Host results and forwards the caller signal', async () => {
    const api = new FakeApiClient()
    api.onSearch = () => Promise.resolve(ok({
      items: [{ sessionId: S1, snippet: 'matching excerpt' }],
      hasMore: true,
    }))
    const manager = new SessionManager(api, fakeRemote())
    const signal = new AbortController().signal

    await expect(manager.search('exact phrase', signal)).resolves.toEqual({
      ok: true,
      value: {
        items: [{ sessionId: S1, snippet: 'matching excerpt' }],
        hasMore: true,
      },
    })
    expect(api.callsOf('session.search')).toEqual([{ query: 'exact phrase' }])
    expect(api.lastSearchSignal).toBe(signal)
  })

  it('preserves business errors and folds transport failures', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    api.onSearch = () => Promise.resolve(err({
      code: 'internal',
      message: 'index unavailable',
      details: {},
    }))
    const signal = new AbortController().signal
    await expect(manager.search('first', signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'index unavailable' },
    })

    api.onSearch = () => Promise.reject(new Error('wire down'))
    await expect(manager.search('second', signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'wire down' },
    })
  })
})

describe('host frame routing', () => {
  it('adds/removes/flips sessions from host frames and keeps removed instances resident', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', blank: true, sessionId: S1 } })
    manager.handleHostEnvelope({ rpcId: 'h2' as never, payload: { type: 'host/session-added', blank: true, sessionId: S1 } }) // dup: ignored
    expect(manager.getListSnapshot().items).toHaveLength(1)

    const session = manager.get(S1)
    manager.handleHostEnvelope({ rpcId: 'h3' as never, payload: { type: 'host/session-status', sessionId: S1, running: true } })
    expect(session.getSnapshot().running).toBe(true)
    expect(manager.getListSnapshot().items[0]?.running).toBe(true)

    manager.handleHostEnvelope({ rpcId: 'h4' as never, payload: { type: 'host/agent-error', sessionId: S1, message: '炸了' } })
    expect(session.getSnapshot().lastAgentError).toBe('炸了')

    manager.handleHostEnvelope({ rpcId: 'h5' as never, payload: { type: 'host/session-removed', sessionId: S1 } })
    expect(manager.getListSnapshot().items).toHaveLength(0)
    expect(session.getSnapshot().removed).toBe(true)
    expect(manager.get(S1)).toBe(session) // resident-instance rule survives removal
  })
})

describe('remaining branches', () => {
  it('refreshList folds a transport throw into the error state', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.reject(new Error('list wire down'))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    expect(manager.getListSnapshot()).toMatchObject({ state: 'error', error: { code: 'internal', message: 'list wire down' } })
  })

  it('refreshList pushes running bits down to already-instantiated sessions', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    const session = manager.get(S1)
    api.onList = () => Promise.resolve(ok({ items: [summary(S1, { running: true })] as never[] }))
    await manager.refreshList()
    expect(session.getSnapshot().running).toBe(true)
  })

  it('subscribe notifies on list changes and stops after unsubscribe', async () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    let notified = 0
    const unsubscribe = manager.subscribe(() => { notified++ })
    await manager.refreshList()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notified).toBeGreaterThan(0)
    const seen = notified
    unsubscribe()
    manager.handleHostEnvelope({ rpcId: 'h' as never, payload: { type: 'host/session-added', blank: true, sessionId: S1 } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(notified).toBe(seen)
  })

  it('routes stream/error and unknown frames to the documented drops, and dispatches to instantiated sessions', () => {
    const api = new FakeApiClient()
    const manager = new SessionManager(api, fakeRemote())
    manager.handleMuxEnvelope({ rpcId: 'e' as never, payload: { type: 'stream/error', error: { code: 'internal', message: 'x', details: {} } } })
    manager.handleHostEnvelope({ rpcId: 'e2' as never, payload: { type: 'stream/error', error: { code: 'internal', message: 'x', details: {} } } })
    manager.handleHostEnvelope({ rpcId: 'e3' as never, payload: { type: 'future/host-frame' } as never })
    const session = manager.get(S1)
    manager.handleMuxEnvelope({ rpcId: 'q1' as never, payload: { type: 'question/requested', sessionId: S1, questions: [] } })
    expect(session.getSnapshot().pending).toMatchObject([{ kind: 'question' }])
    // status flip for an unknown session only touches summaries (no crash).
    manager.handleHostEnvelope({ rpcId: 'h9' as never, payload: { type: 'host/session-status', sessionId: S2, running: true } })
    manager.handleHostEnvelope({ rpcId: 'ha' as never, payload: { type: 'host/agent-error', sessionId: S2, message: '无实例' } })
  })

  it('keeps list-entry identity for unchanged rows across an unrelated list change', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200 })] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    const before = manager.getListSnapshot()
    manager.handleHostEnvelope({ rpcId: 'h' as never, payload: { type: 'host/session-status', sessionId: S2, running: true } })
    const after = manager.getListSnapshot()
    expect(after.items).not.toBe(before.items)
    const beforeS1 = before.items.find(e => e.sessionId === S1)
    const afterS1 = after.items.find(e => e.sessionId === S1)
    expect(afterS1).toBe(beforeS1) // untouched entry keeps identity (entryCache)
    // Same-order same-entries snapshot reuses the items array.
    manager.handleHostEnvelope({ rpcId: 'h2' as never, payload: { type: 'host/agent-error', sessionId: S1, message: 'x' } })
    expect(manager.getListSnapshot().items).toBe(after.items)
  })

})

describe('connected generation', () => {
  it('refreshes the list and resyncs only opened instances', async () => {
    const api = new FakeApiClient()
    api.onHistory = () => Promise.resolve(ok({
      events: entries(plainTurn(0, 0, 'a', 'b')) as never[],
      hasMore: false,
      modelSelection: { provider: 'test-provider', model: 'test-model' },
    }))
    const manager = new SessionManager(api, fakeRemote())
    const openedSession = manager.get(S1)
    await openedSession.open()
    manager.get(S2) // instantiated but never opened
    const historyCallsBefore = api.callsOf('session.history').length
    manager.handleConnected()
    await vi.waitFor(() => {
      expect(api.callsOf('session.list').length).toBe(1)
      // Only the opened instance repulls history; the cold one stays silent.
      expect(api.callsOf('session.history').length).toBe(historyCallsBefore + 1)
    })
  })

})

describe('pending-interaction list status', () => {
  it('tracks approval requests through replay and resolution without instantiation', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
    // Mux-open replay of the same question (same approvalId) is idempotent.
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
    manager.handleMuxEnvelope({ rpcId: 'rx' as never, payload: { type: 'approval/resolved', sessionId: S1, approvalId: 'ap1' as never, outcome: 'allowed-once' as never } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()
  })

  it('classifies ordinary questions and renderable plan reviews, then clears by question rpcId', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    manager.handleMuxEnvelope({
      rpcId: 'q1' as never,
      payload: { type: 'question/requested', sessionId: S1, questions: [{ id: 'name', question: 'Name?' }] },
    })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('question')
    manager.handleMuxEnvelope({ rpcId: 'qx' as never, payload: { type: 'question/resolved', sessionId: S1, questionRpcId: 'q1' as never, outcome: 'answered' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()

    manager.handleMuxEnvelope({
      rpcId: 'q2' as never,
      payload: {
        type: 'question/requested',
        sessionId: S1,
        questions: [{
          id: 'plan', question: 'Approve?', detail: '# Plan',
          options: [{ label: 'Approve' }, { label: 'Refuse' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
        }],
      },
    })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('plan-review')
    manager.handleMuxEnvelope({ rpcId: 'qy' as never, payload: { type: 'question/resolved', sessionId: S1, questionRpcId: 'q2' as never, outcome: 'cancelled' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()
  })

  it.each([
    ['missing detail', {}],
    ['multi-select', { detail: '# Plan', multiSelect: true }],
    ['more than two options', { detail: '# Plan', options: [{ label: 'Approve' }, { label: 'Refuse' }, { label: 'Revise' }] }],
    ['missing approve option', { detail: '# Plan', options: [{ label: 'Refuse' }] }],
  ])('keeps an unrenderable %s plan intent on the ordinary question flow', (_name, over) => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    manager.handleMuxEnvelope({
      rpcId: 'q-plan' as never,
      payload: {
        type: 'question/requested', sessionId: S1,
        questions: [{
          id: 'plan', question: 'Approve?', options: [{ label: 'Approve' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
          ...over,
        }],
      },
    })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('question')
  })

  it('the first question outranks sibling approvals and resolving it reveals the remaining wait', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    manager.handleMuxEnvelope({ rpcId: 'r1' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'a1' as never, toolName: 'rm' } })
    manager.handleMuxEnvelope({
      rpcId: 'q1' as never,
      payload: { type: 'question/requested', sessionId: S1, questions: [{ id: 'name', question: 'Name?' }] },
    })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('question')
    manager.handleMuxEnvelope({ rpcId: 'qy' as never, payload: { type: 'question/resolved', sessionId: S1, questionRpcId: 'q1' as never, outcome: 'answered' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
    manager.handleMuxEnvelope({ rpcId: 'rx' as never, payload: { type: 'approval/resolved', sessionId: S1, approvalId: 'a1' as never, outcome: 'rejected' as never } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()

    manager.handleMuxEnvelope({ rpcId: 'r2' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'a2' as never, toolName: 'rm' } })
    manager.handleHostEnvelope({ rpcId: 'h2' as never, payload: { type: 'host/session-removed', sessionId: S1 } })
    expect(manager.getListSnapshot().items).toHaveLength(0)
  })

  it('drops stale status at generation death before replay re-adds live interactions', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
    // Generation death clears (resolved-while-disconnected questions send no frame)…
    manager.handleDisconnected()
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBeUndefined()
    // …and a replayed frame arriving before onConnected (stream open precedes
    // the readiness handshake) survives the later handleConnected untouched.
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    manager.handleConnected()
    expect(manager.getListSnapshot().items[0]?.pendingInteraction).toBe('approval')
  })

  it('generation death drops buffered answerable frames (a dead generation cannot be answered)', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'h1' as never, payload: { type: 'host/session-added', sessionId: S1, blank: false } })
    // Buffered pre-instantiation: an approval pair and a queued row.
    manager.handleMuxEnvelope({ rpcId: 'ra' as never, payload: { type: 'approval/requested', sessionId: S1, approvalId: 'ap1' as never, toolName: 'rm' } })
    manager.handleMuxEnvelope({ rpcId: 'q1' as never, payload: { type: 'question/requested', sessionId: S1, questions: [] } })
    manager.handleDisconnected()
    // Instantiate after the death sweep: no zombie interaction replays (the
    // pendingBuffers held only dead-generation rpcIds), so the session mints
    // no pending waits.
    const session = manager.get(S1)
    expect(session.getSnapshot().pending).toEqual([])
  })
})

describe('completed reminder', () => {
  const status = (rpcId: string, sessionId: SessionId, running: boolean) => ({
    rpcId: rpcId as never,
    payload: { type: 'host/session-status' as const, sessionId, running },
  })
  const added = (rpcId: string, sessionId: SessionId) => ({
    rpcId: rpcId as never,
    payload: { type: 'host/session-added' as const, sessionId, blank: false },
  })
  const entry = (manager: SessionManager, sessionId: SessionId) =>
    manager.getListSnapshot().items.find(item => item.sessionId === sessionId)

  it('arms on a running→idle flip of a non-selected session and clears on select', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope(added('h1', S1))
    manager.handleHostEnvelope(added('h2', S2))
    manager.select(S1)
    expect(entry(manager, S2)?.completed).toBe(false)
    manager.handleHostEnvelope(status('s1', S2, true))
    manager.handleHostEnvelope(status('s2', S2, false))
    expect(entry(manager, S2)?.completed).toBe(true)
    // Opening the session consumes the reminder.
    manager.select(S2)
    expect(entry(manager, S2)?.completed).toBe(false)
  })

  it('never arms for the session being watched and re-arms after a switch-away re-run', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope(added('h1', S1))
    manager.handleHostEnvelope(added('h2', S2))
    manager.select(S2)
    manager.handleHostEnvelope(status('s1', S2, true))
    manager.handleHostEnvelope(status('s2', S2, false))
    expect(entry(manager, S2)?.completed).toBe(false) // watched to completion: no reminder
    // Switch away; a fresh run completing again arms the reminder.
    manager.select(S1)
    manager.handleHostEnvelope(status('s3', S2, true))
    manager.handleHostEnvelope(status('s4', S2, false))
    expect(entry(manager, S2)?.completed).toBe(true)
  })

  it('a re-run disarms the reminder while running and re-arms on its completion', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope(added('h1', S1))
    manager.handleHostEnvelope(added('h2', S2))
    manager.select(S1)
    manager.handleHostEnvelope(status('s1', S2, true))
    manager.handleHostEnvelope(status('s2', S2, false))
    expect(entry(manager, S2)?.completed).toBe(true)
    // The user starts a new run without opening the session: running wins.
    manager.handleHostEnvelope(status('s3', S2, true))
    expect(entry(manager, S2)?.completed).toBe(false)
    manager.handleHostEnvelope(status('s4', S2, false))
    expect(entry(manager, S2)?.completed).toBe(true)
  })

  it('session-removed drops the reminder and a re-add starts clean', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope(added('h1', S1))
    manager.handleHostEnvelope(added('h2', S2))
    manager.select(S1)
    manager.handleHostEnvelope(status('s1', S2, true))
    manager.handleHostEnvelope(status('s2', S2, false))
    expect(entry(manager, S2)?.completed).toBe(true)
    manager.handleHostEnvelope({ rpcId: 'rm' as never, payload: { type: 'host/session-removed', sessionId: S2 } })
    expect(manager.getListSnapshot().items.find(item => item.sessionId === S2)).toBeUndefined()
    manager.handleHostEnvelope(added('h3', S2))
    expect(entry(manager, S2)?.completed).toBe(false)
  })

  it('a list refresh carrying the running→idle transition arms the reminder', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200, running: true })] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    manager.select(S1)
    expect(entry(manager, S2)?.completed).toBe(false)
    api.onList = () => Promise.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200, running: false })] as never[] }))
    await manager.refreshList()
    expect(entry(manager, S2)?.completed).toBe(true)
  })

  it('never arms for sessions already idle at first observation', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200 })] as never[] }))
    const manager = new SessionManager(api, fakeRemote())
    await manager.refreshList()
    manager.select(S1)
    expect(entry(manager, S2)?.completed).toBe(false)
    api.onList = () => Promise.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 201 })] as never[] }))
    await manager.refreshList()
    expect(entry(manager, S2)?.completed).toBe(false)
  })

  it('arms a completion that happened during an in-flight first pull (baseline running, replayed idle)', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onList']>>>()
    api.onList = () => gate.promise
    const manager = new SessionManager(api, fakeRemote())
    const refresh = manager.refreshList()
    // The session finishes while the first pull is still in flight; the pull
    // response recorded it as running at pull time.
    manager.handleHostEnvelope(status('s-mid', S2, false))
    gate.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200, running: true })] as never[] }))
    await refresh
    expect(entry(manager, S2)?.completed).toBe(true)
  })

  it('arms when a session ran and completed entirely between in-flight mutations (baseline idle)', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onList']>>>()
    api.onList = () => gate.promise
    const manager = new SessionManager(api, fakeRemote())
    const refresh = manager.refreshList()
    // The unknown session starts and finishes while the first pull is in
    // flight; the pull-time baseline recorded it idle, so the running→idle
    // edge lives entirely inside the replayed mutations.
    manager.handleHostEnvelope(status('s-start', S2, true))
    manager.handleHostEnvelope(status('s-finish', S2, false))
    gate.resolve(ok({ items: [summary(S1), summary(S2, { updatedAt: 200 })] as never[] }))
    await refresh
    expect(entry(manager, S2)?.completed).toBe(true)
  })
})

describe('background-job mirror', () => {
  const view = (over: Partial<{ id: string; status: string; label: string }> = {}) => ({
    id: 'bash-1', kind: 'bash', label: 'pnpm run build', status: 'running', startedAt: 5, ...over,
  })
  const tasksFrame = (sessionId: SessionId, jobs: unknown[]) =>
    ({ rpcId: 't' as never, payload: { type: 'session/jobs', sessionId, jobs } as never })

  it('mirrors the whole set last-wins, keyed per session, with no Session instance needed', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleMuxEnvelope(tasksFrame(S1, [view()]))
    manager.handleMuxEnvelope(tasksFrame(S2, [view({ id: 'pwsh-1', label: 'other' })]))
    const first = manager.getListSnapshot().jobsBySession
    expect(first[S1]).toEqual([view()])
    expect(first[S2]?.[0]?.label).toBe('other')

    // Last-wins: the newer whole set replaces, it does not merge.
    manager.handleMuxEnvelope(tasksFrame(S1, [view({ status: 'completed' })]))
    expect(manager.getListSnapshot().jobsBySession[S1]).toEqual([view({ status: 'completed' })])
  })

  it('stores an emptied set as an absent key so absence and [] read alike', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleMuxEnvelope(tasksFrame(S1, [view()]))
    expect(S1 in manager.getListSnapshot().jobsBySession).toBe(true)
    manager.handleMuxEnvelope(tasksFrame(S1, []))
    expect(S1 in manager.getListSnapshot().jobsBySession).toBe(false)
  })

  it('clears the mirror on re-subscribe, because a task-free generation sends no baseline', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleMuxEnvelope(tasksFrame(S1, [view()]))
    manager.handleMuxEnvelope({
      rpcId: 's' as never,
      payload: { type: 'session/subscribed', sessionId: S1, lastSeq: 3 },
    })
    expect(S1 in manager.getListSnapshot().jobsBySession).toBe(false)
  })

  it('drops the rows when the session is removed, whichever stream lands first', () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    manager.handleHostEnvelope({ rpcId: 'a' as never, payload: { type: 'host/session-added', blank: true, sessionId: S1 } })
    manager.handleMuxEnvelope(tasksFrame(S1, [view()]))
    manager.handleHostEnvelope({ rpcId: 'r' as never, payload: { type: 'host/session-removed', sessionId: S1 } })
    expect(S1 in manager.getListSnapshot().jobsBySession).toBe(false)
  })

  it('notifies list subscribers so an open header re-renders without a poll', async () => {
    const manager = new SessionManager(new FakeApiClient(), fakeRemote())
    const seen = vi.fn()
    manager.subscribe(seen)
    manager.handleMuxEnvelope(tasksFrame(S1, [view()]))
    // The notifier batches on a microtask; the frame itself is already applied.
    await Promise.resolve()
    expect(seen).toHaveBeenCalled()
  })
})
