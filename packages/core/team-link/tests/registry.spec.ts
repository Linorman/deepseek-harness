import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  channelPostIdempotencyKeySchema,
  activationBindingSnapshotSchema,
  channelIdSchema,
  channelReceiptRecordSchema,
  envelopeIdSchema,
  participantInterruptSnapshotSchema,
  taskAttemptIdSchema,
  teamEnvelopeSchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import TeamLinkRegistry, { TeamLinkError } from '../src/index.ts'
import type {
  TeamLink,
  TeamLinkBoundLinkBorrower,
  TeamLinkConnectRequest,
  TeamLinkEnrollmentProvider,
  TeamLinkProvider,
} from '../src/index.ts'

const channelId = channelIdSchema.parse('channel-link')
const envelopeId = envelopeIdSchema.parse('envelope-link')
const taskId = teamTaskIdSchema.parse('task-link')
const attemptId = taskAttemptIdSchema.parse('attempt-link')
const postIdempotencyKey = channelPostIdempotencyKeySchema.parse('post-link')
const binding = activationBindingSnapshotSchema.parse({
  activation: {
    id: 'activation-link',
    teamId: 'team-link',
    participantId: 'participant-link',
    status: 'running',
  },
  sessionId: 'session-link',
  provider: 'in-process',
})
const envelope = teamEnvelopeSchema.parse({
  id: envelopeId,
  teamId: binding.activation.teamId,
  channelId,
  sequence: 1,
  senderId: binding.activation.participantId,
  audience: null,
  kind: 'message',
  payload: { text: 'hello' },
  delivery: 'turn',
  priority: 'normal',
  createdAt: 1,
})
const receipt = channelReceiptRecordSchema.parse({
  type: 'channel/receipt',
  sequence: 2,
  createdAt: 2,
  participantId: binding.activation.participantId,
  envelopeId,
  cursor: 2,
})
const interrupt = participantInterruptSnapshotSchema.parse({
  id: 'interrupt-link',
  actorId: binding.activation.participantId,
  target: {
    teamId: binding.activation.teamId,
    participantId: binding.activation.participantId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
    provider: binding.provider,
  },
  requestedAt: 1,
})

function request(overrides: Partial<TeamLinkConnectRequest> = {}): TeamLinkConnectRequest {
  return {
    provider: 'local',
    binding,
    signal: new AbortController().signal,
    ...overrides,
  }
}

function link(overrides: Partial<TeamLink> = {}): TeamLink {
  return {
    provider: 'local',
    binding,
    done: new Promise<void>(() => {}),
    onNotify() { return () => {} },
    async getChannel() { throw new Error('This fixture does not read channel metadata') },
    onInvitation() { return () => {} },
    async acknowledgeChannelInvitation() { throw new Error('This fixture has no pending channel invitation') },
    onInterrupt() { return () => {} },
    onTaskCancellation() { return () => {} },
    async acknowledgeTaskCancellation() { throw new Error('not used') },
    async post() { return envelope },
    async postFinalResult() { return envelope },
    async claim() { return undefined },
    async claimTaskAttemptStart() { throw new Error('not used by Team Link registry tests') },
    async settleTaskAttempt() { throw new Error('not used by Team Link registry tests') },
    async integrateTask() { throw new Error('not used by Team Link registry tests') },
    async heartbeatTaskAttempt() { throw new Error('not used by Team Link registry tests') },
    async resolveTaskReview() { throw new Error('not used by Team Link registry tests') },
    async acknowledge() { return receipt },
    async acknowledgeInterrupt() { return interrupt },
    async close() {},
    ...overrides,
  }
}

function provider(overrides: Partial<TeamLinkProvider> = {}): TeamLinkProvider {
  return {
    name: 'local',
    async connect() { return link() },
    ...overrides,
  }
}

function enrollmentProvider(overrides: Partial<TeamLinkEnrollmentProvider> = {}): TeamLinkEnrollmentProvider {
  return {
    name: 'websocket',
    async reserve() {
      return {
        provider: 'websocket',
        endpoint: 'wss://team.example.test/team-link',
        capability: 'opaque-capability',
        async revoke() {},
      }
    },
    ...overrides,
  }
}

async function setup(): Promise<{ ctx: Context; fiber: Context['fiber'] }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(TeamLinkRegistry)
  return { ctx, fiber }
}

describe('TeamLinkRegistry service definition', () => {
  it('publishes provider replacement and contains a failing configuration observer', async () => {
    const ctx = new Context()
    await ctx.plugin(TeamLinkRegistry)
    const observed = vi.fn()
    ctx.on('team-link/provider-added', () => { throw new Error('broken observer') })
    ctx.on('team-link/provider-added', observed)
    const dispose = ctx.teamLinks.registerProvider(provider())
    expect(observed).toHaveBeenCalledWith({ name: 'local' })
    dispose()
    ctx.teamLinks.registerProvider(provider())
    expect(observed).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('registers effect-scoped providers and exposes only live provider identities', async () => {
    const { ctx, fiber } = await setup()
    const registered = provider()
    const dispose = ctx.teamLinks.registerProvider(registered)

    expect(ctx.teamLinks.getProvider('local')).toBe(registered)
    expect(ctx.teamLinks.listProviders()).toEqual([{ name: 'local' }])
    dispose()
    expect(ctx.teamLinks.getProvider('local')).toBeUndefined()
    expect(ctx.teamLinks.listProviders()).toEqual([])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('scopes an existing bound-Link borrower to its exact owner and removes it with the registration', async () => {
    const { ctx, fiber } = await setup()
    const owner = {}
    const otherOwner = {}
    const withLink = vi.fn()
    const borrower: TeamLinkBoundLinkBorrower = {
      async withLink<T>(operation: (current: TeamLink) => Promise<T>): Promise<T> {
        withLink(operation)
        return await operation(link())
      },
    }
    const dispose = ctx.teamLinks.registerBoundLinkBorrower(owner, borrower)

    expect(ctx.teamLinks.getBoundLinkBorrower(owner)).toBe(borrower)
    expect(ctx.teamLinks.getBoundLinkBorrower(otherOwner)).toBeUndefined()
    await expect(borrower.withLink(async current => current.binding)).resolves.toBe(binding)
    expect(withLink).toHaveBeenCalledTimes(1)
    expect(() => ctx.teamLinks.registerBoundLinkBorrower(owner, borrower)).toThrow(expect.objectContaining<Partial<TeamLinkError>>({
      code: 'TEAM_LINK_BOUND_LINK_BORROWER_DUPLICATE',
    }))
    dispose()
    expect(ctx.teamLinks.getBoundLinkBorrower(owner)).toBeUndefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('does not let a stale disposer remove a replacement provider', async () => {
    const { ctx, fiber } = await setup()
    const first = provider()
    const dispose = ctx.teamLinks.registerProvider(first)
    const replacement = provider()
    const internals = ctx.teamLinks as unknown as { providers: Map<string, TeamLinkProvider> }
    internals.providers.set('local', replacement)

    dispose()
    expect(ctx.teamLinks.getProvider('local')).toBe(replacement)
    internals.providers.clear()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects empty, surrounding-whitespace, and duplicate provider names before publication', async () => {
    const { ctx, fiber } = await setup()
    expect(() => ctx.teamLinks.registerProvider(provider({ name: '' }))).toThrow(expect.objectContaining<Partial<TeamLinkError>>({
      code: 'TEAM_LINK_PROVIDER_INVALID',
    }))
    expect(() => ctx.teamLinks.registerProvider(provider({ name: ' local ' }))).toThrow(expect.objectContaining<Partial<TeamLinkError>>({
      code: 'TEAM_LINK_PROVIDER_INVALID',
    }))
    ctx.teamLinks.registerProvider(provider())
    expect(() => ctx.teamLinks.registerProvider(provider())).toThrow(expect.objectContaining<Partial<TeamLinkError>>({
      code: 'TEAM_LINK_PROVIDER_DUPLICATE',
    }))
    expect(ctx.teamLinks.listProviders()).toEqual([{ name: 'local' }])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('issues credentials only through an effect-scoped enrollment provider', async () => {
    const { ctx, fiber } = await setup()
    const issuer = enrollmentProvider()
    const dispose = ctx.teamLinks.registerEnrollmentProvider(issuer)

    expect(ctx.teamLinks.getEnrollmentProvider('websocket')).toBe(issuer)
    expect(ctx.teamLinks.listEnrollmentProviders()).toEqual([{ name: 'websocket' }])
    await expect(ctx.teamLinks.reserveEnrollment({ provider: 'websocket', binding })).resolves.toMatchObject({
      provider: 'websocket', endpoint: 'wss://team.example.test/team-link',
    })
    dispose()
    await expect(ctx.teamLinks.reserveEnrollment({ provider: 'websocket', binding })).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_PROVIDER_NOT_FOUND',
    })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('announces enrollment issuer removal and replacement for active credential owners', async () => {
    const { ctx, fiber } = await setup()
    const events: string[] = []
    ctx.on('team-link/enrollment-provider-added', (provider) => { events.push(`added:${provider.name}`) })
    ctx.on('team-link/enrollment-provider-removed', (provider) => { events.push(`removed:${provider.name}`) })

    const first = ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider())
    first()
    const second = ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider())

    expect(events).toEqual(['added:websocket', 'removed:websocket', 'added:websocket'])
    second()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('contains enrollment issuer observer failures without retaining a removed issuer', async () => {
    const { ctx, fiber } = await setup()
    ctx.on('team-link/enrollment-provider-added', () => { throw new Error('added observer failed') })
    ctx.on('team-link/enrollment-provider-removed', () => { throw new Error('removed observer failed') })

    const dispose = ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider())
    expect(ctx.teamLinks.getEnrollmentProvider('websocket')).toBeDefined()
    dispose()
    expect(ctx.teamLinks.getEnrollmentProvider('websocket')).toBeUndefined()
    await Promise.resolve()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects invalid enrollment provider names and malformed issued credentials', async () => {
    const { ctx, fiber } = await setup()
    expect(() => ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider({ name: ' websocket ' }))).toThrow(expect.objectContaining<Partial<TeamLinkError>>({
      code: 'TEAM_LINK_ENROLLMENT_PROVIDER_INVALID',
    }))
    ctx.teamLinks.registerEnrollmentProvider(enrollmentProvider({
      async reserve() {
        return {
          provider: 'another',
          endpoint: '',
          capability: '',
          async revoke() {},
        }
      },
    }))
    await expect(ctx.teamLinks.reserveEnrollment({ provider: 'websocket', binding })).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_MISMATCH',
    })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('connects only through a registered provider and leaves published Link lifecycle errors observable', async () => {
    const { ctx, fiber } = await setup()
    await expect(ctx.teamLinks.connect(request())).rejects.toMatchObject({
      code: 'TEAM_LINK_PROVIDER_NOT_FOUND',
    })

    const lifecycleFailure = new Error('transport closed unexpectedly')
    const published = link({ close: async () => { throw lifecycleFailure } })
    const requested = request()
    const connect = vi.fn(async (received: TeamLinkConnectRequest) => {
      expect(received).toBe(requested)
      return published
    })
    ctx.teamLinks.registerProvider(provider({ connect }))

    const connected = await ctx.teamLinks.connect(requested)
    expect(connected).toBe(published)
    await expect(connected.post({
      expectedCursor: 1,
      idempotencyKey: postIdempotencyKey,
      draft: {
        channelId,
        audience: null,
        kind: 'message',
        payload: { text: 'hello' },
        delivery: 'turn',
      },
    })).resolves.toBe(envelope)
    await expect(connected.claim(channelId, envelopeId)).resolves.toBeUndefined()
    await expect(connected.claimTaskAttemptStart({
      taskId,
      attemptId,
      assignedRevision: 1,
      channelId,
      envelopeId,
    })).rejects.toThrow('not used by Team Link registry tests')
    await expect(connected.settleTaskAttempt({
      taskId,
      attemptId,
      expectedRevision: 1,
      outcome: { kind: 'released' },
    })).rejects.toThrow('not used by Team Link registry tests')
    await expect(connected.acknowledge(channelId, envelopeId, 1)).resolves.toBe(receipt)
    await expect(connected.acknowledgeInterrupt('delivery-link' as never, interrupt.id)).resolves.toBe(interrupt)
    await expect(connected.close()).rejects.toBe(lifecycleFailure)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('closes and rejects a returned Link with another provider name', async () => {
    const { ctx, fiber } = await setup()
    const close = vi.fn(async () => {})
    ctx.teamLinks.registerProvider(provider({
      async connect() { return link({ provider: 'websocket', close }) },
    }))

    await expect(ctx.teamLinks.connect(request())).rejects.toMatchObject({
      code: 'TEAM_LINK_CONNECTION_MISMATCH',
    })
    expect(close).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('closes a returned Link with another binding and preserves the mismatch when cleanup fails', async () => {
    const { ctx, fiber } = await setup()
    const close = vi.fn(async () => { throw Object.create(null) })
    ctx.teamLinks.registerProvider(provider({
      async connect() {
        return link({
          binding: activationBindingSnapshotSchema.parse({
            ...binding,
            sessionId: 'other-session',
          }),
          close,
        })
      },
    }))

    await expect(ctx.teamLinks.connect(request())).rejects.toMatchObject({
      code: 'TEAM_LINK_CONNECTION_MISMATCH',
    })
    expect(close).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('treats activation residency status as mutable Link state rather than connection identity', async () => {
    const { ctx, fiber } = await setup()
    const requested = request({
      binding: activationBindingSnapshotSchema.parse({
        ...binding,
        activation: { ...binding.activation, status: 'idle' },
      }),
    })
    const published = link({
      binding: activationBindingSnapshotSchema.parse({
        ...binding,
        activation: { ...binding.activation, status: 'running' },
      }),
    })
    ctx.teamLinks.registerProvider(provider({ async connect() { return published } }))

    await expect(ctx.teamLinks.connect(requested)).resolves.toBe(published)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('propagates a provider connection failure without inventing a Link to close', async () => {
    const { ctx, fiber } = await setup()
    const failure = new Error('dial failed')
    ctx.teamLinks.registerProvider(provider({
      async connect() { throw failure },
    }))

    await expect(ctx.teamLinks.connect(request())).rejects.toBe(failure)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
