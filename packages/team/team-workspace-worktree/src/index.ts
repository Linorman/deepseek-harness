/**
 * Detached Git-worktree Team workspace provider for exact local-Agent task attempts.
 *
 * This provider owns only a per-attempt checkout and normal Git removal. Its
 * report-only path never makes commits, merges, pushes, or changes Team state;
 * an explicit opt-in integration path uses a detached temporary worktree and
 * compare-and-set target ref update. Scheduler write scopes never become
 * filesystem locks.
 *
 * @module @clocky/clocky-team-workspace-worktree
 */

import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-artifact'
import { TeamError, teamWorkspaceAllocationIdSchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamStateSnapshot,
  TeamTaskSnapshot,
  TeamArtifactReference,
} from '@clocky/clocky-team'
import type { SubprocessHandle, SubprocessRuntime } from '@clocky/clocky-subprocess'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspaceEligibilityRequest,
  TeamWorkspacePreflightRequest,
  TeamWorkspacePreparation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspacePublishRequest,
  TeamWorkspacePublishResult,
  TeamWorkspaceIntegrateRequest,
  TeamWorkspaceIntegrateResult,
  TeamWorkspaceSourceIntegrateRequest,
  TeamWorkspaceSourceIntegrateResult,
} from '@clocky/clocky-team-workspace'
import {
  selectTeamWorkspacePatchArtifact,
  teamWorkspaceSourceIntegrationResult,
} from '@clocky/clocky-team-workspace'
import { deadline, MAX_TIMER_DELAY_MS } from '@clocky/clocky-timeout'

/** Cordis plugin name. */
export const name = 'team-workspace-worktree'
/** Workspace registry, Team authority, live local Agents, and Git execution must exist before allocation. */
export const inject = ['teamWorkspaces', 'teams', 'agents', 'subprocess']

/** Detached local Git-worktree provider configuration. Every deployment choice is explicit. */
export interface Config {
  /** Registry identity used for diagnostics and HMR-safe provider replacement. */
  readonly providerName: string
  /** Absolute existing Git worktree root that must resolve to the repository top-level. */
  readonly repoRoot: string
  /** Absolute existing directory that receives only provider-minted attempt worktrees. */
  readonly allocationParent: string
  /** Git revision expression resolved to one detached base commit at mount. */
  readonly baseRef: string
  /** Absolute Git executable or bare executable name resolved through the subprocess provider. */
  readonly gitExecutable: string
  /** TERM-to-KILL grace supplied to each finite Git command. */
  readonly processGraceMs: number
  /** Maximum wall time for one Git command, including full process-tree termination after expiry. */
  readonly commandTimeoutMs: number
  /** Maximum stdout or stderr bytes retained from one Git command. */
  readonly outputMaxBytes: number
  /** Optional provider name used to persist bounded artifact bytes. */
  readonly artifactProvider?: string
  /** Explicitly enables this provider's repository integration authority. */
  readonly integrationEnabled?: boolean
  /** Commit author name used only when explicit integration is enabled. */
  readonly integrationAuthorName?: string
  /** Commit author email used only when explicit integration is enabled. */
  readonly integrationAuthorEmail?: string
}

/** Schemastery validator for {@link Config}; filesystem and Git checks run during mounting. */
export const Config: z<Config> = z.object({
  providerName: z.string(),
  repoRoot: z.string(),
  allocationParent: z.string(),
  baseRef: z.string(),
  gitExecutable: z.string(),
  processGraceMs: z.number(),
  commandTimeoutMs: z.number(),
  outputMaxBytes: z.number(),
  artifactProvider: z.string().min(1),
  integrationEnabled: z.boolean().default(false),
  integrationAuthorName: z.string().min(1).default('Clocky Team'),
  integrationAuthorEmail: z.string().min(1).default('clocky-team@localhost'),
})

/** Immutable mount-time facts used by one provider instance. */
interface ResolvedConfig {
  /** Registry identity selected by deployment configuration. */
  readonly providerName: string
  /** Canonical main Git worktree root. */
  readonly repoRoot: string
  /** Canonical parent that contains provider-minted worktree directories. */
  readonly allocationParent: string
  /** User-selected revision expression retained for policy diagnostics. */
  readonly baseRef: string
  /** Commit object resolved from {@link baseRef} before provider publication. */
  readonly baseCommit: string
  /** Canonical executable supplied by the subprocess provider. */
  readonly gitExecutable: string
  /** Explicit Git process termination grace. */
  readonly processGraceMs: number
  /** Explicit wall-time limit for one complete Git command lifecycle. */
  readonly commandTimeoutMs: number
  /** Explicit bounded diagnostic retention for each Git command. */
  readonly outputMaxBytes: number
  /** Optional artifact provider selected by deployment composition. */
  readonly artifactProvider?: string
  /** Whether explicit integration may update an unoccupied target branch. */
  readonly integrationEnabled: boolean
  /** Explicit commit author name for integration commits. */
  readonly integrationAuthorName: string
  /** Explicit commit author email for integration commits. */
  readonly integrationAuthorEmail: string
}

/** Provider-local failure carrying bounded Git diagnostics. */
class GitCommandError extends Error {
  /**
   * @param args - Git arguments after the configured executable.
   * @param exitCode - process exit code, or `null` when a signal ended it.
   * @param signal - terminating signal, when any.
   * @param stderr - bounded diagnostic stderr text.
   */
  constructor(
    args: readonly string[],
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderr: string,
  ) {
    const rendered = stderr.trim()
    super(
      `team-workspace-worktree: git ${args.join(' ')} failed with ${exitCode === null ? signal ?? 'unknown signal' : `exit ${exitCode}`}`
      + (rendered.length === 0 ? '' : `: ${rendered}`),
    )
    this.name = 'GitCommandError'
  }
}

/** Serialize allocation and release transitions for one exact attempt identity. */
class AttemptOperationQueue {
  private tail = Promise.resolve()
  private pending = 0

  /** Queue one operation after every earlier operation for this attempt. */
  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.pending += 1
    const prior = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await prior
    try {
      return await operation()
    } finally {
      release()
      this.pending -= 1
    }
  }

  /** Return whether no queued or active operation remains. */
  get idle(): boolean {
    return this.pending === 0
  }
}

/** Local provider that creates one detached worktree for each exact current attempt. */
class WorktreeTeamWorkspaceProvider implements TeamWorkspaceProvider {
  readonly modes = ['worktree'] as const
  /** Root-less provider reservations keyed by exact immutable lease ownership. */
  private readonly preparations = new Map<string, TeamWorkspacePreparation>()
  /** In-flight or published allocation per complete lease and activation identity. */
  private readonly allocations = new Map<string, Promise<TeamWorkspaceAllocation>>()
  /** One operation queue per exact attempt identity. */
  private readonly operations = new Map<string, AttemptOperationQueue>()
  /** Last unsuccessful normal removal; later allocation requires the caller to resolve or retry it. */
  private readonly releaseFailures = new Map<string, unknown>()

  /**
   * @param ctx - context carrying Team authority, live Agents, and subprocess execution.
   * @param config - canonical immutable mount-time configuration.
   * @param subprocess - live subprocess capability retained for accepted-handle release after provider unregistration.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly subprocess: SubprocessRuntime,
  ) {}

  /** Registry identity selected at mount. */
  get name(): string {
    return this.config.providerName
  }

  /**
   * Check mounted repository and allocation roots before activating a Participant.
   * @param request - task, active Participant, and candidate runtime route.
   * @returns whether this worktree deployment can accept the task mode.
   */
  async preflight(request: TeamWorkspacePreflightRequest): Promise<boolean> {
    return request.task.workspaceMode === 'worktree'
      && request.participant.phase === 'active'
      && await rootsRemainAvailable(this.config)
  }

  /**
   * Report whether one scheduler candidate remains eligible for a worktree.
   * @param request - candidate task and activation binding.
   * @returns false for stale Team facts, non-worktree tasks, unavailable roots, or absent local Agents.
   */
  async eligible(request: TeamWorkspaceEligibilityRequest): Promise<boolean> {
    if (request.task.workspaceMode !== 'worktree') return false
    if (!(await rootsRemainAvailable(this.config))) return false
    const state = await this.ctx.teams.getTeam({ teamId: request.task.teamId })
    return this.isEligibleState(state, request.task, request.binding)
      && this.hasExactLiveAgent(request.binding)
  }

  /**
   * Reserve deterministic provider metadata before the Team owner binds it.
   * @param request - Team, task, lease, participant, activation, and Session fences.
   * @returns a root-less reservation that creates its worktree only after binding.
   */
  async prepare(request: TeamWorkspacePrepareRequest): Promise<TeamWorkspacePreparation> {
    const key = allocationKey(request)
    const root = allocationRoot(this.config.allocationParent, key)
    await this.assertCurrentAllocation(request, root)
    const existing = this.preparations.get(key)
    if (existing !== undefined) return existing
    const metadata = this.metadata(request)
    let abandoned = false
    const preparation: TeamWorkspacePreparation = Object.freeze({
      ...metadata,
      materialize: async (): Promise<TeamWorkspaceAllocation> => {
        if (abandoned) throw new TeamError(`worktree allocation '${metadata.id}' was abandoned`, 'TEAM_INVALID_ARGUMENT')
        return await this.materializePrepared(request, metadata, key, root)
      },
      abandon: (): Promise<void> => {
        if (abandoned) return Promise.resolve()
        abandoned = true
        if (this.preparations.get(key) === preparation) this.preparations.delete(key)
        return Promise.resolve()
      },
    })
    this.preparations.set(key, preparation)
    return preparation
  }

  /** Reopen a provider-minted worktree only from exact durable metadata. */
  async restore(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<TeamWorkspaceAllocation> {
    const expected = this.metadata(request)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`worktree allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const key = allocationKey(request)
    const root = allocationRoot(this.config.allocationParent, key)
    return await this.serialize(key, async () => {
      if (this.releaseFailures.has(key)) throw this.releaseFailures.get(key)
      const existing = this.allocations.get(key)
      if (existing !== undefined) {
        await this.assertCurrentAllocation(request, root)
        return await existing
      }
      await this.assertCurrentAllocation(request, root)
      const restoredRoot = await this.findRestorableWorktree(root)
      if (restoredRoot === undefined) return await this.materializeOwned(request, metadata, key, root)
      const restored = this.createHandle(metadata, key, restoredRoot)
      const accepted = Promise.resolve(restored)
      this.allocations.set(key, accepted)
      return restored
    })
  }

  /** Prove or complete physical worktree cleanup without materializing a new root. */
  async reconcileRelease(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
  ): Promise<void> {
    const expected = this.metadata(request)
    if (!sameMetadata(metadata, expected)) {
      throw new TeamError(`worktree allocation '${metadata.id}' is not owned by this provider`, 'TEAM_INVALID_ARGUMENT')
    }
    const key = allocationKey(request)
    const root = allocationRoot(this.config.allocationParent, key)
    const live = this.allocations.get(key)
    if (live !== undefined) {
      await (await live).release()
      return
    }
    await this.serialize(key, async () => {
      if (this.allocations.has(key)) throw new TeamError(`worktree allocation '${metadata.id}' became live during release reconciliation`, 'TEAM_INVALID_ARGUMENT')
      const existing = await this.findRestorableWorktree(root)
      if (existing === undefined) {
        this.preparations.delete(key)
        this.releaseFailures.delete(key)
        return
      }
      try {
        await this.removeWorktree(existing)
        this.preparations.delete(key)
        this.releaseFailures.delete(key)
      } catch (error: unknown) {
        this.releaseFailures.set(key, error)
        throw error
      }
    })
  }

  /**
   * Inspect one owned worktree and return a bounded change manifest. Git
   * integration remains a separate explicit operation; this report path never
   * changes a branch and always returns `accepted: false`.
   * @param request - allocation identity and optional integration target.
   * @returns changed paths and provider-owned artifact ids, without mutating Git.
   */
  async publish(request: TeamWorkspacePublishRequest): Promise<TeamWorkspacePublishResult> {
    const allocation = await this.ownedAllocation(request.allocation)
    const diff = await materializeWorktreeDiff(this.ctx.subprocess, this.config, allocation.root, allocation.baseVersion)
    const changedPaths = diff.changedPaths
    const artifactStore = this.ctx.get('teamArtifacts')
    const artifacts = [...await materializeArtifacts(
      allocation,
      changedPaths,
      this.config.outputMaxBytes,
      artifactStore,
      this.config.artifactProvider,
    )]
    if (artifactStore !== undefined && this.config.artifactProvider !== undefined) {
      const patch = diff.patch
      if (patch.length > 0) {
        artifacts.push(await artifactStore.save(this.config.artifactProvider, {
          teamId: allocation.teamId,
          sourceAttemptId: allocation.attemptId,
          kind: 'patch',
          visibility: 'team',
          name: `task-${String(allocation.taskId)}-${String(allocation.attemptId)}.patch`,
          data: patch,
        }))
      }
    }
    return {
      teamId: allocation.teamId,
      taskId: allocation.taskId,
      attemptId: allocation.attemptId,
      changedPaths,
      artifacts,
      accepted: false,
    }
  }

  /**
   * Materialize an explicit reviewable integration proposal for one owned
   * worktree, or run the opt-in repository integration authority. Integration
   * always happens in a detached temporary worktree and updates the target
   * branch with an expected-value ref compare-and-set; the caller's checkout
   * and dirty files are never mutated.
   * @param request - exact allocation, target, optional actor, and operation mode.
   * @returns a patch-backed proposal or an explicit policy rejection.
   */
  async integrate(request: TeamWorkspaceIntegrateRequest): Promise<TeamWorkspaceIntegrateResult> {
    if (request.target.length === 0 || request.target.trim() !== request.target) {
      throw new TeamError('worktree integration target must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
    }
    const allocation = await this.ownedAllocation(request.allocation)
    if (request.mode === 'integrate') {
      const decision = await this.ctx.teams.authorize({
        hook: 'workspace-integrate',
        teamId: allocation.teamId,
        ...request.actorId === undefined ? {} : { actorId: request.actorId },
        facts: {
          taskId: allocation.taskId,
          attemptId: allocation.attemptId,
          target: request.target,
          ...request.expectedTarget === undefined ? {} : { expectedTarget: request.expectedTarget },
          mode: request.mode,
          root: allocation.root,
        },
      })
      if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
      if (!this.config.integrationEnabled) {
        throw new TeamError(
          'worktree integration authority is disabled by configuration',
          'TEAM_POLICY_DENIED',
        )
      }
      return await this.integrateOwned(request, allocation)
    }
    const published = await this.publish({ allocation, target: request.target })
    const artifact = published.artifacts.find(candidate => candidate.kind === 'patch')
    return {
      teamId: allocation.teamId,
      taskId: allocation.taskId,
      attemptId: allocation.attemptId,
      target: request.target,
      status: 'proposed',
      accepted: true,
      ...artifact === undefined ? {} : { artifact },
    }
  }

  /**
   * Integrate one completed source attempt from its provider-owned patch
   * artifact, without requiring the source Agent allocation to remain live.
   * @param request - source provenance, integration attempt, target fence, and mode.
   * @returns provider-owned source and integration provenance.
   */
  async integrateSource(request: TeamWorkspaceSourceIntegrateRequest): Promise<TeamWorkspaceSourceIntegrateResult> {
    if (request.source.teamId.length === 0
      || request.source.taskId.length === 0
      || request.source.attemptId.length === 0
      || request.integrationTaskId.length === 0
      || request.integrationAttemptId.length === 0) {
      throw new TeamError('worktree source integration identities must be non-empty', 'TEAM_INVALID_ARGUMENT')
    }
    if (request.target.length === 0 || request.target.trim() !== request.target) {
      throw new TeamError('worktree integration target must be non-empty without surrounding whitespace', 'TEAM_INVALID_ARGUMENT')
    }
    const artifact = selectTeamWorkspacePatchArtifact(request)
    const decision = await this.ctx.teams.authorize({
      hook: 'workspace-integrate',
      teamId: request.source.teamId,
      ...request.actorId === undefined ? {} : { actorId: request.actorId },
      facts: {
        operation: 'source-integration',
        sourceTaskId: request.source.taskId,
        sourceAttemptId: request.source.attemptId,
        integrationTaskId: request.integrationTaskId,
        integrationAttemptId: request.integrationAttemptId,
        target: request.target,
        ...request.expectedTarget === undefined ? {} : { expectedTarget: request.expectedTarget },
        mode: request.mode,
      },
    })
    if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
    if (request.mode === 'proposal') {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'proposed', artifact })
    }
    if (!this.config.integrationEnabled) {
      throw new TeamError(
        'worktree source integration authority is disabled by configuration',
        'TEAM_POLICY_DENIED',
      )
    }
    const store = this.ctx.get('teamArtifacts')
    if (store === undefined || this.config.artifactProvider === undefined) {
      throw new TeamError(
        'worktree source integration requires a configured artifact provider',
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const patch = await store.read(this.config.artifactProvider, { reference: artifact })
    if (patch.byteLength === 0 || patch.byteLength > this.config.outputMaxBytes) {
      throw new TeamError(
        `source patch artifact '${artifact.id}' is empty or exceeds the configured integration size`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    return await this.integrateSourcePatch(request, artifact, patch)
  }

  /** Apply one verified source patch in a detached target worktree and CAS the target ref. */
  private async integrateSourcePatch(
    request: TeamWorkspaceSourceIntegrateRequest,
    artifact: TeamArtifactReference,
    patch: Uint8Array,
  ): Promise<TeamWorkspaceSourceIntegrateResult> {
    const targetRef = await resolveTargetRef(this.subprocess, this.config, this.config.repoRoot, request.target)
    const targetCommit = (await runGit(this.subprocess, this.config, this.config.repoRoot, [
      '-C', this.config.repoRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${targetRef}^{commit}`,
    ])).trim()
    const commitMessage = sourceIntegrationCommitMessage(request)
    const prior = await findIntegrationCommit(this.subprocess, this.config, this.config.repoRoot, targetRef, commitMessage)
    if (prior !== undefined) return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: prior, artifact })
    if (request.expectedTarget !== undefined && request.expectedTarget !== targetCommit) {
      return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
    }
    await assertTargetNotCheckedOut(this.subprocess, this.config, this.config.repoRoot, targetRef)
    const patchPath = join(this.config.allocationParent, `.clocky-team-source-patch-${randomUUID()}`)
    const integrationRoot = join(this.config.allocationParent, `clocky-team-source-integration-${randomUUID()}`)
    let worktreeAdded = false
    try {
      await assertPathAbsent(patchPath)
      await writeFile(patchPath, patch, { flag: 'wx', mode: 0o600 })
      await assertPathAbsent(integrationRoot)
      await runGit(this.subprocess, this.config, this.config.repoRoot, [
        '-C', this.config.repoRoot, 'worktree', 'add', '--detach', integrationRoot, targetCommit,
      ])
      worktreeAdded = true
      try {
        await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot, 'apply', '--3way', '--index', '--whitespace=nowarn', patchPath,
        ])
      } catch (error: unknown) {
        const conflicts = parseNulPaths(await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot, 'diff', '--name-only', '--diff-filter=U', '-z',
        ]).catch(() => ''))
        await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot, 'reset', '--hard', targetCommit,
        ]).catch(() => '')
        if (conflicts.length > 0) return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact, conflictPaths: conflicts })
        throw error
      }
      await runGit(this.subprocess, this.config, integrationRoot, [
        '-C', integrationRoot,
        '-c', `user.name=${this.config.integrationAuthorName}`,
        '-c', `user.email=${this.config.integrationAuthorEmail}`,
        '-c', 'commit.gpgSign=false',
        '-c', 'core.hooksPath=/dev/null',
        'commit', '-m', commitMessage,
      ])
      const integratedCommit = (await runGit(this.subprocess, this.config, integrationRoot, [
        '-C', integrationRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}',
      ])).trim()
      try {
        await runGit(this.subprocess, this.config, this.config.repoRoot, [
          '-C', this.config.repoRoot, 'update-ref', targetRef, integratedCommit, targetCommit,
        ])
      } catch (error: unknown) {
        const observed = await findIntegrationCommit(this.subprocess, this.config, this.config.repoRoot, targetRef, commitMessage)
        if (observed !== undefined) return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: observed, artifact })
        const current = await runGit(this.subprocess, this.config, this.config.repoRoot, [
          '-C', this.config.repoRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${targetRef}^{commit}`,
        ]).catch(() => '')
        if (current.trim() !== targetCommit) return teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', artifact })
        throw error
      }
      return teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: integratedCommit, artifact })
    } finally {
      const failures: unknown[] = []
      if (worktreeAdded) {
        try {
          await runGit(this.subprocess, this.config, this.config.repoRoot, [
            '-C', this.config.repoRoot, 'worktree', 'remove', '--force', integrationRoot,
          ])
        } catch (error: unknown) {
          failures.push(error)
        }
      } else {
        try {
          await rm(integrationRoot, { recursive: true, force: true })
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      try {
        await rm(patchPath, { force: true })
      } catch (error: unknown) {
        failures.push(error)
      }
      if (failures.length > 0) throw new AggregateError(failures, 'team-workspace-worktree: source integration cleanup failed')
    }
  }

  /**
   * Integrate one clean Team worktree through an explicit detached merge.
   * The source tree is first represented by a temporary index and commit, so
   * the task worktree is never staged or committed. The target ref is updated
   * with Git's expected-old-value compare-and-set after conflict checks.
   */
  private async integrateOwned(
    request: TeamWorkspaceIntegrateRequest,
    allocation: TeamWorkspaceAllocation,
  ): Promise<TeamWorkspaceIntegrateResult> {
    const published = await this.publish({ allocation, target: request.target })
    const artifact = published.artifacts.find(candidate => candidate.kind === 'patch')
    const targetRef = await resolveTargetRef(this.subprocess, this.config, this.config.repoRoot, request.target)
    const targetCommit = await runGit(this.subprocess, this.config, this.config.repoRoot, [
      '-C', this.config.repoRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${targetRef}^{commit}`,
    ])
    const expectedTarget = request.expectedTarget
    if (expectedTarget !== undefined && expectedTarget !== targetCommit.trim()) {
      return this.reportIntegrationConflict(allocation, request.target, artifact)
    }
    const sourceHead = (await runGit(this.subprocess, this.config, allocation.root, [
      '-C', allocation.root, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}',
    ])).trim()
    if (sourceHead !== this.config.baseCommit) {
      throw new TeamError(
        `worktree allocation '${allocation.attemptId}' changed its base commit before integration`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const sourceIndex = join(this.config.allocationParent, `.clocky-team-index-${randomUUID()}`)
    const integrationRoot = join(this.config.allocationParent, `clocky-team-integration-${randomUUID()}`)
    let worktreeAdded = false
    try {
      const indexEnv = { GIT_INDEX_FILE: sourceIndex }
      const baseTree = (await runGit(this.subprocess, this.config, allocation.root, [
        '-C', allocation.root, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${this.config.baseCommit}^{tree}`,
      ])).trim()
      await runGit(this.subprocess, this.config, allocation.root, [
        '-C', allocation.root, 'read-tree', this.config.baseCommit,
      ], undefined, indexEnv)
      await runGit(this.subprocess, this.config, allocation.root, [
        '-C', allocation.root, 'add', '--all', '--', '.',
      ], undefined, indexEnv)
      const sourceTree = (await runGit(this.subprocess, this.config, allocation.root, [
        '-C', allocation.root, 'write-tree',
      ], undefined, indexEnv)).trim()
      if (sourceTree === baseTree) {
        return {
          teamId: allocation.teamId,
          taskId: allocation.taskId,
          attemptId: allocation.attemptId,
          target: request.target,
          status: 'integrated',
          accepted: true,
          targetVersion: targetCommit.trim(),
          ...artifact === undefined ? {} : { artifact },
        }
      }
      const sourceCommit = (await runGit(this.subprocess, this.config, allocation.root, [
        '-C', allocation.root, 'commit-tree', sourceTree, '-p', this.config.baseCommit,
        '-m', `Clocky Team task ${String(allocation.taskId)} attempt ${String(allocation.attemptId)}`,
      ], undefined, {
        ...indexEnv,
        GIT_AUTHOR_NAME: this.config.integrationAuthorName,
        GIT_AUTHOR_EMAIL: this.config.integrationAuthorEmail,
        GIT_COMMITTER_NAME: this.config.integrationAuthorName,
        GIT_COMMITTER_EMAIL: this.config.integrationAuthorEmail,
      })).trim()
      await assertTargetNotCheckedOut(this.subprocess, this.config, this.config.repoRoot, targetRef)
      await assertPathAbsent(integrationRoot)
      await runGit(this.subprocess, this.config, this.config.repoRoot, [
        '-C', this.config.repoRoot, 'worktree', 'add', '--detach', integrationRoot, targetCommit.trim(),
      ])
      worktreeAdded = true
      try {
        await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot,
          '-c', `user.name=${this.config.integrationAuthorName}`,
          '-c', `user.email=${this.config.integrationAuthorEmail}`,
          '-c', 'commit.gpgSign=false',
          '-c', 'core.hooksPath=/dev/null',
          'merge', '--no-ff', '--no-commit', sourceCommit,
        ])
      } catch (error: unknown) {
        const conflicts = parseNulPaths(await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot, 'diff', '--name-only', '--diff-filter=U', '-z',
        ]).catch(() => ''))
        await runGit(this.subprocess, this.config, integrationRoot, [
          '-C', integrationRoot, 'merge', '--abort',
        ]).catch(() => '')
        if (conflicts.length > 0) return this.reportIntegrationConflict(allocation, request.target, artifact, conflicts)
        throw error
      }
      const commitMessage = `Integrate Clocky Team task ${String(allocation.taskId)} attempt ${String(allocation.attemptId)}`
      await runGit(this.subprocess, this.config, integrationRoot, [
        '-C', integrationRoot,
        '-c', `user.name=${this.config.integrationAuthorName}`,
        '-c', `user.email=${this.config.integrationAuthorEmail}`,
        '-c', 'commit.gpgSign=false',
        '-c', 'core.hooksPath=/dev/null',
        'commit', '--no-edit', '-m', commitMessage,
      ])
      const integratedCommit = (await runGit(this.subprocess, this.config, integrationRoot, [
        '-C', integrationRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}',
      ])).trim()
      try {
        await runGit(this.subprocess, this.config, this.config.repoRoot, [
          '-C', this.config.repoRoot, 'update-ref', targetRef, integratedCommit, targetCommit.trim(),
        ])
      } catch (error: unknown) {
        const observedTarget = await runGit(this.subprocess, this.config, this.config.repoRoot, [
          '-C', this.config.repoRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${targetRef}^{commit}`,
        ]).catch(() => '')
        if (observedTarget.trim() !== targetCommit.trim()) {
          return this.reportIntegrationConflict(allocation, request.target, artifact)
        }
        throw error
      }
      return {
        teamId: allocation.teamId,
        taskId: allocation.taskId,
        attemptId: allocation.attemptId,
        target: request.target,
        status: 'integrated',
        accepted: true,
        targetVersion: integratedCommit,
        ...artifact === undefined ? {} : { artifact },
      }
    } finally {
      const failures: unknown[] = []
      if (worktreeAdded) {
        try {
          await runGit(this.subprocess, this.config, this.config.repoRoot, [
            '-C', this.config.repoRoot, 'worktree', 'remove', integrationRoot,
          ])
        } catch (error: unknown) {
          failures.push(error)
        }
      } else {
        try {
          await rm(integrationRoot, { recursive: true, force: true })
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      try {
        await rm(sourceIndex, { force: true })
        await rm(`${sourceIndex}.lock`, { force: true })
      } catch (error: unknown) {
        failures.push(error)
      }
      if (failures.length > 0) throw new AggregateError(failures, 'team-workspace-worktree: integration cleanup failed')
    }
  }

  /** Count a provider-owned conflict without changing the target ref. */
  private reportIntegrationConflict(
    allocation: TeamWorkspaceAllocation,
    target: string,
    artifact: TeamArtifactReference | undefined,
    conflictPaths: readonly string[] = [],
  ): TeamWorkspaceIntegrateResult {
    this.ctx.teams.reportWorkspaceConflict()
    return integrationConflict(allocation, target, artifact, conflictPaths)
  }

  /** Resolve one allocation only when this provider instance still owns it. */
  private async ownedAllocation(request: TeamWorkspaceAllocation): Promise<TeamWorkspaceAllocation> {
    for (const candidate of this.allocations.values()) {
      const allocation = await candidate
      if (allocation.teamId !== request.teamId
        || allocation.taskId !== request.taskId
        || allocation.attemptId !== request.attemptId
        || allocation.assignedRevision !== request.assignedRevision) continue
      if (!sameMetadata(allocation, request) || allocation.root !== request.root) {
        throw new TeamError(`worktree allocation '${request.attemptId}' does not match the provider owner`, 'TEAM_INVALID_ARGUMENT')
      }
      return allocation
    }
    throw new TeamError(`worktree allocation for task attempt '${request.attemptId}' is not live`, 'TEAM_INVALID_ARGUMENT')
  }

  /** Serialize one allocation or release transition without retaining idle attempt queues. */
  private async serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const queue = this.operations.get(key) ?? new AttemptOperationQueue()
    this.operations.set(key, queue)
    try {
      return await queue.run(operation)
    } finally {
      if (queue.idle && this.operations.get(key) === queue) this.operations.delete(key)
    }
  }

  /** Materialize one root-less reservation while serializing its exact attempt identity. */
  private async materializePrepared(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): Promise<TeamWorkspaceAllocation> {
    return await this.serialize(key, async () => await this.materializeOwned(request, metadata, key, root))
  }

  /** Materialize one prepared root while the exact attempt queue is already held. */
  private async materializeOwned(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): Promise<TeamWorkspaceAllocation> {
    if (this.releaseFailures.has(key)) throw this.releaseFailures.get(key)
    const existing = this.allocations.get(key)
    if (existing !== undefined) {
      await this.assertCurrentAllocation(request, root)
      return await existing
    }
    const creating = this.createAllocation(request, metadata, key, root)
    this.allocations.set(key, creating)
    try {
      return await creating
    } catch (error: unknown) {
      if (this.allocations.get(key) === creating) this.allocations.delete(key)
      throw error
    }
  }

  /** Create and publish a provider-owned Git worktree after the final owner and policy check. */
  private async createAllocation(
    request: TeamWorkspacePrepareRequest,
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): Promise<TeamWorkspaceAllocation> {
    await assertPathAbsent(root)
    await this.assertCurrentAllocation(request, root)
    await runGit(this.ctx.subprocess, this.config, this.config.repoRoot, [
      '-C', this.config.repoRoot, 'worktree', 'add', '--detach', root, this.config.baseCommit,
    ])
    let canonicalRoot = root
    try {
      canonicalRoot = await canonicalWorktreeRoot(this.config.allocationParent, root)
      await this.assertCurrentAllocation(request, canonicalRoot)
    } catch (error: unknown) {
      try {
        await this.removeWorktree(canonicalRoot)
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'team-workspace-worktree: created worktree verification cleanup failed')
      }
      throw error
    }
    return this.createHandle(metadata, key, canonicalRoot)
  }

  /** Construct one immutable allocation with retryable normal Git removal. */
  private createHandle(
    metadata: TeamWorkspaceAllocationMetadata,
    key: string,
    root: string,
  ): TeamWorkspaceAllocation {
    let released = false
    let releasing: Promise<void> | undefined
    const release = (): Promise<void> => {
      if (released) return Promise.resolve()
      if (releasing !== undefined) return releasing
      const operation = (async () => {
        try {
          await this.serialize(key, async () => {
            try {
              await this.removeWorktree(root)
              released = true
              this.releaseFailures.delete(key)
              this.allocations.delete(key)
              this.preparations.delete(key)
            } catch (error: unknown) {
              this.releaseFailures.set(key, error)
              throw error
            }
          })
        } finally {
          releasing = undefined
        }
      })()
      releasing = operation
      return operation
    }
    return Object.freeze({
      ...metadata,
      root,
      release,
    })
  }

  /** Normal Git removal deliberately refuses a dirty worktree and leaves its allocation retryable. */
  private async removeWorktree(root: string): Promise<void> {
    await runGit(this.subprocess, this.config, this.config.repoRoot, [
      '-C', this.config.repoRoot, 'worktree', 'remove', root,
    ])
  }

  /** Locate only the exact provider-derived worktree that durable metadata names. */
  private async findRestorableWorktree(root: string): Promise<string | undefined> {
    let canonicalRoot: string
    try {
      canonicalRoot = await canonicalWorktreeRoot(this.config.allocationParent, root)
    } catch (error: unknown) {
      if (isMissingPath(error)) return undefined
      throw error
    }
    const head = (await runGit(this.subprocess, this.config, canonicalRoot, [
      '-C', canonicalRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}',
    ])).trim()
    if (head !== this.config.baseCommit) {
      throw new TeamError(
        `worktree allocation '${canonicalRoot}' does not retain provider base '${this.config.baseCommit}'`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const worktrees = await runGit(this.subprocess, this.config, this.config.repoRoot, [
      '-C', this.config.repoRoot, 'worktree', 'list', '--porcelain',
    ])
    if (!worktrees.split('\n').some(line => line === `worktree ${canonicalRoot}`)) {
      throw new TeamError(`worktree allocation '${canonicalRoot}' is not registered by Git`, 'TEAM_INVALID_ARGUMENT')
    }
    return canonicalRoot
  }

  /** Recheck current durable ownership, live locality, roots, and policy before any Git mutation. */
  private async assertCurrentAllocation(request: TeamWorkspacePrepareRequest, root: string): Promise<void> {
    if (!(await rootsRemainAvailable(this.config))) {
      throw new TeamError('worktree Team workspace repository root or allocation parent is not an existing directory', 'TEAM_INVALID_ARGUMENT')
    }
    const state = await this.ctx.teams.getTeam({ teamId: request.teamId })
    const task = state.tasks.find(candidate => candidate.id === request.taskId)
    requireCurrent(task !== undefined, `Team task '${request.taskId}' is not available for worktree allocation`)
    requireCurrent(state.team.phase === 'active', `Team '${request.teamId}' is not active for worktree allocation`)
    requireCurrent(task.workspaceMode === 'worktree', `Team task '${task.id}' does not request a worktree workspace`)
    requireCurrent(
      task.phase === 'assigned' || task.phase === 'running',
      `Team task '${task.id}' does not hold an active worktree lease`,
    )
    const lease = task.lease
    requireCurrent(lease !== undefined, `Team task '${task.id}' has no current worktree lease`)
    requireCurrent(lease.expiresAt > Date.now(), `Team task '${task.id}' current lease has expired`)
    requireCurrent(lease.attemptId === request.attemptId, `Team task '${task.id}' attempt does not match worktree allocation`)
    requireCurrent(
      lease.assignedRevision === request.assignedRevision,
      `Team task '${task.id}' assigned revision does not match worktree allocation`,
    )
    requireCurrent(
      lease.participantId === request.participantId,
      `Team task '${task.id}' participant does not match worktree allocation`,
    )
    requireCurrent(
      lease.activationId === request.activationId,
      `Team task '${task.id}' activation does not match worktree allocation`,
    )
    const participant = state.participants.find(candidate => candidate.id === request.participantId)
    requireCurrent(
      isActiveLocalAgent(participant),
      `Team participant '${request.participantId}' is not an active local Agent`,
    )
    const binding = state.activations.find(candidate => candidate.activation.id === request.activationId)
    requireCurrent(
      binding !== undefined
      && binding.activation.teamId === request.teamId
      && binding.activation.participantId === request.participantId
      && binding.sessionId === request.sessionId
      && isDeliverableActivation(binding),
      `Team activation '${request.activationId}' does not match worktree allocation ownership`,
    )
    requireCurrent(
      this.hasExactLiveAgent(binding),
      `Session '${request.sessionId}' is not a live local Agent for worktree allocation`,
    )
    const decision = await this.ctx.teams.authorize({
      hook: 'workspace-allocate',
      teamId: request.teamId,
      actorId: request.participantId,
      facts: {
        taskId: request.taskId,
        attemptId: request.attemptId,
        assignedRevision: request.assignedRevision,
        participantId: request.participantId,
        activationId: request.activationId,
        sessionId: request.sessionId,
        workspaceMode: 'worktree',
        repoRoot: this.config.repoRoot,
        allocationParent: this.config.allocationParent,
        root,
        baseRef: this.config.baseRef,
        baseCommit: this.config.baseCommit,
      },
    })
    if (decision.kind === 'deny') throw new TeamError(decision.message, 'TEAM_POLICY_DENIED')
  }

  /** Compare scheduler-observed task/binding facts with the current Team projection. */
  private isEligibleState(
    state: TeamStateSnapshot,
    task: TeamTaskSnapshot,
    binding: ActivationBindingSnapshot,
  ): boolean {
    const currentTask = state.tasks.find(candidate => candidate.id === task.id)
    const participant = state.participants.find(candidate => candidate.id === binding.activation.participantId)
    const currentBinding = state.activations.find(candidate => candidate.activation.id === binding.activation.id)
    return state.team.phase === 'active'
      && currentTask?.revision === task.revision
      && currentTask.workspaceMode === 'worktree'
      && isActiveLocalAgent(participant)
      && currentBinding !== undefined
      && sameBindingIdentity(currentBinding, binding)
      && isDeliverableActivation(currentBinding)
  }

  /** Require the exact durable Session to remain registered as one live local Agent. */
  private hasExactLiveAgent(binding: ActivationBindingSnapshot): boolean {
    const agent = this.ctx.agents.get(binding.sessionId)
    return agent !== undefined && agent.id === binding.sessionId && agent.session.id === binding.sessionId
  }

  /** Build root-free provider metadata that a Team owner can bind before Git mutation. */
  private metadata(request: TeamWorkspacePrepareRequest): TeamWorkspaceAllocationMetadata {
    const key = allocationKey(request)
    return {
      id: teamWorkspaceAllocationIdSchema.parse(`worktree-${createHash('sha256').update(key).digest('hex')}`),
      provider: this.name,
      mode: 'worktree',
      teamId: request.teamId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      assignedRevision: request.assignedRevision,
      participantId: request.participantId,
      activationId: request.activationId,
      sessionId: request.sessionId,
      baseVersion: this.config.baseCommit,
    }
  }
}

/** Mount a worktree provider only after all deployment configuration resolves to concrete Git facts. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const setupAbort = new AbortController()
  /* v8 ignore next -- requires disposal during the narrow asynchronous mount window. */
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('team-workspace-worktree setup disposed'))
    }
  })
  try {
    const resolved = await resolveConfig(ctx, config, setupAbort.signal)
    setupAbort.signal.throwIfAborted()
    const provider = new WorktreeTeamWorkspaceProvider(ctx, resolved, ctx.subprocess)
    ctx.effect(() => ctx.teamWorkspaces.registerProvider(provider), 'teamWorkspaceWorktree.registerProvider()')
  } finally {
    stopSetupCancellation()
  }
}

/** Resolve explicit path, executable, ref, and grace configuration before provider publication. */
async function resolveConfig(ctx: Context, config: Config, signal: AbortSignal): Promise<ResolvedConfig> {
  assertTrimmedNonEmpty('providerName', config.providerName)
  assertTrimmedNonEmpty('baseRef', config.baseRef)
  assertTrimmedNonEmpty('gitExecutable', config.gitExecutable)
  assertGrace(config.processGraceMs)
  assertCommandTimeout(config.commandTimeoutMs)
  assertPositiveInteger('outputMaxBytes', config.outputMaxBytes)
  if (config.artifactProvider !== undefined) assertTrimmedNonEmpty('artifactProvider', config.artifactProvider)
  assertTrimmedNonEmpty('integrationAuthorName', config.integrationAuthorName ?? 'Clocky Team')
  assertTrimmedNonEmpty('integrationAuthorEmail', config.integrationAuthorEmail ?? 'clocky-team@localhost')
  const repoRoot = await canonicalDirectory('repoRoot', config.repoRoot)
  signal.throwIfAborted()
  const allocationParent = await canonicalDirectory('allocationParent', config.allocationParent)
  signal.throwIfAborted()
  const gitExecutable = await ctx.subprocess.resolveExecutable(config.gitExecutable, undefined, signal)
  signal.throwIfAborted()
  const provisional: Omit<ResolvedConfig, 'baseCommit'> = {
    providerName: config.providerName,
    repoRoot,
    allocationParent,
    baseRef: config.baseRef,
    gitExecutable,
    processGraceMs: config.processGraceMs,
    commandTimeoutMs: config.commandTimeoutMs,
    outputMaxBytes: config.outputMaxBytes,
    ...config.artifactProvider === undefined ? {} : { artifactProvider: config.artifactProvider },
    integrationEnabled: config.integrationEnabled ?? false,
    integrationAuthorName: config.integrationAuthorName ?? 'Clocky Team',
    integrationAuthorEmail: config.integrationAuthorEmail ?? 'clocky-team@localhost',
  }
  const topLevel = (await runGit(ctx.subprocess, provisional, repoRoot, [
    '-C', repoRoot, 'rev-parse', '--show-toplevel',
  ], signal)).trim()
  if (topLevel.length === 0) throw new TypeError('team-workspace-worktree: Git repository reported no top-level directory')
  const canonicalTopLevel = await canonicalDirectory('Git repository top-level', topLevel)
  if (canonicalTopLevel !== repoRoot) {
    throw new TypeError(`team-workspace-worktree: repoRoot '${repoRoot}' is not the canonical Git repository top-level '${canonicalTopLevel}'`)
  }
  const baseCommit = (await runGit(ctx.subprocess, provisional, repoRoot, [
    '-C', repoRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${config.baseRef}^{commit}`,
  ], signal)).trim()
  if (!/^[\da-f]{40,64}$/i.test(baseCommit)) {
    throw new TypeError(`team-workspace-worktree: baseRef '${config.baseRef}' did not resolve to one commit object`)
  }
  return { ...provisional, baseCommit }
}

/** Run one finite Git argv through the subprocess seam and require complete successful output. */
async function runGit(
  subprocess: SubprocessRuntime,
  config: Pick<ResolvedConfig, 'gitExecutable' | 'processGraceMs' | 'commandTimeoutMs' | 'outputMaxBytes'>,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<string> {
  using commandDeadline = deadline(signal, config.commandTimeoutMs, 'TEAM_WORKTREE_GIT_TIMEOUT')
  const handle = subprocess.spawn({
    argv: [config.gitExecutable, ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.outputMaxBytes },
      stderr: { maxBytes: config.outputMaxBytes },
    },
    graceMs: config.processGraceMs,
    signal: commandDeadline.signal,
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      ...environment,
    },
  })
  let outcome: Awaited<SubprocessHandle['done']>
  try {
    outcome = await abortable(handle.done, commandDeadline.signal)
  } catch (error: unknown) {
    const exited = await terminateAndDrain(handle, config.processGraceMs)
    if (!exited) throw new AggregateError([
      errorReason(error),
      drainFailure(config.processGraceMs),
    ], 'team-workspace-worktree: Git command failed and its process tree remained live')
    throw error
  }
  const exited = await handle.waitForExit(commandDeadline.signal)
  if (!exited) {
    const drained = await terminateAndDrain(handle, config.processGraceMs)
    if (!drained) throw drainFailure(config.processGraceMs)
    throw commandDeadline.signal.aborted
      ? commandDeadline.signal.reason
      : new Error('team-workspace-worktree: Git process tree did not reach quiescence')
  }
  const stdout = readCollected(handle, 'stdout', config.outputMaxBytes)
  const stderr = readCollected(handle, 'stderr', config.outputMaxBytes)
  if (commandDeadline.signal.aborted) throw commandDeadline.signal.reason
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    throw new GitCommandError(args, outcome.exitCode, outcome.signal, stderr)
  }
  return stdout
}

/** Resolve one explicit local branch target and reject option/ref injection. */
async function resolveTargetRef(
  subprocess: SubprocessRuntime,
  config: Pick<ResolvedConfig, 'gitExecutable' | 'processGraceMs' | 'commandTimeoutMs' | 'outputMaxBytes'>,
  repoRoot: string,
  target: string,
): Promise<string> {
  if (target.length === 0 || target.trim() !== target || target.startsWith('-') || target.includes('\0')) {
    throw new TeamError('worktree integration target must be a valid local branch name', 'TEAM_INVALID_ARGUMENT')
  }
  await runGit(subprocess, config, repoRoot, ['check-ref-format', '--branch', target])
  return `refs/heads/${target}`
}

/** Refuse to rewrite a branch that is currently checked out by any worktree. */
async function assertTargetNotCheckedOut(
  subprocess: SubprocessRuntime,
  config: Pick<ResolvedConfig, 'gitExecutable' | 'processGraceMs' | 'commandTimeoutMs' | 'outputMaxBytes'>,
  repoRoot: string,
  targetRef: string,
): Promise<void> {
  const listing = await runGit(subprocess, config, repoRoot, ['worktree', 'list', '--porcelain'])
  if (listing.split('\n').some(line => line === `branch ${targetRef}`)) {
    throw new TeamError(
      `worktree integration target '${targetRef.slice('refs/heads/'.length)}' is checked out and cannot be updated safely`,
      'TEAM_POLICY_DENIED',
    )
  }
}

/** Parse one NUL-delimited Git path output into stable relative paths. */
function parseNulPaths(output: string): readonly string[] {
  return [...new Set(output.split('\0').filter(path => path.length > 0))].sort()
}

/** Build a conflict result without claiming that target state was changed. */
function integrationConflict(
  allocation: TeamWorkspaceAllocation,
  target: string,
  artifact: TeamArtifactReference | undefined,
  conflictPaths: readonly string[] = [],
): TeamWorkspaceIntegrateResult {
  return {
    teamId: allocation.teamId,
    taskId: allocation.taskId,
    attemptId: allocation.attemptId,
    target,
    status: 'conflict',
    accepted: false,
    ...artifact === undefined ? {} : { artifact },
    ...conflictPaths.length === 0 ? {} : { conflictPaths },
  }
}

/** Stable commit message used to recover a completed source integration after a settlement race. */
function sourceIntegrationCommitMessage(request: TeamWorkspaceSourceIntegrateRequest): string {
  return `Integrate Clocky Team source ${String(request.source.taskId)} attempt ${String(request.source.attemptId)} `
    + `for task ${String(request.integrationTaskId)} attempt ${String(request.integrationAttemptId)}`
}

/** Find a prior provider commit for this exact source and integration attempt. */
async function findIntegrationCommit(
  subprocess: SubprocessRuntime,
  config: Pick<ResolvedConfig, 'gitExecutable' | 'processGraceMs' | 'commandTimeoutMs' | 'outputMaxBytes'>,
  repoRoot: string,
  targetRef: string,
  commitMessage: string,
): Promise<string | undefined> {
  const commit = (await runGit(subprocess, config, repoRoot, [
    '-C', repoRoot, 'log', '-1', '--format=%H', '--fixed-strings', `--grep=${commitMessage}`, targetRef,
  ])).trim()
  return commit.length === 0 ? undefined : commit
}

/** Read one complete bounded Git output stream; a lossy parse is never authoritative. */
function readCollected(handle: SubprocessHandle, stream: 'stdout' | 'stderr', maxBytes: number): string {
  const reader = handle.collected[stream]
  if (reader === undefined) throw new Error(`team-workspace-worktree: Git ${stream} was not collected`)
  const output = reader.readFrom(0)
  if (output.lossy) throw new Error(`team-workspace-worktree: Git ${stream} exceeded ${maxBytes} bytes`)
  return output.text
}

/** Await one Git lifecycle promise while removing the deadline listener once either outcome settles. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  /* v8 ignore next -- callers reject an already-aborted setup signal before starting Git. */
  if (signal.aborted) return Promise.reject(errorReason(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      const reason: unknown = signal.reason
      reject(errorReason(reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(errorReason(error))
      },
    )
  })
}

/** Terminate one Git process tree, then wait under a fresh bounded drain deadline. */
async function terminateAndDrain(handle: SubprocessHandle, graceMs: number): Promise<boolean> {
  handle.terminate()
  using drainDeadline = deadline(undefined, graceMs, 'TEAM_WORKTREE_GIT_DRAIN')
  return await handle.waitForExit(drainDeadline.signal)
}

/** Explain that the subprocess provider could not prove process-tree quiescence inside its drain bound. */
function drainFailure(graceMs: number): Error {
  return new Error(`team-workspace-worktree: Git process tree did not drain within ${graceMs}ms after termination`)
}

/** Normalize a provider-owned rejection or abort reason for the Promise error channel. */
function errorReason(reason: unknown): Error {
  /* v8 ignore next -- subprocess implementations reject with Error instances. */
  if (reason instanceof Error) return reason
  /* v8 ignore next -- subprocess implementations reject with Error instances. */
  return new Error(`team-workspace-worktree: Git lifecycle rejected with ${String(reason)}`)
}

/** Require an absolute existing directory and retain its filesystem canonical spelling. */
async function canonicalDirectory(label: string, raw: string): Promise<string> {
  if (!isAbsolute(raw)) throw new TypeError(`team-workspace-worktree: ${label} must be an absolute path`)
  let path: string
  try {
    path = await realpath(raw)
  } catch (error: unknown) {
    throw new TypeError(`team-workspace-worktree: ${label} '${raw}' cannot be canonicalized`, { cause: error })
  }
  if (!(await isDirectory(path))) throw new TypeError(`team-workspace-worktree: ${label} '${raw}' is not a directory`)
  return path
}

/** Return whether both retained mount roots still exist as directories. */
async function rootsRemainAvailable(config: Pick<ResolvedConfig, 'repoRoot' | 'allocationParent'>): Promise<boolean> {
  return (await isDirectory(config.repoRoot)) && (await isDirectory(config.allocationParent))
}

/** Return whether a path currently names an accessible directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Refuse an existing candidate rather than reusing or deleting a path this provider has not allocated. */
async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error: unknown) {
    /* v8 ignore next -- an EACCES/IO failure requires an OS-level race; propagate it unchanged. */
    if (isMissingPath(error)) return
    /* v8 ignore next -- an EACCES/IO failure requires an OS-level race; propagate it unchanged. */
    throw error
  }
  throw new TeamError(`worktree allocation root '${path}' already exists`, 'TEAM_INVALID_ARGUMENT')
}

/** Resolve and validate a just-created ordinary child directory inside the configured parent. */
async function canonicalWorktreeRoot(parent: string, raw: string): Promise<string> {
  const info = await lstat(raw)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`team-workspace-worktree: Git created a non-directory or symbolic-link worktree '${raw}'`)
  }
  const root = await realpath(raw)
  /* v8 ignore next -- a hash-derived child cannot escape its canonical parent without a filesystem replacement race. */
  if (!isChildPath(parent, root)) {
    throw new Error(`team-workspace-worktree: Git created worktree '${root}' outside allocationParent '${parent}'`)
  }
  return root
}

/** Return whether a canonical candidate is one proper child of a canonical parent. */
function isChildPath(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path.length > 0 && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)
}

/** Produce one deterministic provider-owned child path from the complete allocation identity. */
function allocationRoot(parent: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex')
  return join(parent, `clocky-team-worktree-${digest}`)
}

/** Produce the full identity key that fences retry/reuse to one attempt and one activation binding. */
function allocationKey(request: TeamWorkspacePrepareRequest): string {
  return JSON.stringify([
    request.teamId,
    request.taskId,
    request.attemptId,
    request.assignedRevision,
    request.participantId,
    request.activationId,
    request.sessionId,
  ])
}

/** Compare every durable provider field while excluding the live execution root. */
function sameMetadata(left: TeamWorkspaceAllocationMetadata, right: TeamWorkspaceAllocationMetadata): boolean {
  return left.id === right.id
    && left.provider === right.provider
    && left.mode === right.mode
    && left.teamId === right.teamId
    && left.taskId === right.taskId
    && left.attemptId === right.attemptId
    && left.assignedRevision === right.assignedRevision
    && left.participantId === right.participantId
    && left.activationId === right.activationId
    && left.sessionId === right.sessionId
    && left.baseVersion === right.baseVersion
}

/** Materialize bounded file references for changed worktree paths without copying contents. */
async function materializeArtifacts(
  allocation: TeamWorkspaceAllocation,
  paths: readonly string[],
  maxHashBytes: number,
  store: import('@clocky/clocky-team-artifact').TeamArtifactStore | undefined,
  provider: string | undefined,
): Promise<readonly TeamArtifactReference[]> {
  const artifacts: TeamArtifactReference[] = []
  for (const path of paths) {
    const absolute = join(allocation.root, path)
    if (!isChildPath(allocation.root, absolute)) continue
    let metadata
    try {
      metadata = await lstat(absolute)
    } catch (error: unknown) {
      // A deleted path remains in changedPaths but has no materializable file.
      void error
      continue
    }
    if (!metadata.isFile()) continue
    let contentHash: string | undefined
    let bytes: Uint8Array | undefined
    if (metadata.size <= maxHashBytes) {
      bytes = await readFile(absolute)
      contentHash = createHash('sha256').update(bytes).digest('hex')
    }
    if (store !== undefined && provider !== undefined && bytes !== undefined) {
      artifacts.push(await store.save(provider, {
        teamId: allocation.teamId,
        sourceAttemptId: allocation.attemptId,
        kind: 'file',
        visibility: 'team',
        name: path,
        data: bytes,
      }))
    } else {
      artifacts.push({
        id: `worktree:${String(allocation.attemptId)}:${path}`,
        kind: 'file',
        uri: absolute,
        ...contentHash === undefined ? {} : { contentHash },
        sourceAttemptId: allocation.attemptId,
        visibility: 'team',
      })
    }
  }
  return artifacts
}

/** Build changed paths and a binary patch from one worktree base through a temporary index. */
async function materializeWorktreeDiff(
  subprocess: SubprocessRuntime,
  config: Pick<ResolvedConfig, 'gitExecutable' | 'processGraceMs' | 'commandTimeoutMs' | 'outputMaxBytes' | 'allocationParent'>,
  root: string,
  baseVersion: string | undefined,
): Promise<{ readonly changedPaths: readonly string[]; readonly patch: string }> {
  const indexPath = join(config.allocationParent, `.clocky-team-publish-index-${randomUUID()}`)
  const indexEnvironment = { GIT_INDEX_FILE: indexPath }
  try {
    const baseCommit = baseVersion ?? (await runGit(subprocess, config, root, [
      '-C', root, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}',
    ])).trim()
    await runGit(subprocess, config, root, [
      '-C', root, 'read-tree', baseCommit,
    ], undefined, indexEnvironment)
    await runGit(subprocess, config, root, [
      '-C', root, 'add', '--all', '--', '.',
    ], undefined, indexEnvironment)
    const changedPaths = parseNulPaths(await runGit(subprocess, config, root, [
      '-C', root, 'diff', '--cached', '--name-only', '--no-renames', '-z', baseCommit,
    ], undefined, indexEnvironment))
    const patch = await runGit(subprocess, config, root, [
      '-C', root, 'diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-color', '--no-renames', baseCommit,
    ], undefined, indexEnvironment)
    return { changedPaths, patch }
  } finally {
    await rm(indexPath, { force: true })
    await rm(`${indexPath}.lock`, { force: true })
  }
}

/** Return whether one participant is eligible for local worktree ownership. */
function isActiveLocalAgent(participant: ParticipantSnapshot | undefined): participant is ParticipantSnapshot {
  return participant?.kind === 'local-agent' && participant.phase === 'active'
}

/** Return whether one activation is usable for an allocation or delivery-bound attempt. */
function isDeliverableActivation(binding: ActivationBindingSnapshot): boolean {
  return binding.activation.status === 'idle' || binding.activation.status === 'running'
}

/** Compare immutable activation, Session, and placement identity while allowing observed status changes. */
function sameBindingIdentity(left: ActivationBindingSnapshot, right: ActivationBindingSnapshot): boolean {
  return left.activation.id === right.activation.id
    && left.activation.teamId === right.activation.teamId
    && left.activation.participantId === right.activation.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Reject empty or whitespace-padded deployment identifiers before provider publication. */
function assertTrimmedNonEmpty(name: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`team-workspace-worktree: ${name} must be non-empty without surrounding whitespace`)
  }
}

/** Reject a process grace unsupported by the subprocess service before any Git mutation. */
function assertGrace(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`team-workspace-worktree: processGraceMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a Git command timeout unsupported by the timeout and subprocess services. */
function assertCommandTimeout(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`team-workspace-worktree: commandTimeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a non-positive or fractional stream retention bound before a Git command can start. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`team-workspace-worktree: ${name} must be a positive integer`)
  }
}

/** Detect the single expected missing-path error without broad error swallowing. */
function isMissingPath(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

/** Raise the Team provider's stable invalid-argument code for a failed current-allocation relation. */
function requireCurrent(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TeamError(message, 'TEAM_INVALID_ARGUMENT')
}
