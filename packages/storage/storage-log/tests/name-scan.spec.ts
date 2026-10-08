/** Discovery work, retry retention and iterator ownership are bounded independently of visible rows. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameScanner } from '../src/name-scan.ts'
import type { LogNameScanCursor, LogNameScanPage } from '../src/name-scan.ts'

const scanners: NameScanner[] = []
afterEach(async () => { await Promise.all(scanners.splice(0).map(scanner => scanner.close())); vi.restoreAllMocks() })

function scanner(config: ConstructorParameters<typeof NameScanner>[0], open: ConstructorParameters<typeof NameScanner>[1]) {
  const instance = new NameScanner(config, open)
  scanners.push(instance)
  return instance
}

describe('bounded stream-name scans', () => {
  it.each(['maxOpenScans', 'maxScanEntries', 'scanIdleMs', 'maxScanNameBytes'] as const)(
    'rejects invalid deployment %s before admitting discovery', (key) => {
      for (const value of [0, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => new NameScanner({ [key]: value }, async function* () {})).toThrow(`${key} must be a positive safe integer`)
      }
    },
  )

  it('retains both the provider read error and its independent cleanup failure', async () => {
    const reading = new Error('provider read failed')
    const cleanup = new Error('provider close failed')
    const source = scanner({}, () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { throw reading },
          async return() { throw cleanup },
        }
      },
    }))
    await expect(source.scan({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({
      message: 'stream-name scan and iterator cleanup failed', errors: [reading, cleanup],
    })
    await expect(source.close()).rejects.toMatchObject({ message: 'stream-name discovery cleanup failed', errors: [cleanup] })
    scanners.splice(scanners.indexOf(source), 1)
  })

  it.each([
    { prefix: '\ud800', limit: 1 },
    { prefix: 'long-prefix', limit: 1 },
    { prefix: 'team/', limit: 0 },
    { prefix: 'team/', limit: 0.5 },
  ])('rejects invalid discovery work before opening a provider (%j)', async (request) => {
    const open = vi.fn(async function* () { yield 'team/a' })
    const source = scanner({ maxScanNameBytes: 8 }, open)
    await expect(source.scan(request)).rejects.toMatchObject({ code: 'scan-invalid' })
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses oversized and complete-position cursors without reopening the provider', async () => {
    const open = vi.fn(async function* () { yield 'team/a'; yield 'team/b' })
    const source = scanner({}, open)
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: 'x'.repeat(65) as LogNameScanCursor }))
      .rejects.toMatchObject({ code: 'scan-expired' })
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: '' as LogNameScanCursor }))
      .rejects.toMatchObject({ code: 'scan-expired' })
    expect(open).not.toHaveBeenCalled()
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    const invalid = `${first.nextCursor!.split(':')[0]}:9` as LogNameScanCursor
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: invalid })).rejects.toMatchObject({
      code: 'scan-invalid', message: 'stream-name cursor is not the next scan position',
    })
    const final = await source.scan({ prefix: 'team/', limit: 2, afterCursor: first.nextCursor! })
    expect(final).toEqual({ names: ['team/b'], scanned: 1 })
    const completed = `${first.nextCursor!.split(':')[0]}:2` as LogNameScanCursor
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: completed })).rejects.toMatchObject({ code: 'scan-invalid' })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('retires an exhausted scan instead of wrapping its position into an aliased cursor', async () => {
    let retired = 0
    const source = scanner({ maxOpenScans: 1 }, async function* () {
      try { yield 'team/a'; yield 'team/b' }
      finally { retired += 1 }
    })
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    const id = first.nextCursor!.split(':')[0]!
    const cursor = `${id}:${Number.MAX_SAFE_INTEGER}` as LogNameScanCursor
    // Seed the valid retained page/counter relationship at its representable boundary,
    // rather than issuing 2^53-1 pages. The provider iterator and retirement remain real.
    const retained = Reflect.get(source, 'scans') as Map<string, {
      position: number
      last: { cursor: string | undefined; page: LogNameScanPage }
    }>
    const state = retained.get(id)!
    state.position = Number.MAX_SAFE_INTEGER
    state.last = { cursor: `${id}:${Number.MAX_SAFE_INTEGER - 1}`, page: { ...first, nextCursor: cursor } }
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: cursor })).rejects.toMatchObject({ code: 'scan-expired' })
    expect(retired).toBe(1)
    const fresh = await source.scan({ prefix: 'team/', limit: 1 })
    expect(fresh.names).toEqual(['team/a'])
    expect(fresh.nextCursor).not.toBe(cursor)
  })

  it('counts skipped entries, returns empty continuations and replays a page without advancing the backend', async () => {
    let examined = 0
    const source = scanner({ maxScanEntries: 2 }, async function* () {
      for (const name of [undefined, undefined, 'team/a', 'team/b', 'team/c']) { examined += 1; yield name }
    })
    const first = await source.scan({ prefix: 'team/', limit: 100 })
    expect(first).toMatchObject({ names: [], scanned: 2 })
    expect(first.nextCursor).toBeDefined()
    const second = await source.scan({ prefix: 'team/', afterCursor: first.nextCursor!, limit: 2 })
    expect(second.names).toEqual(['team/a', 'team/b'])
    expect(examined).toBe(4)
    expect(await source.scan({ prefix: 'team/', afterCursor: first.nextCursor!, limit: 100 })).toEqual(second)
    expect(examined).toBe(4)
    await expect(source.scan({ prefix: 'team/', afterCursor: first.nextCursor!, limit: 1 })).rejects.toMatchObject({ code: 'scan-invalid' })
    const last = await source.scan({ prefix: 'team/', afterCursor: second.nextCursor!, limit: 2 })
    expect(last).toEqual({ names: ['team/c'], scanned: 1 })
  })

  it('enforces scan slots, releases expired iterators and rejects foreign cursor queries', async () => {
    let closed = 0
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const source = scanner({ maxOpenScans: 1, scanIdleMs: 10 }, async function* () {
      try { yield 'team/a'; yield 'team/b' }
      finally { closed += 1 }
    })
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    await expect(source.scan({ prefix: 'other/', afterCursor: first.nextCursor!, limit: 1 })).rejects.toMatchObject({ code: 'scan-invalid' })
    await expect(source.scan({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'scan-limit' })
    now = 20
    await expect(source.scan({ prefix: 'team/', afterCursor: first.nextCursor!, limit: 1 })).rejects.toMatchObject({ code: 'scan-expired' })
    expect(closed).toBe(1)
    expect((await source.scan({ prefix: 'team/', limit: 1 })).names).toEqual(['team/a'])
  })

  it('evicts completed retry pages before denying a fresh scan', async () => {
    const source = scanner({ maxOpenScans: 1 }, async function* () { yield 'team/a' })
    for (let count = 0; count < 4; count += 1) {
      expect(await source.scan({ prefix: 'team/', limit: 2 })).toEqual({ names: ['team/a'], scanned: 1 })
    }
  })

  it('coalesces concurrent page retries and waits for the backend before closing', async () => {
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    let closed = false
    const source = scanner({}, async function* () {
      try { yield 'team/a'; entered.resolve(undefined); await gate.promise; yield 'team/b' }
      finally { closed = true }
    })
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    const request = { prefix: 'team/', afterCursor: first.nextCursor!, limit: 1 }
    const next = source.scan(request)
    await entered.promise
    const duplicate = source.scan(request)
    await new Promise(resolve => setImmediate(resolve))
    const closing = source.close()
    gate.resolve(undefined)
    expect(await next).toEqual(await duplicate)
    await closing
    expect(closed).toBe(true)
    await expect(source.scan(request)).rejects.toMatchObject({ code: 'closed' })
  })

  it('refuses a coalesced response that exceeds the retry caller work budget', async () => {
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const source = scanner({}, async function* () {
      yield 'team/a'
      yield 'team/b'
      entered.resolve(undefined)
      await gate.promise
      yield 'team/c'
    })
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    const request = { prefix: 'team/', afterCursor: first.nextCursor!, limit: 2 }
    const original = source.scan(request)
    await entered.promise
    const refusal = expect(source.scan({ ...request, limit: 1 })).rejects.toMatchObject({ code: 'scan-invalid' })
    await new Promise(resolve => setImmediate(resolve))
    gate.resolve(undefined)
    expect((await original).names).toEqual(['team/b', 'team/c'])
    await refusal
  })

  it('refuses a guessed future position while its preceding page is still being published', async () => {
    const source = scanner({}, async function* () { yield 'team/a'; yield 'team/b'; yield 'team/c' })
    const first = await source.scan({ prefix: 'team/', limit: 1 })
    const next = source.scan({ prefix: 'team/', afterCursor: first.nextCursor!, limit: 1 })
    // Backend progress can settle in the microtask queue before the page's IO-turn publication.
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
    const guessed = `${first.nextCursor!.split(':')[0]}:2` as LogNameScanCursor
    const refusal = expect(source.scan({ prefix: 'team/', afterCursor: guessed, limit: 1 }))
      .rejects.toMatchObject({ code: 'scan-invalid', message: 'stream-name scan already has a different page in flight' })
    expect((await next).names).toEqual(['team/b'])
    await refusal
  })

  it.each(['other/a', 'team/\ud800'])('rejects a provider row outside its exact prefix or Unicode contract (%s)', async (name) => {
    const source = scanner({}, async function* () { yield name })
    await expect(source.scan({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'scan-invalid' })
  })

  it('rejects malformed provider names and arbitrary cursor tokens without keeping the failed iterator', async () => {
    let closed = false
    const source = scanner({ maxScanNameBytes: 8 }, async function* () {
      try { yield 'team/name-too-long' }
      finally { closed = true }
    })
    await expect(source.scan({ prefix: 'team/', limit: 1 })).rejects.toMatchObject({ code: 'scan-invalid' })
    expect(closed).toBe(true)
    await expect(source.scan({ prefix: 'team/', limit: 1, afterCursor: 'unknown:0' as LogNameScanCursor }))
      .rejects.toMatchObject({ code: 'scan-expired' })
  })
})
