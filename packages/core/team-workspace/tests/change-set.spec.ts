import { describe, expect, it } from 'vitest'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import {
  encodeTeamWorkspaceChangeSet,
  parseTeamWorkspaceChangeSet,
  selectTeamWorkspacePatchArtifact,
  teamWorkspaceSourceIntegrationResult,
} from '../src/index.ts'
import type {
  TeamWorkspaceSourceIntegrateRequest,
  TeamWorkspaceSourceIntegrateResult,
} from '../src/index.ts'

const sourceAttemptId = taskAttemptIdSchema.parse('change-set-source-attempt')

describe('Team workspace portable change sets', () => {
  it('round trips ordered file, symlink, and delete changes', () => {
    const encoded = encodeTeamWorkspaceChangeSet({
      provider: 'sandbox-local',
      sourceAttemptId,
      changes: [
        { path: 'src/new.txt', kind: 'file', data: 'bmV3Cg==' },
        { path: 'src/link', kind: 'symlink', target: 'new.txt' },
        { path: 'old.txt', kind: 'delete' },
      ],
    }, 1024)
    expect(parseTeamWorkspaceChangeSet(JSON.parse(encoded), 'sandbox-local', sourceAttemptId, 1024)).toEqual({
      version: 1,
      provider: 'sandbox-local',
      sourceAttemptId,
      changes: [
        { path: 'src/new.txt', kind: 'file', data: 'bmV3Cg==' },
        { path: 'src/link', kind: 'symlink', target: 'new.txt' },
        { path: 'old.txt', kind: 'delete' },
      ],
    })
  })

  it('rejects unsafe paths, duplicate paths, invalid provenance, and oversized bytes', () => {
    const base = {
      version: 1,
      provider: 'sandbox-local',
      sourceAttemptId,
      changes: [{ path: 'safe.txt', kind: 'file', data: 'YWJj' }],
    }
    expect(() => parseTeamWorkspaceChangeSet({ ...base, extra: true }, 'sandbox-local', sourceAttemptId, 1024)).toThrow(/provenance/)
    expect(() => parseTeamWorkspaceChangeSet({ ...base, provider: 'other' }, 'sandbox-local', sourceAttemptId, 1024)).toThrow(/provenance/)
    expect(() => parseTeamWorkspaceChangeSet({ ...base, changes: [{ path: '../escape', kind: 'delete' }] }, 'sandbox-local', sourceAttemptId, 1024)).toThrow(/unsafe path/)
    expect(() => parseTeamWorkspaceChangeSet({ ...base, changes: [base.changes[0], base.changes[0]] }, 'sandbox-local', sourceAttemptId, 1024)).toThrow(/duplicate/)
    expect(() => parseTeamWorkspaceChangeSet({ ...base, changes: [{ path: 'large.txt', kind: 'file', data: 'YWJj' }] }, 'sandbox-local', sourceAttemptId, 2)).toThrow(/exceeds/)
  })

  it('rejects malformed root and change values at the artifact boundary', () => {
    const base = {
      version: 1,
      provider: 'sandbox-local',
      sourceAttemptId,
      changes: [{ path: 'safe.txt', kind: 'file', data: 'YWJj' }],
    }
    const parse = (value: unknown, maxBytes = 1024): void => {
      parseTeamWorkspaceChangeSet(value, 'sandbox-local', sourceAttemptId, maxBytes)
    }
    const expectFailure = (value: unknown, pattern: RegExp, maxBytes?: number): void => {
      expect(() => { parse(value, maxBytes) }).toThrow(pattern)
    }
    expectFailure(base, /size bound/, 0)
    for (const value of [null, [], undefined]) expectFailure(value, /object/)
    expectFailure({ ...base, version: 2 }, /provenance/)
    expectFailure({ ...base, sourceAttemptId: taskAttemptIdSchema.parse('other-attempt') }, /provenance/)
    expectFailure({ ...base, changes: undefined }, /provenance/)
    expectFailure({ ...base, changes: [] }, /provenance/)
    expectFailure({ ...base, extra: true }, /provenance/)
    for (const value of [null, [], undefined]) expectFailure({ ...base, changes: [value] }, /invalid change/)
    for (const path of ['', '/absolute', '../parent', 'dot/./path', 'back\\slash', `nul${String.fromCharCode(0)}path`]) {
      expectFailure({ ...base, changes: [{ path, kind: 'delete' }] }, /unsafe path/)
    }
    expectFailure({ ...base, changes: [base.changes[0], { ...base.changes[0] }] }, /duplicate/)
    expectFailure({ ...base, changes: [{ path: 'delete.txt', kind: 'delete', extra: true }] }, /unexpected fields/)
    for (const target of ['', '/absolute', '../parent', `nul${String.fromCharCode(0)}target`, 'back\\slash']) {
      expectFailure({ ...base, changes: [{ path: 'link', kind: 'symlink', target }] }, /symlink/)
    }
    expectFailure({ ...base, changes: [{ path: 'link', kind: 'symlink', target: 'link', extra: true }] }, /symlink/)
    for (const change of [
      { path: 'bad', kind: 'other', data: 'YWJj' },
      { path: 'bad', kind: 'file', data: '' },
      { path: 'bad', kind: 'file', data: 'not base64' },
      { path: 'bad', kind: 'file', data: 'YQ=' },
      { path: 'bad', kind: 'file', data: 'YQ==', extra: true },
    ]) expectFailure({ ...base, changes: [change] }, /file change/)
    expectFailure({ ...base, changes: [{ path: 'bad', kind: 'file', data: 'YWJj' }] }, /exceeds/, 2)
    expect(() => {
      encodeTeamWorkspaceChangeSet({
        provider: 'sandbox-local',
        sourceAttemptId,
        changes: [{ path: 'link', kind: 'symlink', target: 'é'.repeat(100) }],
      }, 64)
    }).toThrow(/exceeds/)
  })

  it('supports all canonical base64 padding forms and shared integration provenance helpers', () => {
    const parsed = parseTeamWorkspaceChangeSet({
      version: 1,
      provider: 'sandbox-local',
      sourceAttemptId,
      changes: [
        { path: 'one', kind: 'file', data: 'YQ==' },
        { path: 'two', kind: 'file', data: 'YWI=' },
        { path: 'three', kind: 'file', data: 'YWJj' },
        { path: 'link', kind: 'symlink', target: './three' },
        { path: 'gone', kind: 'delete' },
      ],
    }, 'sandbox-local', sourceAttemptId, 1024)
    expect(parsed.changes).toHaveLength(5)

    const artifact = {
      id: 'patch',
      kind: 'patch' as const,
      uri: 'artifact://patch',
      sourceAttemptId,
      visibility: 'team' as const,
    }
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: {
        teamId: 'team' as never,
        taskId: 'source' as never,
        attemptId: sourceAttemptId,
        artifacts: [artifact],
      },
      integrationTaskId: 'integration' as never,
      integrationAttemptId: 'integration-attempt' as never,
      target: 'main',
      mode: 'proposal',
    }
    expect(selectTeamWorkspacePatchArtifact(request)).toBe(artifact)
    expect(() => {
      selectTeamWorkspacePatchArtifact({ ...request, source: { ...request.source, artifacts: [] } })
    }).toThrow(/exactly one/)
    expect(() => {
      selectTeamWorkspacePatchArtifact({ ...request, source: { ...request.source, artifacts: [artifact, artifact] } })
    }).toThrow(/exactly one/)

    const results: TeamWorkspaceSourceIntegrateResult[] = [
      teamWorkspaceSourceIntegrationResult(request, { status: 'proposed' }),
      teamWorkspaceSourceIntegrationResult(request, { status: 'integrated', targetVersion: 'version', artifact }),
      teamWorkspaceSourceIntegrationResult(request, { status: 'conflict', conflictPaths: ['one'] }),
    ]
    expect(results).toEqual([
      expect.objectContaining({ status: 'proposed', target: 'main' }),
      expect.objectContaining({ status: 'integrated', targetVersion: 'version', artifact }),
      expect.objectContaining({ status: 'conflict', conflictPaths: ['one'] }),
    ])
  })
})
