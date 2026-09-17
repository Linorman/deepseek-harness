/** Task inspection bounds the complete response and reads only the chosen history window. */
import { describe, expect, it, vi } from 'vitest'
import { teamTaskInspectionSchema, teamTaskInspectRequestSchema } from '@clocky/clocky-team'
import { projectTaskInspection, withoutPrivateTaskArtifacts } from '@clocky/clocky-team/selection'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, settledAttempt, task, taskChanged,
  taskCreatorActivationId, taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function longTask() {
  const history = Array.from({ length: 1000 }, (_, index) => settledAttempt({ id: `inspect-attempt-${index}`, ordinal: index + 1,
    assignedAt: 20 + index * 10, leaseExpiresAt: 30 + index * 10, settledAt: 25 + index * 10 }))
  return task({ attemptCount: history.length, maxAttempts: history.length + 1, attemptHistory: history })
}

describe('bounded task inspection', () => {
  it('omits histories from the current record and directly seeks a late history window', () => {
    const row = longTask()
    let reads = 0
    for (const attempt of row.attemptHistory) {
      const outcome = attempt.outcome
      Object.defineProperty(attempt, 'outcome', { get: () => { reads++; return outcome } })
    }
    const record = projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'record' }, 4096)
    expect(record).toMatchObject({ ok: true, value: { history: { attempts: 1000, reviews: 0 }, revision: row.revision } })
    if (!record.ok) throw new Error(record.reason)
    expect(JSON.stringify(record.value)).not.toContain('attemptHistory')
    expect(reads).toBe(0)
    expect(teamTaskInspectionSchema.parse(record.value)).toEqual(record.value)
    if (record.value.section !== 'record') throw new Error('Expected current task fields')
    for (const changed of [{ ...record.value, revision: record.value.revision + 1 },
      { ...record.value, task: { ...record.value.task, id: 'foreign' } },
      { ...record.value, history: { ...record.value.history, attempts: 999 } }]) {
      expect(teamTaskInspectionSchema.safeParse(changed).success).toBe(false)
    }

    const page = projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'attempts', afterCursor: 995, limit: 2 }, 4096)
    expect(page).toMatchObject({ ok: true, value: { startCursor: 995, nextCursor: 997, total: 1000, scanned: 2,
      items: [{ id: 'inspect-attempt-996' }, { id: 'inspect-attempt-997' }] } })
    expect(reads).toBeLessThanOrEqual(12)
    if (!page.ok) throw new Error(page.reason)
    expect(teamTaskInspectionSchema.parse(page.value)).toEqual(page.value)
    if (page.value.section !== 'attempts') throw new Error('Expected attempt history')
    for (const items of [[...page.value.items].reverse(), page.value.items.map(item => ({ ...item, teamId: 'foreign' })),
      page.value.items.map(item => ({ ...item, id: 'repeated-id' }))]) {
      expect(teamTaskInspectionSchema.safeParse({ ...page.value, items }).success).toBe(false)
    }

    expect(projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'attempts', afterCursor: 999, limit: 2 }, 4096))
      .toMatchObject({ ok: true, value: { scanned: 0, items: [] } })
  })

  it('applies the UTF-8 budget to wrappers and continuation, preserving every history row', () => {
    const row = longTask()
    const ids: string[] = []
    let afterCursor = 989
    while (afterCursor < 999) {
      const result = projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'attempts', afterCursor, limit: 8 }, 950)
      if (!result.ok || result.value.section !== 'attempts') throw new Error('Expected an attempt page')
      expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(950)
      expect(result.value.items.length).toBeGreaterThan(0)
      expect(result.value.items.length).toBeLessThan(8)
      expect(teamTaskInspectionSchema.parse(result.value)).toEqual(result.value)
      ids.push(...result.value.items.map(item => item.id))
      if (result.value.nextCursor === undefined) break
      afterCursor = result.value.nextCursor
    }
    expect(ids).toEqual(row.attemptHistory.slice(990).map(item => item.id))
    const exact = projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'record' }, 10000)
    if (!exact.ok) throw new Error(exact.reason)
    const size = Buffer.byteLength(JSON.stringify(exact.value))
    expect(projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'record' }, size)).toEqual(exact)
    expect(projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'record' }, size - 1)).toEqual({ ok: false, reason: 'metadata' })
    expect(projectTaskInspection(row, 2000, { teamId, taskId: row.id, section: 'attempts', afterCursor: -1, limit: 1 }, 250))
      .toEqual({ ok: false, reason: 'row' })
  })

  it('removes private result and integration artifacts without mutating the authoritative result', () => {
    const secret = { id: 'private', provider: 'local', kind: 'report', uri: 'secret/path', visibility: 'private' }
    const visible = { ...secret, id: 'visible', uri: 'public/path', visibility: 'team' }
    const attempt = settledAttempt({ outcome: { kind: 'completed', result: { summary: '界😀'.repeat(20), artifacts: [secret, visible],
      integration: { target: 'main', status: 'proposed', proposalArtifact: secret, artifacts: [secret, visible] } } } })
    const row = task({ phase: 'completed', attemptCount: 1, attemptHistory: [attempt] })
    const result = projectTaskInspection(row, 10, { teamId, taskId: row.id, section: 'attempts', afterCursor: -1, limit: 1 }, 2048)
    if (!result.ok) throw new Error(result.reason)
    expect(JSON.stringify(result.value)).not.toContain('secret/path')
    expect(JSON.stringify(result.value)).toContain('public/path')
    expect(JSON.stringify(row)).toContain('secret/path')
    expect(teamTaskInspectionSchema.parse(result.value)).toEqual(result.value)
  })

  it('pages review decisions independently while omitting absent result fields', () => {
    const attempts = Array.from({ length: 3 }, (_, index) => settledAttempt({ id: `review-attempt-${index}`, ordinal: index + 1,
      assignedAt: 13 + index * 20, leaseExpiresAt: 23 + index * 20, settledAt: 20 + index * 20,
      outcome: { kind: 'completed', result: { summary: 'Done' } } }))
    const row = task({ attemptCount: 3, maxAttempts: 4, attemptHistory: attempts,
      reviewPolicy: { kind: 'participant', reviewerId: taskCreatorId },
      reviewHistory: attempts.map((attempt, index) => ({ attemptId: attempt.id, reviewerId: taskCreatorId,
        nextPhase: 'pending', reason: 'Revise the evidence.', decidedAt: 21 + index * 20 })) })
    const page = projectTaskInspection(row, 40, { teamId, taskId: row.id, section: 'reviews', afterCursor: 0, limit: 1 }, 1024)
    expect(page).toMatchObject({ ok: true, value: { section: 'reviews', total: 3, nextCursor: 1, scanned: 1,
      items: [{ attemptId: 'review-attempt-1', reason: 'Revise the evidence.' }] } })
    if (!page.ok) throw new Error(page.reason)
    expect(teamTaskInspectionSchema.parse(page.value)).toEqual(page.value)
    expect(projectTaskInspection(row, 40, { teamId, taskId: row.id, section: 'attempts', afterCursor: -1, limit: 1 }, 1024))
      .toMatchObject({ ok: true, value: { items: [{ outcome: { kind: 'completed', result: { summary: 'Done' } } }] } })
    expect(projectTaskInspection(row, 40, { teamId, taskId: row.id, section: 'reviews', afterCursor: -1, limit: 1 }, 1))
      .toEqual({ ok: false, reason: 'metadata' })
  })

  it.each(['released', 'lease-expired', 'failed', 'cancelled'] as const)('preserves the %s terminal fact in history', (kind) => {
    const outcome = kind === 'failed' ? { kind, failure: { code: 'WORK_FAILED', message: 'Work failed.' } } : { kind }
    const attempt = settledAttempt({ outcome, settledAt: kind === 'lease-expired' ? 25 : 20 })
    const row = task({ phase: kind === 'cancelled' ? 'cancelled' : kind === 'failed' ? 'failed' : 'pending',
      attemptCount: 1, attemptHistory: [attempt] })
    const result = projectTaskInspection(row, 10, { teamId, taskId: row.id, section: 'attempts', afterCursor: -1, limit: 1 }, 2048)
    expect(result).toMatchObject({ ok: true, value: { items: [{ outcome }] } })
    if (!result.ok) throw new Error(result.reason)
    expect(teamTaskInspectionSchema.parse(result.value)).toEqual(result.value)
  })

  it('preserves visible integration proposals and optional artifact manifests', () => {
    const artifact = { id: 'visible', provider: 'local', kind: 'patch' as const, uri: 'public/patch', visibility: 'team' as const }
    expect(withoutPrivateTaskArtifacts({ summary: 'Review', integration: { target: 'main', status: 'proposed', proposalArtifact: artifact } }))
      .toEqual({ summary: 'Review', integration: { target: 'main', status: 'proposed', proposalArtifact: artifact } })
    expect(withoutPrivateTaskArtifacts({ summary: 'Merged', integration: { target: 'main', status: 'integrated', targetVersion: 'abc' } }))
      .toEqual({ summary: 'Merged', integration: { target: 'main', status: 'integrated', targetVersion: 'abc' } })
  })

  it('rejects wrong owners, stale revisions, unbounded requests and inconsistent response continuations', () => {
    const row = task()
    const input = { teamId, taskId: row.id, section: 'record' as const }
    expect(projectTaskInspection(row, 10, { ...input, taskId: 'foreign' as typeof row.id }, 4096)).toEqual({ ok: false, reason: 'owner' })
    expect(projectTaskInspection(row, 10, { ...input, expectedRevision: 2 }, 4096)).toEqual({ ok: false, reason: 'revision' })
    for (const invalid of [{ ...input, section: 'unknown' }, { ...input, actor: {} }, { ...input, limit: 1 }, { ...input, expectedRevision: 0 },
      { ...input, section: 'attempts', limit: 0 }, { ...input, section: 'reviews', afterCursor: -2 }]) {
      expect(teamTaskInspectRequestSchema.safeParse(invalid).success).toBe(false)
    }
    const page = { teamId, taskId: row.id, revision: 1, teamCursor: 10, section: 'attempts', startCursor: -1, total: 0, scanned: 0, items: [] }
    for (const invalid of [{ ...page, total: 2 }, { ...page, nextCursor: 0 }, { ...page, scanned: 2 }]) {
      expect(teamTaskInspectionSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it.each(['json', 'sqlite'] as const)('reads a replayed task without an Agent and enforces its revision (%s)', async (backend) => {
    const member = participant({ id: taskCreatorId, role: 'coordinator' })
    const row = task()
    const ctx = await recover(backend, [createdTeam(), teamPhase(),
      ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
        participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
      { type: 'activation/changed', createdAt: 15, binding: {
        activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
        sessionId: taskCreatorSessionId, provider: 'in-process',
      } }, taskChanged({ task: row, createdAt: 16 }),
    ])
    const record = await ctx.teams.inspectTask({ teamId, taskId: row.id, section: 'record' })
    expect(record).toMatchObject({ section: 'record', revision: 1, task: { id: row.id, subject: row.subject } })
    expect(await ctx.teams.inspectTask({ teamId, taskId: row.id, section: 'reviews', expectedRevision: 1 }))
      .toMatchObject({ items: [], total: 0 })
    await expect(ctx.teams.inspectTask({ teamId, taskId: row.id, section: 'attempts', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
    const opening = vi.spyOn(ctx.storageLog, 'open')
    await expect(ctx.teams.inspectTask({ teamId, taskId: row.id, section: 'attempts', limit: 0 })).rejects.toThrow()
    expect(opening).not.toHaveBeenCalled()
    await expect(ctx.teams.inspectTask({ teamId, taskId: 'foreign' as typeof row.id, section: 'record' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
  })
})
