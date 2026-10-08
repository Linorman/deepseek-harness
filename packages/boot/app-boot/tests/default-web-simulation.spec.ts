/** Actual bundle layers update standard profiles without rewriting user state or affecting headless. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { composeEntries, initProfile, loadProfile } from '../src/profile.ts'
import type { EntryOptions } from '@clocky/cordis-plugin-loader'

const anchor = join(process.cwd(), 'apps/cli/package.json')
function entries(home: string, profile = 'web'): EntryOptions[] {
  const loaded = loadProfile('clocky', profile, anchor, home)
  return composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches])
}
function group(rows: EntryOptions[]): EntryOptions {
  const value = rows.find(row => row.id === 'web-simulation')
  if (value === undefined) throw new Error('Published Simulation group missing')
  return value
}

it('adds the current default to fresh and existing standard Web profiles while retaining user overrides', async () => {
  const root = join(process.cwd(), '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'profiles-'))
  try {
    const fresh = group(entries(home))
    expect(fresh.disabled).not.toBe(true)
    expect((fresh.config as EntryOptions[]).map(row => row.id)).toContain('web-simulation-administration')
    const dir = join(home, 'profiles/web')
    const manifest = await readFile(join(dir, 'package.json'), 'utf8')
    initProfile(dir, ['@clocky/clocky-base', '@clocky/clocky-web-app'])
    expect(group(entries(home)).disabled).not.toBe(true)
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(manifest)
    const userPatch = '- id: web-simulation-local\n  config:\n    name: web-local\n    root: ./custom-native-root\n    backend: json\n    replayPageSize: 64\n'
    await writeFile(join(dir, 'cordis.patch.yml'), userPatch)
    const custom = (group(entries(home)).config as EntryOptions[]).find(row => row.id === 'web-simulation-local')!
    expect(custom.config).toMatchObject({ root: './custom-native-root', backend: 'json' })
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(userPatch)
    await writeFile(join(dir, 'cordis.patch.yml'), '- id: web-simulation\n  disabled: true\n')
    expect(group(entries(home)).disabled).toBe(true)
    expect(entries(home, 'headless').some(row => row.id === 'web-simulation')).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})
