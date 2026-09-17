/** Product cutover rejects compatibility code reachable through shipped consumers. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyLegacyCutover } from './verify-legacy-cutover.ts'

const roots: string[] = []
const compatibility = '@clocky/clocky-compat-tool-subagent'

function write(root: string, path: string, value: string | object): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}

function fixture(): string {
  mkdirSync('.tmp', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.tmp/legacy-cutover-'))
  roots.push(root)
  write(root, 'packages/compat/tool-subagent/package.json', { name: compatibility, version: '0.0.0', private: true })
  write(root, 'packages/core/agent/package.json', { name: '@clocky/clocky-agent', version: '0.0.0' })
  write(root, 'python/sdk-runtime/package.json', { dependencies: {} })
  for (const file of ['packages/bundle/base/cordis.patch.yml', 'packages/bundle/headless/cordis.patch.yml',
    'packages/bundle/web-app/cordis.patch.yml', 'python/sdk-runtime/src/clocky_runtime/runtime/cordis.yml', 'docs/tool-catalog.md']) {
    write(root, file, '')
  }
  write(root, 'examples/headless-agent/cordis.yml', `- name: '${compatibility}'\n`)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('legacy product cutover', () => {
  it('accepts private renamed compatibility with only an explicit example consumer', () => {
    expect(verifyLegacyCutover(fixture())).toEqual({ compatibilityPackages: [compatibility],
      releaseMembers: ['@clocky/clocky-agent'], failures: [] })
  })

  it('rejects the old directory and package name even when private', () => {
    const root = fixture()
    write(root, 'packages/subagent/tool-subagent/package.json', { name: '@clocky/clocky-tool-subagent', version: '0.0.0', private: true })
    expect(verifyLegacyCutover(root).failures).toEqual(expect.arrayContaining([
      expect.stringContaining('must live under packages/compat'), expect.stringContaining('must use @clocky/clocky-compat-*'),
    ]))
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])('rejects a public %s edge into compatibility', (section) => {
    const root = fixture()
    write(root, 'packages/core/agent/package.json', { name: '@clocky/clocky-agent', version: '0.0.0', [section]: { [compatibility]: '*' } })
    expect(verifyLegacyCutover(root).failures).toContain(`@clocky/clocky-agent: public package depends on private compatibility: ${compatibility}`)
  })

  it.each(['packages/bundle/base/cordis.patch.yml', 'apps/cli/config/agent-presets/standard/agent.cordis.yml'])('rejects even a disabled legacy entry in %s', (file) => {
    const root = fixture()
    write(root, file, `- name: '${compatibility}'\n  disabled: true\n`)
    expect(verifyLegacyCutover(root).failures).toContain(`default composition: ${file} references ${compatibility}`)
  })

  it('rejects compatibility tool catalog entries using the actual package prefix', () => {
    const root = fixture()
    write(root, 'docs/tool-catalog.md', compatibility)
    expect(verifyLegacyCutover(root).failures).toContain(`product tool catalog: docs/tool-catalog.md references ${compatibility}`)
  })

  it('includes the same-Session Goal stack in the compatibility inventory', () => {
    const root = fixture()
    write(root, 'packages/compat/goal/package.json', { name: '@clocky/clocky-compat-goal', version: '0.0.0', publishConfig: { access: 'public' } })
    expect(verifyLegacyCutover(root).failures).toEqual(expect.arrayContaining([
      'packages/compat/goal/package.json: compatibility package must be private',
      '@clocky/clocky-compat-goal: private compatibility package is still in the Clocky release family',
    ]))
  })

  it('rejects pre-rename tarballs after the source package moved', () => {
    const root = fixture()
    write(root, 'dist/npm/clocky-clocky-tool-subagent-0.0.0.tgz', '')
    expect(verifyLegacyCutover(root).failures).toContain('packed release contains private compatibility tarballs: clocky-clocky-tool-subagent-0.0.0.tgz')
  })

  it('rejects stale Goal declarations in the built public Host', () => {
    const root = fixture()
    write(root, 'packages/host/apiproxy/lib/types/api/goals.d.ts', 'export interface GoalsApi {}')
    expect(verifyLegacyCutover(root).failures).toContain('built Host contains retired Goal API files: packages/host/apiproxy/lib/types/api/goals.d.ts')
  })
})
