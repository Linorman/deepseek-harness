/** Encrypted continuations and complete response admission protect directory discovery. */
import { expect, it, vi } from 'vitest'
import { projectTeamProductSummary } from '@clocky/clocky-team/selection'
import type { TeamHumanReaderScope, TeamProductSummary, TeamDiscoveryCursor } from '@clocky/clocky-team'
import { ProductDirectory, ProductDirectoryCursor } from '../src/product-directory.ts'
import type { ProductDirectoryReader } from '../src/product-directory.ts'
import { teamProjectionFromData } from '../src/fold.ts'
import { checkpointFor } from './durable-replay-fixtures.ts'
import { createdTeam } from './fixtures.ts'

const scope: TeamHumanReaderScope = { principalId: 'reader' as never, issuer: 'test', subject: 'subject', credentialGeneration: 1 }
const raw = teamProjectionFromData(checkpointFor([createdTeam()])).team
const row = projectTeamProductSummary(raw, raw.id, 512, {})
const cursor = (id: number) => `position-private-${id}` as TeamDiscoveryCursor
function fixture(rows: (TeamProductSummary | undefined)[] = [row, row]) {
  const count = rows.length
  return {
    currentScope: () => scope,
    scan: vi.fn<ProductDirectoryReader['scan']>(async (position) => {
      const index = position === -1 ? 0 : Number(position.slice('position-private-'.length))
      return { items: index < count ? [raw] : [], scanned: index < count ? 1 : 0,
        ...index + 1 < count ? { nextCursor: cursor(index + 1) } : {} }
    }),
    project: vi.fn<ProductDirectoryReader['project']>(async () => rows.shift()),
    publish: vi.fn<ProductDirectoryReader['publish']>(async (ids, nextCursor) => ({ items: ids.map(() => row), ...nextCursor === undefined ? {} : { nextCursor } })),
  } satisfies ProductDirectoryReader
}

it('conceals storage positions and rejects tampering, readers, generations and provider replacement', () => {
  const codec = new ProductDirectoryCursor()
  for (const position of [-1, cursor(1)] as const) {
    const sealed = codec.seal(position, scope)
    expect(codec.open(sealed, scope, 4096)).toBe(position)
    expect(sealed).not.toContain('position-private')
    expect(codec.seal(position, scope)).not.toBe(sealed)
    for (const changed of [{ ...scope, principalId: 'other' as never }, { ...scope, subject: 'other' },
      { ...scope, issuer: 'other' }, { ...scope, credentialGeneration: 2 }]) {
      expect(() => codec.open(sealed, changed, 4096)).toThrow(/expired/)
    }
    expect(() => new ProductDirectoryCursor().open(sealed, scope, 4096)).toThrow(/expired/)
    expect(() => codec.open(sealed, scope, sealed.length - 1)).toThrow(/expired/)
    expect(() => codec.open(`${sealed.slice(0, -3)}xxx` as never, scope, 4096)).toThrow(/expired/)
  }
  for (const bad of ['raw-provider-position', 'directory-v1:!', 'directory-v1:AA']) {
    expect(() => codec.open(bad as never, scope, 4096)).toThrow(/expired/)
  }
})

it('bounds physical scan work even when none of the examined Teams are visible', async () => {
  const directory = new ProductDirectory()
  const reader = fixture([undefined, undefined, undefined])
  const result = await directory.read(-1, scope, 1, 4096, reader)
  expect(result.items).toEqual([])
  expect(result.nextCursor).toBeDefined()
  expect(reader.scan).toHaveBeenCalledTimes(1)
  expect(reader.publish).toHaveBeenCalledWith([], result.nextCursor)
})

it('rejects a changed authentication context and non-advancing or oversized provider work', async () => {
  for (const bad of [{ items: [raw, raw], scanned: 1 }, { items: [], scanned: 2 },
    { items: [], scanned: 0, nextCursor: cursor(1) }, { items: [], scanned: 1, nextCursor: -1 }]) {
    const reader = fixture()
    reader.scan = vi.fn<ProductDirectoryReader['scan']>(async () => bad as never)
    await expect(new ProductDirectory().read(-1, scope, 1, 4096, reader)).rejects.toThrow(/allowance/)
  }
  const reader = fixture()
  reader.currentScope = vi.fn<() => TeamHumanReaderScope>().mockReturnValueOnce(scope)
    .mockReturnValue({ ...scope, credentialGeneration: 2 })
  await expect(new ProductDirectory().read(-1, scope, 1, 4096, reader)).rejects.toThrow(/reader changed/)
})

it('retains an unread visible row when adding it would exceed the complete page allowance', async () => {
  const directory = new ProductDirectory()
  let index = 0
  const reader = fixture()
  reader.scan = vi.fn<ProductDirectoryReader['scan']>(async position => ({ items: [raw], scanned: 1, nextCursor: cursor(position === -1 ? 1 : Number(position.slice('position-private-'.length)) + 1) }))
  reader.project = vi.fn<ProductDirectoryReader['project']>(async () => { index++; return row })
  const one = await directory.read(-1, scope, 1, 4096, reader)
  const allowance = Buffer.byteLength(JSON.stringify(one))
  const result = await directory.read(-1, scope, 2, allowance, reader)
  expect(result.items).toHaveLength(1)
  expect(reader.publish).toHaveBeenLastCalledWith([raw.id], expect.any(String))
  await expect(directory.read(-1, scope, 1, 1, fixture())).rejects.toThrow(/row exceeds/)
  await expect(directory.read(-1, scope, 1, 1, fixture([undefined, undefined]))).rejects.toThrow(/metadata exceeds/)
  expect(index).toBe(3)
})

it('decodes continuation, handles removal at the end and publishes visible bounded pages', async () => {
  const directory = new ProductDirectory()
  const reader = fixture([row, row, row])
  const first = await directory.read(-1, scope, 1, 4096, reader)
  expect(first.items).toHaveLength(1)
  if (first.nextCursor === undefined) throw new Error('Expected bounded continuation')
  const second = await directory.read(first.nextCursor, scope, 1, 4096, reader)
  expect(second.items).toHaveLength(1)
  if (second.nextCursor === undefined) throw new Error('Expected second bounded continuation')
  reader.scan = vi.fn<ProductDirectoryReader['scan']>(async () => ({ items: [], scanned: 0 }))
  const removed = await directory.read(second.nextCursor, scope, 1, 4096, reader)
  expect(removed).toEqual({ items: [] })
  expect(await new ProductDirectory().read(-1, scope, 1, 4096, fixture([row]))).toEqual({ items: [row] })
})
