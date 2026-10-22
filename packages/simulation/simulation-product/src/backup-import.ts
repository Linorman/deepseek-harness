import { productWorldBranchBackupCreation } from './experiment-store.ts'
/** Host-only Product backup provenance and isolated paused registration; no browser-selected target factories. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { LogArchiveLimits } from '@clocky/clocky-storage'
import { verifyWorldBackup, restoreWorldBackup } from '@clocky/clocky-simulation-team'
import type { WorldBackupBundle, WorldArchiveRestoreTarget } from '@clocky/clocky-simulation-team'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { foldCreationEntry, simulationCreationEntrySchema } from './creation-book.ts'
import type { SimulationWorldCreation } from './world-creation.ts'

/**
 * Validate source Product frames as provenance before opening a target or granting execution authority.
 * @param bundle - Hash-verified full private backup with its exact original creation frames.
 * @returns original completed World creation; missing or nonterminal originals reject.
 */
export function productWorldBackupCreation(bundle: WorldBackupBundle): SimulationWorldCreation {
  const entries = z.array(simulationCreationEntrySchema).length(2).parse(bundle.productJournal)
  const first = entries[0], last = entries[1]
  if (first?.kind !== 'command/accepted' || first.command.kind !== 'world-create'
    || last?.kind !== 'command/completed' || last.commandId !== first.command.receipt.commandId)
    throw new Error('Product backup requires the exact completed original World creation')
  const state = entries.reduce(foldCreationEntry, { commands: new Map(), creations: new Map() })
  const creation = state.creations.get(first.command.receipt.runId)
  const source = z.object({ spec: z.json(), phase: z.literal('paused') }).parse(bundle.body.snapshot)
  if (creation?.kind !== 'world' || !isDeepStrictEqual(source.spec, creation.record.spec))
    throw new Error('Product backup creation does not match the original Native identity and specification')
  const { kind: _kind, ...original } = creation
  return original
}

/**
 * Resolve the exact original Product creation family without forging a World preflight for an experiment branch.
 * @param bundle - Hash-verified full backup with original creation or branch provenance.
 * @returns Original family-specific descriptor with its actual source principal and Native specification.
 */
export function productWorldBackupDescriptor(bundle: WorldBackupBundle):
SimulationWorldCreation | ReturnType<typeof productWorldBranchBackupCreation> {
  const family = z.object({ family: z.literal('world-branch') }).safeParse(bundle.productJournal)
  return family.success ? productWorldBranchBackupCreation(bundle) : productWorldBackupCreation(bundle)
}

/** Actual isolated Loader composition; every storage root must be beneath the supplied staging directory. */
export interface ProductWorldBackupTarget extends WorldArchiveRestoreTarget {
  /** Product service and authenticated grant routing configured by the target host, not by backup bytes. */
  readonly ctx: Context
}

/**
 * Restore a private Product world and publish only after native validation and paused Product registration.
 * @param text - Complete backup and original creation provenance; no source records are rewritten.
 * @param destination - New absolute target root, or exact successful restore retry.
 * @param limits - Complete package limits.
 * @param cwdMapping - Explicit final host working-directory mapping.
 * @param call - Same authenticated original owner; principal transfer is unsupported.
 * @param prepare - Actual isolated target Loader factory with target-owned provider/preset/credential routing.
 * @param providers - Installed exact external-owner archive contracts for the source package.
 * @returns paused durable receipt path; neither import nor registration starts actors or real effects.
 */
export async function restoreProductWorldBackup(text: string, destination: string, limits: LogArchiveLimits,
  cwdMapping: Readonly<Record<string, string>>, call: AuthenticatedProductCall,
  prepare: (staging: string) => Promise<ProductWorldBackupTarget>,
  providers?: import('@clocky/clocky-simulation-team').WorldExternalArchiveProviders): Promise<string> {
  const bundle = verifyWorldBackup(text, limits, providers), creation = productWorldBackupDescriptor(bundle)
  if (creation.record.ownerPrincipalId !== call.principal.id) throw new Error('Product backup belongs to another authenticated owner')
  return restoreWorldBackup(text, destination, limits, cwdMapping, async (staging) => {
    const target = await prepare(staging)
    return { ctx: target.ctx, native: target.native, owners: target.owners, close: () => target.close(), async validate(body) {
      const anchor = await target.validate(body)
      await target.ctx.simulationAdministration.importPausedBackup(bundle, anchor.checkpointId, call)
      return anchor
    } }
  }, providers)
}
