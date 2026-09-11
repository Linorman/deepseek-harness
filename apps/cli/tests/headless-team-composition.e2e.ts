import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@clocky/clocky-app-boot'
import { provideCmdline } from '@clocky/clocky-cmdline'
import type { PatchOptions } from '@clocky/cordis-plugin-include'
import type { Entry } from '@clocky/cordis-plugin-loader'
import type {} from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-team-closure-driver'
import type {} from '@clocky/clocky-team-closure-driver/hub'
import type {} from '@clocky/clocky-tools'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const HEADLESS_PATCH = join(REPO_ROOT, 'packages/bundle/headless/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const LEGACY_GOAL_TOOLS = ['create_goal', 'get_goal', 'update_goal']
const TEAM_ROWS = [
  'team-hub',
  'team-closure-drive-registry',
  'team-closure-driver-hub',
  'team-closure-driver',
  'team-run',
  'tool-team',
  'tool-team-goal',
  'tool-team-task',
]

async function bootHeadless(root: string): Promise<Context> {
  const profileDir = join(root, 'profiles', 'headless-composition')
  const settingsPath = join(root, 'settings.yaml')
  await mkdir(profileDir, { recursive: true })
  await writeFile(settingsPath, '{}\n')
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  healProfilesModuleFallback(INSTALL_ANCHOR, root)
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('clocky-headless-composition', BASE_PATCH),
    ...loadOverlayPatches('clocky-headless-composition', HEADLESS_PATCH),
    { id: 'settings', config: { path: settingsPath, watch: false } },
    { id: 'credentials', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { id: 'attachment-local', config: { clockyHome: root } },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions') } },
    { id: 'team-storage-sqlite', config: { path: join(root, 'team-storage.sqlite') } },
    {
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: join(REPO_ROOT, 'apps/cli/config/agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
  ]
  return await boot('clocky-headless-composition', join(profileDir, 'cordis.yml'), patches, (ctx) => {
    provideCmdline(ctx, { args: [], exit: () => {} })
  })
}

describe('the shipped headless Team composition', () => {
  it('removes legacy Goal tools while preserving the Team owners', async () => {
    const tempRoot = join(REPO_ROOT, '.tmp')
    await mkdir(tempRoot, { recursive: true })
    const root = await mkdtemp(join(tempRoot, 'clocky-headless-composition-'))
    let ctx: Context | undefined
    try {
      ctx = await bootHeadless(root)
      const rows = new Map<string, Entry>()
      for (const entry of ctx.loader.entries()) rows.set(entry.options.id, entry)
      for (const id of ['goal', 'goal-round-driver', 'command-goal', 'tool-goal']) {
        expect(rows.get(id)?.disabled, `${id} must be disabled`).toBe(true)
      }
      for (const id of TEAM_ROWS) expect(rows.get(id)?.disabled, `${id} must be enabled`).not.toBe(true)
      expect(rows.get('team-storage-sqlite')?.disabled).not.toBe(true)
      expect(rows.get('team-storage-log')?.options.config).toMatchObject({ backend: 'sqlite' })
      expect(ctx.storage.backend.names()).toEqual(['sqlite'])
      expect(ctx.teamClosureDriverHub.backend).toBe('hub')
      expect(ctx.teamClosureDrives.requireBackend('hub')).toBeDefined()
      const tools = ctx.tools.schemas().map(schema => schema.name)
      for (const name of LEGACY_GOAL_TOOLS) expect(tools).not.toContain(name)
    } finally {
      await ctx?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
