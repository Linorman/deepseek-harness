/** Provider-independent local directory staging and version-fenced commit transaction. */
import { mkdtemp,rename,rm } from 'node:fs/promises'
import { dirname,join } from 'node:path'
import { TeamError } from '@clocky/clocky-team'
import type { TeamArtifactReference } from '@clocky/clocky-team'
import { sameTeamWorkspaceIntegrationMarker as sameIntegrationMarker,teamWorkspaceIntegrationIdentity,teamWorkspaceSourceIntegrationResult } from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceChangeSet,TeamWorkspaceSourceIntegrateRequest,TeamWorkspaceSourceIntegrateResult } from '@clocky/clocky-team-workspace'
import { applyChanges,copyDirectoryContents,ensureRegularDirectoryPath,pathExists,readLocalIntegrationMarker,writeLocalIntegrationMarker } from './files.ts'

/** Fully resolved provider inputs; target and deterministic sidecar naming remain provider-owned. */
export interface LocalDirectoryIntegrationOptions {
  readonly request: TeamWorkspaceSourceIntegrateRequest
  readonly artifact: TeamArtifactReference
  readonly changeSet: TeamWorkspaceChangeSet
  readonly integrationRoot: string
  readonly targetRoot: string
  readonly markerPathname: string
  readonly backupPathname: string
  readonly markerParentRoot: string
  readonly markerDirectory: string
  readonly stagePrefix: string
  readonly providerName: string
  readonly label: string
  /** Provider-owned content scan and byte bounds for one regular directory. */
  readonly version: (root: string) => Promise<string>
  /** Provider-specific regular-directory assertion and diagnostics. */
  readonly assertDirectory: (root: string) => Promise<void>
}

/** Stage a portable source patch, recheck the target version, and commit or restore its provider-owned backup.
 * @param options - Parsed exact provenance and provider-resolved paths, scanning, and naming.
 * @returns a version-fenced integration or conflict result after cleanup settles.
 */
export async function integrateLocalDirectory(options: LocalDirectoryIntegrationOptions): Promise<TeamWorkspaceSourceIntegrateResult> {
  const { request, artifact, changeSet, integrationRoot, targetRoot, markerPathname, backupPathname,
    providerName, label, version, assertDirectory, markerParentRoot, markerDirectory, stagePrefix } = options
  const currentVersion = await version(targetRoot)
  const previous = await readLocalIntegrationMarker(markerPathname, label)
  if (previous !== undefined) {
    if (!sameIntegrationMarker(previous, request, providerName)) {
      throw new TeamError(`${label} integration marker '${markerPathname}' does not match the current request`, 'TEAM_INVALID_ARGUMENT')
    }
    if (currentVersion === previous.targetVersion) {
      if (request.expectedTarget !== undefined && request.expectedTarget !== previous.expectedVersion) {
        return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
      }
      if (previous.status === 'prepared') {
        await rm(backupPathname, { recursive: true, force: true })
        await writeLocalIntegrationMarker(markerPathname, { ...previous, status: 'integrated' }, label)
      }
      return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: previous.targetVersion, artifact })
    }
    if (previous.status === 'prepared' && currentVersion === previous.expectedVersion) {
      await rm(markerPathname, { force: true })
      await rm(backupPathname, { recursive: true, force: true })
    } else if (previous.status === 'prepared' && currentVersion === 'missing' && await pathExists(backupPathname)) {
      await rename(backupPathname, targetRoot)
      await rm(markerPathname, { force: true })
      return await integrateLocalDirectory(options)
    } else {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
  }
  if (request.expectedTarget !== undefined && request.expectedTarget !== currentVersion) {
    return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
  }
  await ensureRegularDirectoryPath(integrationRoot, dirname(targetRoot), label)
  const stage = await mkdtemp(join(dirname(targetRoot), stagePrefix))
  let targetMoved = false
  let stageMoved = false
  let backup: string | undefined
  try {
    if (await pathExists(targetRoot)) {
      await assertDirectory(targetRoot)
      await copyDirectoryContents(targetRoot, stage)
    }
    await applyChanges(stage, changeSet.changes, label)
    const targetVersion = await version(stage)
    if (await version(targetRoot) !== currentVersion) {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
    await ensureRegularDirectoryPath(markerParentRoot, markerDirectory, label)
    await writeLocalIntegrationMarker(markerPathname, {
      version: 1,
      ...teamWorkspaceIntegrationIdentity(request, providerName),
      expectedVersion: currentVersion,
      targetVersion,
      status: 'prepared',
    }, label)
    if (await pathExists(targetRoot)) {
      backup = backupPathname
      await rm(backup, { recursive: true, force: true })
      await rename(targetRoot, backup)
      targetMoved = true
    }
    await rename(stage, targetRoot)
    stageMoved = true
    await writeLocalIntegrationMarker(markerPathname, {
      version: 1,
      ...teamWorkspaceIntegrationIdentity(request, providerName),
      expectedVersion: currentVersion,
      targetVersion,
      status: 'integrated',
    }, label)
    return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion, artifact })
  } finally {
    const failures: unknown[] = []
    if (!stageMoved) {
      try {
        await rm(stage, { recursive: true, force: true })
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (targetMoved && !stageMoved && backup !== undefined) {
      try {
        if (!(await pathExists(targetRoot))) await rename(backup, targetRoot)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (stageMoved && backup !== undefined) {
      try {
        await rm(backup, { recursive: true, force: true })
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, `team-workspace-${label}: integration cleanup failed`)
  }
}

/** Resolve provider-owned paths only after earlier work on the same integration target has settled.
 * @param queue - Calling provider's independent target-serialization owner.
 * @param request - Exact source and consuming integration attempt.
 * @param artifact - Verified provider-backed source patch reference.
 * @param changeSet - Parsed provenance-bound portable changes.
 * @param resolve - Provider-specific disk naming, scan bounds and directory assertions.
 * @returns the integration result after serialized commit and cleanup settlement.
 */
export function integrateSerializedLocalDirectory(
  queue: Pick<import('@clocky/clocky-team-workspace').TeamWorkspaceIntegrationQueue,'run'>,
  request: TeamWorkspaceSourceIntegrateRequest, artifact: TeamArtifactReference, changeSet: TeamWorkspaceChangeSet,
  resolve: () => Omit<LocalDirectoryIntegrationOptions,'request'|'artifact'|'changeSet'>,
): Promise<TeamWorkspaceSourceIntegrateResult> {
  return queue.run(request.target, async () => await integrateLocalDirectory({ ...resolve(), request, artifact, changeSet }))
}
