import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentPresets from '@clocky/clocky-agent-presets'

const root = fileURLToPath(new URL('..', import.meta.url))
const shippedPresetRoot = resolve(root, '../../../apps/cli/config/agent-presets')

const schedulerLines = [
  'leaseDurationMs: 3600000',
  'maxAssignmentsPerDrive: 8',
  'maxExpirationsPerDrive: 1',
  'maxWakeDispatchesPerDrive: 8',
  'maxConflictsPerDrive: 4',
  'maxActiveAttemptsPerParticipant: 1',
  'permittedWorkspaceModes: [shared]',
  'disposalTimeoutMs: 5000',
]

const taskPackageNames = [
  '@clocky/clocky-storage-sqlite',
  '@clocky/clocky-team-channel-task-assignment',
  '@clocky/clocky-team-scheduler-dag',
  '@clocky/clocky-team-workspace',
  '@clocky/clocky-team-workspace-shared',
  '@clocky/clocky-team-workspace-recovery',
  '@clocky/clocky-tool-team-goal',
  '@clocky/clocky-tool-team-task',
  '@clocky/clocky-team-closure-driver',
]

const webGoalCommandPackage = '@clocky/clocky-command-team-goal'

const workerPresetPackage = '@clocky/clocky-agent-presets'

const legacyModelRowIds = [
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-report',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
]

const legacyCoordinatorPresetRowIds = [...legacyModelRowIds, 'tool-goal']

const legacyGoalRowIds = [
  'goal',
  'goal-round-driver',
  'command-goal',
  'tool-goal',
]

const legacyPackageNames = [
  '@clocky/clocky-subagent',
  '@clocky/clocky-subagent-spawn-in-process',
  '@clocky/clocky-tool-ralph',
  '@clocky/clocky-tool-subagent',
  '@clocky/clocky-tool-subagent-control',
  '@clocky/clocky-tool-subagent-report',
  '@clocky/clocky-tool-workflow',
  '@clocky/clocky-workflow-worker-thread',
]

function row(source: string, id: string): string {
  const start = source.indexOf(`    - id: ${id}\n`)
  if (start < 0) throw new Error(`missing composition row '${id}'`)
  const next = source.indexOf('\n    - id: ', start + 1)
  return source.slice(start, next < 0 ? source.length : next)
}

function isDisabled(source: string, id: string): boolean {
  return new RegExp(`^- id: ${id}\\n  disabled: true(?:\\n|$)`, 'm').test(source)
}

describe('shipped Team task composition', () => {
  it.each([
    ['headless', root],
    ['web', resolve(root, '../web-app')],
  ])('%s mounts the bounded shared-task foundation', (surface, directory) => {
    const patch = readFileSync(resolve(directory, 'cordis.patch.yml'), 'utf8')
    const workspace = row(patch, 'team-workspace')
    const shared = row(patch, 'team-workspace-shared')
    const recovery = row(patch, 'team-workspace-recovery')
    const assignment = row(patch, 'team-channel-task-assignment')
    const scheduler = row(patch, 'team-scheduler-dag')
    const closureRegistry = row(patch, 'team-closure-drive-registry')
    const closureHub = row(patch, 'team-closure-driver-hub')
    const closureDriver = row(patch, 'team-closure-driver')
    const storage = row(patch, surface === 'headless' ? 'team-storage-sqlite' : 'storage-sqlite')
    const storageLog = row(patch, surface === 'headless' ? 'team-storage-log' : 'storage-log')
    const teamRun = row(patch, 'team-run')
    const goalTools = row(patch, 'tool-team-goal')
    const taskTools = row(patch, 'tool-team-task')
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(workspace).toContain("name: '@clocky/clocky-team-workspace'")
    expect(shared).toContain("name: '@clocky/clocky-team-workspace-shared'")
    expect(shared).toContain('root: !!js process.cwd()')
    expect(shared).toContain('allowTeamWorkspacePath: true')
    expect(shared).toContain("observationStateRoot: !!js clockyHomePath('team-workspace-observations')")
    expect(recovery).toContain("name: '@clocky/clocky-team-workspace-recovery'")
    expect(recovery).toContain('maxTeamsPerDrive: 128')
    expect(recovery).toContain('pageSize: 32')
    expect(assignment).toContain("name: '@clocky/clocky-team-channel-task-assignment'")
    expect(scheduler).toContain("name: '@clocky/clocky-team-scheduler-dag'")
    expect(closureRegistry).toContain("name: '@clocky/clocky-team-closure-driver/registry'")
    expect(closureHub).toContain("name: '@clocky/clocky-team-closure-driver/hub'")
    expect(closureHub).toContain('backend: hub')
    expect(closureDriver).toContain("name: '@clocky/clocky-team-closure-driver'")
    for (const line of ['backend: hub', 'maxTeamsPerDrive: 128', 'pageSize: 32', 'disposalTimeoutMs: 5000']) {
      expect(closureDriver).toContain(line)
    }
    expect(storage).toContain("name: '@clocky/clocky-storage-sqlite'")
    expect(storage).toContain("path: !!js clockyHomePath('team-storage.sqlite')")
    expect(storageLog).toContain('backend: sqlite')
    expect(row(patch, 'team-hub')).toContain('maxModelTokensPerTeam: 100000000')
    expect(teamRun).toContain('workerPreset: minimal')
    expect(teamRun).toContain('workerCount: 1')
    expect(teamRun).toContain('maxWorkerCount: 32')
    expect(goalTools).toContain("name: '@clocky/clocky-tool-team-goal'")
    expect(taskTools).toContain("name: '@clocky/clocky-tool-team-task'")
    expect(patch.indexOf('    - id: tool-team-goal')).toBeGreaterThan(patch.indexOf('    - id: team-run'))
    expect(patch.indexOf('    - id: tool-team-task')).toBeGreaterThan(patch.indexOf('    - id: team-run'))
    for (const id of legacyModelRowIds) expect(patch).not.toContain(`id: ${id}`)
    for (const line of schedulerLines) expect(scheduler).toContain(line)
    expect(scheduler).toContain('maxAssignmentsPerDrive: 8')
    expect(scheduler).toContain('maxWakeDispatchesPerDrive: 8')
    expect(manifest.dependencies).toEqual(expect.objectContaining(
      Object.fromEntries([...taskPackageNames, workerPresetPackage].map(name => [name, 'workspace:^'])),
    ))
    if (surface === 'headless') {
      const presets = row(patch, 'agent-presets')
      expect(presets).toContain("name: '@clocky/clocky-agent-presets'")
      expect(presets).toContain('default: standard')
      expect(manifest.dependencies).not.toHaveProperty('@clocky/clocky-storage-json')
    } else {
      const domain = row(patch, 'storage-domain')
      const goalCommand = row(patch, 'command-team-goal')
      expect(domain).toContain('backend: json')
      expect(goalCommand).toContain("name: '@clocky/clocky-command-team-goal'")
      expect(patch.indexOf('    - id: command-team-goal')).toBeGreaterThan(patch.indexOf('    - id: team-run'))
      expect(patch).not.toContain("name: '@clocky/clocky-client-ui-goal'")
      expect(manifest.dependencies).toHaveProperty(webGoalCommandPackage, 'workspace:^')
      expect(manifest.dependencies).toHaveProperty('@clocky/clocky-storage-json', 'workspace:^')
      expect(manifest.dependencies).not.toHaveProperty('@clocky/clocky-client-ui-goal')
    }
    for (const id of legacyGoalRowIds) expect(isDisabled(patch, id), `${id} must be disabled`).toBe(true)
  })

  it('resolves the shipped minimal worker preset from the profile-owned root', async () => {
    const ctx = new Context()
    ctx.provide('loader', {} as never)
    const fiber = await ctx.plugin(AgentPresets, {
      default: 'standard',
      roots: [{ path: shippedPresetRoot, trust: 'system' }],
      includeUserRoot: false,
    })
    try {
      await expect(ctx.agentPresets.resolve('minimal')).resolves.toMatchObject({
        id: 'minimal', trust: 'system',
      })
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps direct orchestration out of the shipped coordinator presets', () => {
    for (const preset of ['standard', 'code', 'cordis']) {
      const source = readFileSync(resolve(shippedPresetRoot, preset, 'agent.cordis.yml'), 'utf8')
      for (const id of legacyCoordinatorPresetRowIds) expect(source).not.toContain(`id: ${id}`)
    }
    const minimal = readFileSync(resolve(shippedPresetRoot, 'minimal', 'agent.cordis.yml'), 'utf8')
    expect(minimal).not.toContain('id: tool-goal')
  })

  it('does not install direct orchestration for the shipped preset resolver', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, '../../../apps/cli/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    for (const packageName of legacyPackageNames) {
      expect(manifest.dependencies ?? {}).not.toHaveProperty(packageName)
    }
  })
})
