import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { teamLinkBindingIdentitySchema } from '@clocky/clocky-team-link'
import {
  EnrollmentLedger,
  WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
  enrollmentLedgerStream,
} from '../src/enrollment-ledger.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const binding = teamLinkBindingIdentitySchema.parse({
  activationId: 'remote-activation',
  teamId: 'team-enrollment',
  participantId: 'remote-participant',
  sessionId: 'remote-session',
  provider: 'sdk',
})
const enrollmentProviderName = 'websocket-test'
type StorageBackend = 'json' | 'sqlite'

afterEach(async () => {
  const failures: unknown[] = []
  for (const context of [...contexts]) {
    try {
      await context.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'enrollment ledger cleanup failed')
})

describe('EnrollmentLedger', () => {
  it.each(['json', 'sqlite'] as const)('%s persists only credential digests and recovers rotation, revocation, and later reissue', async (backend) => {
    const root = await freshRoot()
    const firstContext = await contextAt(root, backend)
    const timestamps = [1_001, 1_002, 1_003, 1_004]
    const first = await EnrollmentLedger.open(firstContext, {
      enrollmentProviderName,
      recoveryPageSize: 1,
      now: () => {
        const timestamp = timestamps.shift()
        if (timestamp === undefined) throw new Error('test clock exhausted')
        return timestamp
      },
    })
    const initialCredential = 'credential-must-not-reach-storage'
    const replacementCredential = 'replacement-must-not-reach-storage'
    const laterCredential = 'later-must-not-reach-storage'

    const issued = await first.issue(binding, initialCredential)
    expect(issued).toMatchObject({ generation: 1, state: 'issued', binding })
    expect(first.resolve(binding, initialCredential)).toEqual(issued)
    await expect(first.issue(binding, replacementCredential)).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_LEDGER_ALREADY_ISSUED',
    })

    const rotated = await first.rotate(binding, issued.generation, replacementCredential)
    expect(rotated).toMatchObject({ generation: 2, state: 'issued', binding })
    expect(first.resolve(binding, initialCredential)).toBeUndefined()
    expect(first.resolve(binding, replacementCredential)).toEqual(rotated)
    await expect(first.revoke(binding, issued.generation)).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_LEDGER_STALE_GENERATION',
    })

    const revoked = await first.revoke(binding, rotated.generation)
    expect(revoked).toMatchObject({ generation: 2, state: 'revoked', binding })
    expect(await first.revoke(binding, rotated.generation)).toEqual(revoked)
    expect(first.resolve(binding, replacementCredential)).toBeUndefined()
    const reissued = await first.issue(binding, laterCredential)
    expect(reissued).toMatchObject({ generation: 3, state: 'issued', binding })
    expect(first.get(binding)).toEqual(reissued)
    expect(first.get(binding)).not.toHaveProperty('credentialDigest')

    await first.close()
    const durableRecords = await readRecords(firstContext)
    const serialized = JSON.stringify(durableRecords)
    expect(serialized).not.toContain(initialCredential)
    expect(serialized).not.toContain(replacementCredential)
    expect(serialized).not.toContain(laterCredential)
    expect(durableRecords).toMatchObject([
      {
        version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
        type: 'enrollment',
        enrollmentProviderName,
        state: 'issued',
        binding,
        generation: 1,
        credentialDigest: sha256(initialCredential),
        issuedAt: 1_001,
      },
      {
        version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
        type: 'enrollment',
        enrollmentProviderName,
        state: 'issued',
        binding,
        generation: 2,
        credentialDigest: sha256(replacementCredential),
        issuedAt: 1_002,
      },
      {
        version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
        type: 'enrollment',
        enrollmentProviderName,
        state: 'revoked',
        binding,
        generation: 2,
        revokedAt: 1_003,
      },
      {
        version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
        type: 'enrollment',
        enrollmentProviderName,
        state: 'issued',
        binding,
        generation: 3,
        credentialDigest: sha256(laterCredential),
        issuedAt: 1_004,
      },
    ])

    await dispose(firstContext)
    const restartedContext = await contextAt(root, backend)
    const recovered = await EnrollmentLedger.open(restartedContext, { enrollmentProviderName, recoveryPageSize: 1 })
    expect(recovered.get(binding)).toEqual(reissued)
    expect(recovered.resolve(binding, initialCredential)).toBeUndefined()
    expect(recovered.resolve(binding, replacementCredential)).toBeUndefined()
    expect(recovered.resolve(binding, laterCredential)).toEqual(reissued)
    await recovered.close()
  })

  it('rejects malformed records instead of silently accepting plaintext credential fields', async () => {
    const context = await contextAt(await freshRoot())
    const plaintext = 'plaintext-in-a-corrupt-record'
    await appendRaw(context, {
      version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
      type: 'enrollment',
      enrollmentProviderName,
      state: 'issued',
      binding,
      generation: 1,
      credentialDigest: sha256(plaintext),
      issuedAt: 1,
      credential: plaintext,
    })

    const failure = await EnrollmentLedger.open(context, { enrollmentProviderName, recoveryPageSize: 8 }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ code: 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED' })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain(plaintext)
  })

  it('rejects unsupported record formats and non-monotonic persisted generations', async () => {
    const unsupportedContext = await contextAt(await freshRoot())
    await appendRaw(unsupportedContext, {
      version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION + 1,
      type: 'enrollment',
      enrollmentProviderName,
      state: 'issued',
      binding,
      generation: 1,
      credentialDigest: sha256('unsupported'),
      issuedAt: 1,
    })
    await expect(EnrollmentLedger.open(unsupportedContext, { enrollmentProviderName, recoveryPageSize: 8 })).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_LEDGER_UNSUPPORTED_RECORD',
    })

    const malformedContext = await contextAt(await freshRoot())
    await appendRaw(malformedContext, {
      version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
      type: 'enrollment',
      enrollmentProviderName,
      state: 'issued',
      binding,
      generation: 2,
      credentialDigest: sha256('generation-gap'),
      issuedAt: 1,
    })
    await expect(EnrollmentLedger.open(malformedContext, { enrollmentProviderName, recoveryPageSize: 8 })).rejects.toMatchObject({
      code: 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED',
    })
  })
})

/** Mount one independent durable storage-log context. */
async function contextAt(root: string, backend: StorageBackend = 'json'): Promise<Context> {
  const context = new Context()
  contexts.add(context)
  await context.plugin(Storage)
  if (backend === 'json') {
    await context.plugin(StorageJson, { root })
  } else {
    await context.plugin(StorageSqlite, { path: join(root, 'enrollment.sqlite') })
  }
  await context.plugin(StorageLog, { backend, routes: {} })
  return context
}

/** Release an explicitly restarted context before opening the same JSON root again. */
async function dispose(context: Context): Promise<void> {
  contexts.delete(context)
  await context.fiber.dispose()
}

/** Read the retained durable records after its ledger handle has closed. */
async function readRecords(context: Context): Promise<readonly unknown[]> {
  const stream = await context.storageLog.open(enrollmentLedgerStream(enrollmentProviderName))
  try {
    return (await stream.read(-1, 32)).map(entry => entry.value)
  } finally {
    await stream.close()
  }
}

/** Append one raw test record through the same routed storage-log facility. */
async function appendRaw(context: Context, record: unknown): Promise<void> {
  const stream = await context.storageLog.open(enrollmentLedgerStream(enrollmentProviderName))
  try {
    await stream.append(-1, [record])
  } finally {
    await stream.close()
  }
}

/** Create an isolated durable root under the repository-local temporary directory. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-link-websocket-enrollment-'))
  roots.push(root)
  return root
}

/** Compute the expected storage-safe credential representation. */
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
