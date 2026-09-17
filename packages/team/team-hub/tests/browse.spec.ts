/** Summary pages bound response bytes independently of task, grant and workflow bodies. */
import { describe, expect, it, vi } from 'vitest'
import { teamBrowsePageSchema, teamBrowseRequestSchema, teamWorkflowPlanSnapshotSchema } from '@clocky/clocky-team'
import { projectTeamBrowse } from '@clocky/clocky-team/selection'
import { teamProjectionFromData } from '../src/fold.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, settledAttempt, task, taskChanged,
  taskCreatorActivationId, taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function source() { return teamProjectionFromData(checkpointFor([createdTeam()])) }
function workflow() {
  return teamWorkflowPlanSnapshotSchema.parse({ id: 'browse-workflow', teamId, revision: 1, phase: 'compiling', taskBindings: [],
    idempotencyKey: 'browse-plan', actor: { teamId, participantId: taskCreatorId, activationId: taskCreatorActivationId,
      sessionId: taskCreatorSessionId, provider: 'in-process' }, plan: { version: 1, name: 'Workflow', tasks: [{
      id: 'review', subject: 'Review', description: 'Private instructions', blockedBy: [], requiredCapabilities: [],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    }], bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
    channel: { participantRoles: ['coordinator', 'human'], viewPolicy: { type: 'directed', version: 1 },
      graph: { initial: { kind: 'participant', role: 'coordinator' }, transitions: [], maxTurns: 1 } },
    result: { kind: 'task-results', taskTemplateIds: ['review'] } } })
}

describe('Team browse summaries', () => {
  it('identifies the assigned reviewer without including its review history', () => {
    const projection = source()
    const reviewer = participant({ id: 'summary-reviewer', role: 'reviewer' })
    const value = task({ reviewPolicy: { kind: 'participant', reviewerId: reviewer.id } })
    projection.tasks.set(value.id, value)
    const result = projectTeamBrowse(projection, { teamId, kind: 'tasks', afterCursor: -1, limit: 1 }, 512, 16384)
    expect(result).toMatchObject({ ok: true, value: { items: [{ reviewerId: reviewer.id }] } })
    expect(result).not.toHaveProperty('value.items.0.reviewHistory')
  })

  it('does not read instructions or settled outcomes when listing a long task history', () => {
    const projection = source()
    const history = Array.from({ length: 1000 }, (_, index) => settledAttempt({ id: `attempt-${index}`, ordinal: index + 1,
      assignedAt: 20 + index * 10, leaseExpiresAt: 30 + index * 10, settledAt: 25 + index * 10 }))
    const row = task({ subject: '甲😀'.repeat(1000), description: 'private body '.repeat(10000),
      attemptCount: history.length, maxAttempts: history.length + 1, attemptHistory: history })
    let bodyReads = 0
    const description = row.description
    Object.defineProperty(row, 'description', { get: () => { bodyReads++; return description } })
    for (const attempt of row.attemptHistory) {
      const outcome = attempt.outcome
      Object.defineProperty(attempt, 'outcome', { get: () => { bodyReads++; return outcome } })
    }
    projection.tasks.set(row.id, row)
    const result = projectTeamBrowse(projection, { teamId, kind: 'tasks', afterCursor: -1, limit: 64 }, 64, 1024)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.value).toMatchObject({ kind: 'tasks', total: 1, scanned: 1, items: [{ id: row.id,
      subject: { text: '甲😀'.repeat(9), truncated: true }, attemptCount: 1000, ownerId: history.at(-1)!.participantId }] })
    expect(bodyReads).toBe(0)
    expect(JSON.stringify(result.value)).not.toContain('attemptHistory')
    expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(1024)
    expect(teamBrowsePageSchema.parse(result.value)).toEqual(result.value)
  })

  it('keeps protocol roles exact and never reads member history or grants', () => {
    const projection = source()
    const role = 'worker-'.repeat(90)
    const member = participant({ role, displayName: 'Display name'.repeat(100) })
    Object.defineProperties(member, {
      stats: { enumerable: true, get: () => { throw new Error('Member history was inspected') } },
      authorityGrant: { enumerable: true, get: () => { throw new Error('Member grant was inspected') } },
    })
    projection.participants.set(member.id, member)
    const request = { teamId, kind: 'members' as const, afterCursor: -1, limit: 1 }
    const result = projectTeamBrowse(projection, request, 8, 1024)
    expect(result).toMatchObject({ ok: true, value: { items: [{ role, displayName: { truncated: true } }] } })
    if (!result.ok) throw new Error('Member role did not fit')
    expect(teamBrowsePageSchema.parse(result.value)).toEqual(result.value)
    expect(result.value.items[0]).not.toHaveProperty('stats')
    expect(result.value.items[0]).not.toHaveProperty('authorityGrant')
    projection.participants.set(member.id, participant({ role: 'x'.repeat(2048) }))
    expect(projectTeamBrowse(projection, request, 8, 1024)).toEqual({ ok: false, reason: 'row' })
  })

  it('continues before the first row that exceeds the byte budget, without skipping or duplicating members', () => {
    const projection = source()
    for (let index = 0; index < 20; index++) {
      const member = participant({ id: `member-${index}`, displayName: '😀'.repeat(500), capabilities: ['read', 'write'] })
      projection.participants.set(member.id, member)
    }
    const ids: string[] = []
    let afterCursor = -1
    for (let page = 0; page < 21; page++) {
      const result = projectTeamBrowse(projection, { teamId, kind: 'members', afterCursor, limit: 5 }, 128, 900)
      if (!result.ok) throw new Error(result.reason)
      expect(result.value.items.length).toBeLessThan(5)
      expect(result.value.items.length).toBeGreaterThan(0)
      expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(900)
      expect(teamBrowsePageSchema.parse(result.value)).toEqual(result.value)
      ids.push(...result.value.items.map(item => item.id))
      if (result.value.nextCursor === undefined) break
      expect(result.value.nextCursor).toBeGreaterThan(afterCursor)
      afterCursor = result.value.nextCursor
    }
    expect(ids).toEqual([...projection.participants.keys()])
    expect(projectTeamBrowse(projection, { teamId, kind: 'members', afterCursor: 19, limit: 5 }, 128, 900))
      .toMatchObject({ ok: true, value: { items: [], scanned: 0, total: 20 } })
  })

  it('encodes each admitted row once instead of repeatedly encoding the growing page', () => {
    const projection = source()
    for (let index = 0; index < 64; index++) {
      const member = participant({ id: `encoding-${index}`, displayName: 'Worker' })
      projection.participants.set(member.id, member)
    }
    const encode = TextEncoder.prototype.encode.bind(new TextEncoder())
    let encodedInputUnits = 0
    const observation = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, input = '') {
      encodedInputUnits += input.length
      return encode(input)
    })
    let result: ReturnType<typeof projectTeamBrowse>
    try {
      result = projectTeamBrowse(projection, { teamId, kind: 'members', afterCursor: -1, limit: 64 }, 512, 100000)
    } finally { observation.mockRestore() }
    if (!result.ok) throw new Error(result.reason)
    expect(result.value.items).toHaveLength(64)
    expect(encodedInputUnits).toBeLessThan(JSON.stringify(result.value).length * 3)
  })

  it('accounts for escaped JSON and UTF-8 exactly at the page byte boundary', () => {
    const projection = source()
    for (let index = 0; index < 12; index++) {
      const member = participant({ id: `escaped-${index}`, displayName: '甲😀"\\\n'.repeat(5) })
      projection.participants.set(member.id, member)
    }
    const request = { teamId, kind: 'members' as const, afterCursor: -1, limit: 12 }
    const complete = projectTeamBrowse(projection, request, 512, 100000)
    if (!complete.ok) throw new Error(complete.reason)
    const bytes = Buffer.byteLength(JSON.stringify(complete.value))
    expect(projectTeamBrowse(projection, request, 512, bytes)).toEqual(complete)
    const short = projectTeamBrowse(projection, request, 512, bytes - 1)
    if (!short.ok) throw new Error(short.reason)
    expect(short.value.items.length).toBeLessThan(12)
    expect(Buffer.byteLength(JSON.stringify(short.value))).toBeLessThanOrEqual(bytes - 1)
    const tail = projectTeamBrowse(projection, { ...request, afterCursor: short.value.nextCursor! }, 512, bytes - 1)
    if (!tail.ok) throw new Error(tail.reason)
    expect([...short.value.items, ...tail.value.items]).toEqual(complete.value.items)
  })

  it.each(['json', 'sqlite'] as const)('honors configured row and byte limits on a fresh Hub (%s)', async (backend) => {
    const members = Array.from({ length: 8 }, (_, index) =>
      participant({ id: `configured-${index}`, displayName: '😀'.repeat(100) }))
    const records = [createdTeam(), ...members.map((member, index) => participantChanged({ participant: member, createdAt: 12 + index }))]
    const configured = (config: Parameters<typeof recover>[7]) =>
      recover(backend, records, undefined, teamId, [], records.length - 1, [], config)
    const rowLimited = await configured({ recoveryPageSize: 2, maxSelectionBytes: 4096, maxSelectionTextBytes: 7 })
    for (const limit of [undefined, 100]) {
      const page = await rowLimited.teams.browse({ teamId, kind: 'members', ...limit === undefined ? {} : { limit } })
      expect(page.items).toHaveLength(2)
      expect(page.nextCursor).toBe(1)
      expect(page.items[0]).toMatchObject({ displayName: { text: '😀', truncated: true } })
    }
    const byteLimited = await configured({ recoveryPageSize: 8, maxSelectionBytes: 600, maxSelectionTextBytes: 64 })
    const ids: string[] = []
    let afterCursor = -1
    for (let index = 0; index < 8; index++) {
      const page = await byteLimited.teams.browse({ teamId, kind: 'members', afterCursor })
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(600)
      ids.push(...page.items.map(item => item.id))
      if (page.nextCursor === undefined) break
      afterCursor = page.nextCursor
    }
    expect(ids).toEqual(members.map(member => member.id))
    const impossible = await configured({ maxSelectionBytes: 1 })
    await expect(impossible.teams.browse({ teamId, kind: 'members' })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
  })

  it('omits workflow graph and result bodies, and rejects oversized routing data rather than truncating ids', () => {
    const projection = source()
    const plan = workflow()
    let graphReads = 0
    const channel = plan.plan.channel
    Object.defineProperty(plan.plan, 'channel', { get: () => { graphReads++; return channel } })
    projection.workflowPlans.set(plan.id, plan)
    const request = { teamId, kind: 'workflowPlans' as const, afterCursor: -1, limit: 1 }
    expect(projectTeamBrowse(projection, request, 4, 1024)).toMatchObject({ ok: true, value: { items: [{
      name: { text: 'Work', truncated: true }, taskCount: 1, boundTaskCount: 0,
    }] } })
    expect(graphReads).toBe(0)
    expect(projectTeamBrowse(projection, request, 4, 1)).toEqual({ ok: false, reason: 'metadata' })
    const oversized = { ...plan, channelId: 'x'.repeat(2048) as NonNullable<typeof plan.channelId> }
    projection.workflowPlans.set(plan.id, oversized)
    expect(projectTeamBrowse(projection, request, 4, 1024)).toEqual({ ok: false, reason: 'row' })
  })

  it('rejects foreign rows, wrong collection bodies, duplicate ids and impossible continuation accounting', () => {
    const projection = source()
    const member = participant()
    projection.participants.set(member.id, member)
    const result = projectTeamBrowse(projection, { teamId, kind: 'members', afterCursor: -1, limit: 1 }, 32, 1024)
    if (!result.ok) throw new Error(result.reason)
    const page = result.value
    for (const invalid of [{ ...page, teamId: 'foreign' }, { ...page, kind: 'tasks' }, { ...page, scanned: 0 },
      { ...page, nextCursor: 0 }, { ...page, total: 2, scanned: 2, items: [...page.items, ...page.items] }]) {
      expect(teamBrowsePageSchema.safeParse(invalid).success).toBe(false)
    }
    expect(teamBrowseRequestSchema.safeParse({ teamId, kind: 'unknown' }).success).toBe(false)
    expect(teamBrowseRequestSchema.safeParse({ teamId, kind: 'tasks', limit: 0 }).success).toBe(false)
  })

  it.each(['json', 'sqlite'] as const)('reads all three summary collections from durable storage without an Agent provider (%s)', async (backend) => {
    const member = participant({ id: taskCreatorId, role: 'coordinator' })
    const tasks = [task({ id: 'browse-first', description: 'detail'.repeat(10000) }), task({ id: 'browse-second' })]
    const plan = workflow()
    const ctx = await recover(backend, [createdTeam(), teamPhase(),
      ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
        participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
      { type: 'activation/changed', createdAt: 15, binding: {
        activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
        sessionId: taskCreatorSessionId, provider: 'in-process',
      } }, ...tasks.map((item, index) => taskChanged({ task: item, createdAt: 16 + index })),
      { type: 'workflow-plan/changed', plan, createdAt: 18 },
    ])
    const before = (await ctx.teams.getTeam({ teamId })).team.cursor
    const first = await ctx.teams.browse({ teamId, kind: 'tasks', limit: 1 })
    expect(first).toMatchObject({ kind: 'tasks', total: 2, nextCursor: 0, scanned: 2, teamCursor: before })
    expect(first.items[0]).not.toHaveProperty('description')
    expect(first.items[0]).not.toHaveProperty('attemptHistory')
    expect(await ctx.teams.browse({ teamId, kind: 'tasks', afterCursor: first.nextCursor, limit: 1 }))
      .toMatchObject({ items: [{ id: tasks[1]!.id }], teamCursor: before })
    expect(await ctx.teams.browse({ teamId, kind: 'members' })).toMatchObject({ items: [{ id: member.id }], teamCursor: before })
    expect(await ctx.teams.browse({ teamId, kind: 'workflowPlans' })).toMatchObject({ items: [{ id: plan.id }], teamCursor: before })
    const open = vi.spyOn(ctx.storageLog, 'open')
    await expect(ctx.teams.browse({ teamId, kind: 'tasks', limit: 0 })).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
})
