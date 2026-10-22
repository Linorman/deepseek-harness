/** Harbor's exact external-owner archive contract, installed by the trusted deployment plugin. */
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { WorldExternalArchiveProvider, WorldExternalArchiveSource } from '@clocky/clocky-simulation-team'
type LogArchiveLimits = Parameters<WorldExternalArchiveProvider['verify']>[2]
import { HARBOR_CONTRACTS } from './harbor-protocol.ts'
import { harborHash } from './harbor-case.ts'
import { captureHarborBackup, verifyHarborBackup, verifyHarborBackupBindings, restoreHarborBackupStaging } from './harbor-backup.ts'

function limits(input: LogArchiveLimits) {
  return { maxBytes: input.maxBytes, maxFileBytes: input.maxBytes, maxFiles: input.maxEntries }
}
function cut(source: WorldExternalArchiveSource) {
  const snapshot = z.object({ spec: z.object({ runId: z.string() }), revision: z.number().int().nonnegative(),
    world: z.object({ definition: z.object({ operations: z.array(z.looseObject({ domain: z.string() })) }) }),
  }).parse(source.snapshot)
  return { runId: snapshot.spec.runId, nativeRevision: snapshot.revision, nativeHash: harborHash(JSON.stringify(source.native)),
    ownerReferencesHash: harborHash(JSON.stringify(source.references)),
    pins: snapshot.world.definition.operations.filter(pin => pin.domain === 'harbor') }
}
/**
 * Bind capture and restore paths to the deployment; package bytes cannot choose paths or execute a replacement judge.
 * @param root - Source owner's private Harbor root, or the isolated target's configured root.
 * @returns exact provider contract; registration owns its lifetime and Native/Team permissions remain caller-owned.
 */
export function harborArchiveProvider(root: string): WorldExternalArchiveProvider {
  return {
    id: 'clocky.harbor.private-backup/1', pins: HARBOR_CONTRACTS.map(contract => contract.pin),
    async capture(snapshot, source, bound, validate) {
      const binding = cut(source)
      const pins = HARBOR_CONTRACTS.flatMap(contract =>
        binding.pins.some(pin => isDeepStrictEqual(pin, contract.pin)) ? [contract.pin] : [])
      const bundle = await captureHarborBackup(join(root, harborHash(binding.runId)), snapshot, { ...binding, pins },
        limits(bound), validate)
      verifyHarborBackupBindings(bundle, source.snapshot, binding.nativeHash, binding.ownerReferencesHash)
      return z.json().parse(bundle)
    },
    verify(payload, source, bound) {
      const bundle = verifyHarborBackup(payload, limits(bound)), binding = cut(source)
      verifyHarborBackupBindings(bundle, source.snapshot, binding.nativeHash, binding.ownerReferencesHash)
    },
    rebindNativeMigration(payload, source, target, bound) {
      const bundle = verifyHarborBackup(payload, limits(bound)), original = cut(source), next = cut(target)
      verifyHarborBackupBindings(bundle, source.snapshot, original.nativeHash, original.ownerReferencesHash)
      if (!isDeepStrictEqual(source.snapshot, target.snapshot) || !isDeepStrictEqual(original.pins, next.pins)
        || source.native.version !== 101 || target.native.version !== 102) throw new Error('Harbor migration must retain the exact original case cut')
      const { contentHash: _old, ...body } = bundle
      const rebound = { ...body, cut: { ...bundle.cut, nativeHash: next.nativeHash, ownerReferencesHash: next.ownerReferencesHash } }
      const result = verifyHarborBackup({ ...rebound, contentHash: harborHash(JSON.stringify(rebound)) }, limits(bound))
      verifyHarborBackupBindings(result, target.snapshot, next.nativeHash, next.ownerReferencesHash)
      return z.json().parse(result)
    },
    entryCount(payload) {
      const bundle = z.object({ files: z.array(z.object({ path: z.string(), data: z.string() })) }).parse(payload)
      const journal = bundle.files.find(file => file.path === 'output/journal.jsonl')
      return bundle.files.length + (journal === undefined ? 0 : Buffer.from(journal.data, 'base64').toString('utf8').trimEnd().split('\n').length)
    },
    async restore(payload, source, bound) {
      const bundle = verifyHarborBackup(payload, limits(bound)), binding = cut(source)
      verifyHarborBackupBindings(bundle, source.snapshot, binding.nativeHash, binding.ownerReferencesHash)
      const directory = join(root, harborHash(bundle.cut.runId))
      const exists = await lstat(directory).catch((cause: unknown) => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw cause
      })
      if (exists !== undefined) {
        const snapshot = source.snapshot as Parameters<typeof captureHarborBackup>[1]
        const current = await captureHarborBackup(directory, snapshot, bundle.cut, limits(bound), async () => {})
        if (!isDeepStrictEqual(current, bundle)) throw new Error('Restored Harbor provider bytes changed after publication')
        return
      }
      await restoreHarborBackupStaging(bundle, root, limits(bound), new AbortController().signal)
    },
  }
}
