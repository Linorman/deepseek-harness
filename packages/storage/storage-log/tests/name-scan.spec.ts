/** Discovery work, retry retention and iterator ownership are bounded independently of visible rows. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameScanner } from '../src/name-scan.ts'
import type { LogNameScanCursor } from '../src/name-scan.ts'

const scanners: NameScanner[] = []
afterEach(async () => { await Promise.all(scanners.splice(0).map(scanner => scanner.close())); vi.restoreAllMocks() })

function scanner(config: ConstructorParameters<typeof NameScanner>[0], open: ConstructorParameters<typeof NameScanner>[1]) {
  const instance = new NameScanner(config, open)
  scanners.push(instance)
  return instance
}

describe('bounded stream-name scans', () => {
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
