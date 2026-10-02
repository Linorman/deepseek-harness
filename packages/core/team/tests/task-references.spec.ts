/** Explicit task references remain byte bounded and independent of collection membership. */
import { expect, it } from 'vitest'
import { resolveTaskReferences } from '../src/task-references.ts'
import { teamTaskReferencesInputSchema, teamTaskReferencesPageSchema } from '../src/schema.ts'
import type { TeamTaskId, TeamId, TeamTaskSnapshot } from '../src/types.ts'

const teamId = 'reference-team' as TeamId
const ids = ['present', 'deleted', 'foreign', 'missing'].map(value => value as TeamTaskId)
const tasks = new Map(ids.slice(0, 2).map((id, index) => [id, { id, revision: index + 1,
  phase: index === 0 ? 'pending' : 'deleted', subject: '甲😀'.repeat(8),
  description: 'Private instructions', attemptHistory: [], reviewHistory: [],
} as unknown as TeamTaskSnapshot]))

it('resolves exact requested order, tombstones and indistinguishable unavailable references', () => {
  const first = resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 2, 9, 4096)
  expect(first.items).toMatchObject([{ taskId: ids[0], state: 'resolved', phase: 'pending', subject: { truncated: true } },
    { taskId: ids[1], state: 'resolved', phase: 'deleted' }])
  expect(first.nextCursor).toBe(2)
  const last = resolveTaskReferences(tasks, 7, { teamId, taskIds: ids, afterCursor: 2, expectedTeamCursor: 7 }, 2, 9, 4096)
  expect(last.items).toEqual([{ taskId: ids[2], state: 'unavailable' }, { taskId: ids[3], state: 'unavailable' }])
  expect(last.nextCursor).toBeUndefined()
  expect(teamTaskReferencesPageSchema.parse(first)).toEqual(first)
  expect(JSON.stringify(first)).not.toMatch(/description|attemptHistory|Private/)
  expect(resolveTaskReferences(tasks, 7, { teamId, taskIds: [] }, 2, 9, 4096).items).toEqual([])
  expect(resolveTaskReferences(tasks, 7, { teamId, taskIds: ids, afterCursor: 4 }, 2, 9, 4096).items).toEqual([])
})

it('accounts for complete metadata and continuation bytes and rejects an indivisible oversized row', () => {
  const full = resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 8, 512, 4096)
  const exact = new TextEncoder().encode(JSON.stringify(full)).byteLength
  expect(resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 8, 512, exact)).toEqual(full)
  const reduced = resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 8, 512, exact - 1)
  expect(reduced.items.length).toBeLessThan(4)
  expect(reduced.nextCursor).toBe(reduced.items.length)
  expect(new TextEncoder().encode(JSON.stringify(reduced)).byteLength).toBeLessThanOrEqual(exact - 1)
  expect(() => resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 8, 512, 1)).toThrow(/metadata/)
  expect(() => resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 8, 512, 100)).toThrow(/row/)
})

it('refuses moved revisions, invalid offsets and malformed wire metadata', () => {
  expect(() => resolveTaskReferences(tasks, 7, { teamId, taskIds: ids, expectedTeamCursor: 6 }, 2, 9, 4096)).toThrow(/changed/)
  expect(() => resolveTaskReferences(tasks, 7, { teamId, taskIds: ids, afterCursor: 5 }, 2, 9, 4096)).toThrow(/offset/)
  expect(teamTaskReferencesInputSchema.safeParse({ teamId, taskIds: [ids[0], ids[0]] }).success).toBe(false)
  expect(teamTaskReferencesInputSchema.safeParse({ teamId, taskIds: ids, actor: {} }).success).toBe(false)
  const page = resolveTaskReferences(tasks, 7, { teamId, taskIds: ids }, 2, 9, 4096)
  expect(teamTaskReferencesPageSchema.safeParse({ ...page, items: [page.items[0], page.items[0]] }).success).toBe(false)
  expect(teamTaskReferencesPageSchema.safeParse({ ...page, items: [] }).success).toBe(false)
  expect(teamTaskReferencesPageSchema.safeParse({ ...page, items: [{ ...page.items[0], description: 'Private' }] }).success).toBe(false)
})
