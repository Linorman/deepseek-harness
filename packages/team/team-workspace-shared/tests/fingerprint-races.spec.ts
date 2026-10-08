/** Deterministic fault injection at the filesystem API boundary for scanner races. */
import * as filesystem from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readBoundedBaseline, snapshotDirectory } from '../src/fingerprint.ts'

const fault = vi.hoisted(() => ({ realpathCalls: 0, flipOnCall: 0, replacement: '',
  root: '', rootStats: 0, rootAsFile: false, directoryChanged: false,
  openedFileIdentityChanged: false, openedFileChanged: false, baselineGrowth: false,
  reverseEntries: false, failEnumeration: false, expireBeforeEntry: false,
  enumerationAbort: 'none' as 'none' | 'caller' | 'deadline',
  openReadFailure: 'none' as 'none' | 'io' | 'caller' | 'deadline',
  openError: 'none' as 'none' | 'EACCES' | 'generic', abortController: undefined as AbortController | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const { Readable } = await import('node:stream')
  return { ...actual, realpath: async (path: Parameters<typeof actual.realpath>[0]) => {
    const resolved = await actual.realpath(path)
    fault.realpathCalls += 1
    return fault.realpathCalls === fault.flipOnCall ? fault.replacement : resolved
  }, lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
    const info = await actual.lstat(path)
    if (String(path) !== fault.root) return info
    fault.rootStats += 1
    if (fault.rootAsFile && fault.rootStats === 1) {
      return new Proxy(info, { get(target, key) {
        return key === 'isDirectory' ? () => false : Reflect.get(target, key) as unknown
      } })
    }
    if (fault.directoryChanged && fault.rootStats === 2) {
      return new Proxy(info, { get(target, key) {
        return key === 'mtimeMs' ? target.mtimeMs + 1 : Reflect.get(target, key) as unknown
      } })
    }
    return info
  }, opendir: async (path: Parameters<typeof actual.opendir>[0]) => {
    const opened = await actual.opendir(path)
    if (!fault.reverseEntries && !fault.failEnumeration && !fault.expireBeforeEntry) return opened
    const entries: import('node:fs').Dirent[] = []
    for await (const entry of opened) entries.push(entry)
    return { async *[Symbol.asyncIterator]() {
      for (const [index, entry] of (fault.reverseEntries ? entries.toReversed() : entries).entries()) {
        if (fault.expireBeforeEntry && index === 0) fault.abortController?.abort()
        if (fault.failEnumeration && index === 1) {
          if (fault.enumerationAbort === 'caller') fault.abortController?.abort()
          if (fault.enumerationAbort === 'deadline') await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
          throw Object.assign(new Error('directory read failed'), { code: 'EIO' })
        }
        yield entry
      }
    } } as Awaited<ReturnType<typeof actual.opendir>>
  }, open: async (path: Parameters<typeof actual.open>[0], flags: Parameters<typeof actual.open>[1]) => {
    if (fault.openError !== 'none') {
      throw fault.openError === 'EACCES' ? Object.assign(new Error('opening denied'), { code: 'EACCES' })
        : new Error('opening failed')
    }
    const handle = await actual.open(path, flags)
    if (!fault.openedFileIdentityChanged && !fault.openedFileChanged && !fault.baselineGrowth
      && fault.openReadFailure === 'none') return handle
    let stats = 0
    return { stat: async () => {
      const info = await handle.stat()
      stats += 1
      if (fault.openedFileIdentityChanged && stats === 1) {
        return new Proxy(info, { get(target, key) {
          return key === 'ino' ? target.ino + 1 : Reflect.get(target, key) as unknown
        } })
      }
      if (fault.openedFileChanged && stats === 2) {
        return new Proxy(info, { get(target, key) {
          return key === 'size' ? target.size + 1 : Reflect.get(target, key) as unknown
        } })
      }
      return info
    }, createReadStream: (options: Parameters<typeof handle.createReadStream>[0]) => {
      if (fault.baselineGrowth) {
        return Readable.from([Buffer.from('grown-content')])
      }
      if (fault.openReadFailure !== 'none') {
        return Readable.from((async function* () {
          if (fault.openReadFailure === 'caller') fault.abortController?.abort()
          if (fault.openReadFailure === 'deadline') await new Promise<void>((resolve) => { setTimeout(resolve, 150) })
          throw Object.assign(new Error('file read failed'), { code: 'EIO' })
        })())
      }
      return handle.createReadStream(options)
    }, close: async () => { await handle.close() } } as typeof handle
  } }
})

const roots: string[] = []
afterEach(async () => {
  fault.realpathCalls = 0
  fault.flipOnCall = 0
  fault.replacement = ''
  fault.root = ''
  fault.rootStats = 0
  fault.rootAsFile = false
  fault.directoryChanged = false
  fault.openedFileIdentityChanged = false
  fault.openedFileChanged = false
  fault.baselineGrowth = false
  fault.reverseEntries = false
  fault.failEnumeration = false
  fault.expireBeforeEntry = false
  fault.enumerationAbort = 'none'
  fault.openReadFailure = 'none'
  fault.openError = 'none'
  fault.abortController = undefined
  for (const root of roots.splice(0)) await filesystem.rm(root, { recursive: true, force: true })
})

it('detects a directory identity that changes between selection and traversal', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'entry'), 'content')
  fault.flipOnCall = 2
  fault.replacement = join(path, 'moved')
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version.incompleteReasons).toContain('directory-identity-changed')
  expect(fault.realpathCalls).toBeGreaterThanOrEqual(2)
})

it('rejects a root that ceases to be a directory after its canonical identity read', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  fault.root = path
  fault.rootAsFile = true
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version.incompleteReasons).toContain('directory-identity-changed')
})

it('detects a directory whose metadata changes during enumeration', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  fault.root = path
  fault.directoryChanged = true
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version.incompleteReasons).toContain('directory-changed-during-scan')
})

it.each(['openedFileIdentityChanged', 'openedFileChanged'] as const)('rejects %s after opening a selected file', async (kind) => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'entry'), 'content')
  fault[kind] = true
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version.incompleteReasons).toContain(kind === 'openedFileIdentityChanged'
    ? 'file-identity-changed' : 'file-changed-during-scan')
  expect(scan.files['entry']).toBeUndefined()
})

it('keeps a partial entry list when its directory iterator fails', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'z'), 'one')
  await filesystem.writeFile(join(path, 'a'), 'two')
  fault.reverseEntries = true
  fault.failEnumeration = true
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version).toMatchObject({ complete: false, scannedEntries: 1 })
  expect(scan.version.incompleteReasons).toContain('filesystem-EIO')
})

it('stops before admitting the first entry when its caller cancels during enumeration', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'entry'), 'content')
  const controller = new AbortController()
  fault.abortController = controller
  fault.expireBeforeEntry = true
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  }, controller.signal)
  expect(scan.version).toMatchObject({ complete: false, scannedEntries: 0,
    incompleteReasons: ['canceled'] })
})

it.each(['caller', 'deadline'] as const)('attributes a directory-read fault to %s cancellation', async (kind) => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'a'), 'one')
  await filesystem.writeFile(join(path, 'b'), 'two')
  const controller = new AbortController()
  fault.abortController = controller
  fault.failEnumeration = true
  fault.enumerationAbort = kind
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024,
    observationTimeoutMs: kind === 'deadline' ? 50 : 5000,
  }, controller.signal)
  expect(scan.version.incompleteReasons).toContain(kind === 'caller' ? 'canceled' : 'duration-limit')
})

it.each(['EACCES', 'generic'] as const)('retains a safe %s file-open failure category', async (kind) => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'entry'), 'content')
  fault.openError = kind
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024, observationTimeoutMs: 5000,
  })
  expect(scan.version.incompleteReasons).toContain(kind === 'EACCES' ? 'filesystem-EACCES' : 'filesystem-error')
})

it.each(['io', 'caller', 'deadline'] as const)('contains a %s stream read failure without exposing file bytes', async (kind) => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  await filesystem.writeFile(join(path, 'entry'), 'content')
  const controller = new AbortController()
  fault.abortController = controller
  fault.openReadFailure = kind
  const scan = await snapshotDirectory(path, {
    observationMaxEntries: 8, observationMaxHashBytes: 1024, observationMaxFileBytes: 1024,
    observationTimeoutMs: kind === 'deadline' ? 50 : 5000,
  }, controller.signal)
  expect(scan.version.incompleteReasons).toContain(kind === 'caller' ? 'canceled'
    : kind === 'deadline' ? 'duration-limit' : 'filesystem-EIO')
  expect(scan.files['entry']).toBeUndefined()
})

it('rejects a baseline that grows beyond its byte ceiling after initial stat', async () => {
  const path = await filesystem.mkdtemp(join(process.cwd(), '.tmp/fingerprint-race-'))
  roots.push(path)
  const baseline = join(path, 'baseline.json')
  await filesystem.writeFile(baseline, '{}')
  fault.baselineGrowth = true
  await expect(readBoundedBaseline(baseline, 2)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})
