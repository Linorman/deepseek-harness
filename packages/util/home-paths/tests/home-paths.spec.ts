import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CLOCKY_HOME_DISPLAY,
  CLOCKY_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultClockyHome,
  clockyHomeDisplay,
  clockyHomePath,
  expandHomePath,
  resolveClockyHome,
} from '@clocky/clocky-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clocky path helpers', () => {
  it('owns the shared default Clocky home directory name', () => {
    expect(CLOCKY_HOME_DIR_NAME).toBe('.clocky')
    expect(DEFAULT_CLOCKY_HOME_DISPLAY).toBe('~/.clocky')
    expect(defaultClockyHome()).toBe(join(homedir(), '.clocky'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.clocky')).toBe(join(homedir(), '.clocky'))
    expect(expandHomePath('~\\.clocky')).toBe(join(homedir(), '.clocky'))
    expect(expandHomePath('/tmp/.clocky')).toBe('/tmp/.clocky')
    expect(expandHomePath('~other/.clocky')).toBe('~other/.clocky')
  })

  it('resolves explicit path before CLOCKY_HOME and the default', () => {
    const envHome = join(homedir(), 'env-clocky')

    expect(resolveClockyHome('/tmp/explicit-clocky', { CLOCKY_HOME: '~/env-clocky' })).toBe(resolve('/tmp/explicit-clocky'))
    expect(resolveClockyHome(undefined, { CLOCKY_HOME: '~/env-clocky' })).toBe(envHome)
    expect(resolveClockyHome(undefined, {})).toBe(defaultClockyHome())
  })

  it('treats an empty or whitespace-only CLOCKY_HOME as unset', () => {
    expect(resolveClockyHome(undefined, { CLOCKY_HOME: '' })).toBe(defaultClockyHome())
    expect(resolveClockyHome(undefined, { CLOCKY_HOME: '   ' })).toBe(defaultClockyHome())
  })

  it('joins child segments onto the resolved CLOCKY_HOME', () => {
    vi.stubEnv('CLOCKY_HOME', '~/env-clocky')
    expect(clockyHomePath()).toBe(join(homedir(), 'env-clocky'))
    expect(clockyHomePath('storages', 'cache')).toBe(join(homedir(), 'env-clocky', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(clockyHomeDisplay(resolve(defaultClockyHome()))).toBe('~/.clocky')
    expect(clockyHomeDisplay('/some/other/root')).toBe('$CLOCKY_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clocky-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
