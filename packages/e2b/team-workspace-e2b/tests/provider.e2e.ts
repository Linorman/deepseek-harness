import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { Sandbox } from '@clocky/clocky-e2b'
import type { TaskAttemptId, TeamArtifactReference, TeamTaskSnapshot } from '@clocky/clocky-team'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspacePrepareRequest } from '@clocky/clocky-team-workspace'
import * as RemoteWorkspace from '../src/index.ts'

describe.skipIf(!process.env.E2B_API_KEY)('E2B remote Team workspace provider (live)', () => {
  const sandboxes: Sandbox[] = []

  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map(async sandbox => await sandbox.kill().catch(() => false)))
  })

  it('allocates, publishes, and integrates a live E2B workspace', async () => {
    const apiKey = process.env.E2B_API_KEY
    if (apiKey === undefined) throw new Error('E2B_API_KEY disappeared before the live Team workspace test')
    const sandbox = await Sandbox.create({
      apiKey,
      timeoutMs: 120_000,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    sandboxes.push(sandbox)

    const teamId = 'live-remote-team' as never
    const taskId = 'live-remote-task' as never
    const attemptId = 'live-remote-attempt' as never
    const participantId = 'live-remote-participant' as never
    const activationId = 'live-remote-activation' as never
    const sessionId = 'live-remote-session' as never
    const binding = {
      activation: { id: activationId, teamId, participantId, status: 'idle' as const },
      sessionId,
      provider: 'live-e2b-agent',
    }
    const task = {
      id: taskId,
      teamId,
      revision: 1,
      workspaceMode: 'remote' as const,
      phase: 'assigned' as const,
      lease: {
        attemptId,
        assignedRevision: 1,
        participantId,
        activationId,
        expiresAt: Date.now() + 90_000,
      },
    } as unknown as TeamTaskSnapshot
    const state = {
      team: { id: teamId, phase: 'active' as const },
      tasks: [task],
      participants: [{ id: participantId, teamId, kind: 'local-agent' as const, phase: 'active' as const }],
      activations: [binding],
    }
    const artifactBytes = new Map<string, Uint8Array>()
    const save = async (_provider: string, request: {
      readonly name?: string
      readonly sourceAttemptId?: TaskAttemptId
      readonly kind: 'file' | 'patch'
      readonly visibility: 'team'
      readonly data: Uint8Array | string
    }): Promise<TeamArtifactReference> => {
      const id = `live-e2b-artifact-${String(artifactBytes.size)}`
      artifactBytes.set(id, typeof request.data === 'string' ? new TextEncoder().encode(request.data) : Uint8Array.from(request.data))
      return {
        id,
        provider: 'live-e2b-artifacts',
        kind: request.kind,
        uri: `artifact://${id}`,
        sourceAttemptId: request.sourceAttemptId,
        visibility: request.visibility,
      }
    }
    const read = async (_provider: string, input: { readonly reference: { readonly id: string } }): Promise<Uint8Array> => {
      const bytes = artifactBytes.get(input.reference.id)
      if (bytes === undefined) throw new Error(`missing live artifact ${input.reference.id}`)
      return Uint8Array.from(bytes)
    }
    const teams = {
      getTeam: async () => state,
      authorize: async () => ({ kind: 'allow' as const }),
    }
    const agents = { get: () => ({ session: { id: sessionId } }) }
    const ctx = new Context()
    ctx.provide('teams', teams as never)
    ctx.provide('agents', agents as never)
    ctx.provide('e2b', {
      runtimeRoot: '/home/user/.clocky-e2b',
      getSandbox: async () => sandbox,
    } as never)
    ctx.provide('teamArtifacts', { save, read } as never)
    await ctx.plugin(TeamWorkspaceRegistry)
    await ctx.plugin(RemoteWorkspace, {
      workspaceParent: '/home/user/.clocky-e2b/team-workspaces',
      artifactProvider: 'live-e2b-artifacts',
      integrationRoot: '/home/user/.clocky-e2b/team-integrations',
      integrationEnabled: true,
      maxArtifactBytes: 4_096,
      maxIntegrationBytes: 4_096,
    })

    try {
      const request: TeamWorkspacePrepareRequest = {
        teamId,
        taskId,
        attemptId,
        assignedRevision: 1,
        participantId,
        activationId,
        sessionId,
      }
      const preparation = await ctx.teamWorkspaces.prepare('remote', request)
      const allocation = await preparation.materialize()
      await sandbox.files.write([{ path: `${allocation.root}/result.txt`, data: 'live remote result\n' }])

      const published = await ctx.teamWorkspaces.publish('remote', { allocation })
      const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
      if (patch === undefined) throw new Error('live E2B patch artifact was not published')
      expect(published.changedPaths).toEqual(['result.txt'])
      expect(published.artifacts).toHaveLength(2)

      const integrated = await ctx.teamWorkspaces.integrateSource('remote-e2b', {
        source: { teamId, taskId, attemptId, artifacts: [patch] },
        integrationTaskId: 'live-integration-task' as never,
        integrationAttemptId: 'live-integration-attempt' as never,
        target: 'main',
        expectedTarget: 'missing',
        mode: 'integrate',
        actorId: participantId,
      })
      expect(integrated).toMatchObject({ status: 'integrated', target: 'main', artifact: patch })
      await expect(sandbox.files.read('/home/user/.clocky-e2b/team-integrations/main/result.txt', { format: 'text' }))
        .resolves.toBe('live remote result\n')
      await allocation.release()
    } finally {
      await ctx.fiber.dispose()
    }
  }, 150_000)
})
