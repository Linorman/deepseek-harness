/** Run the per-file coverage gate against packages with changed runtime sources. */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { COVERAGE_EXEMPT_ENV } from './coverage-exempt.ts'
import { COVERAGE_PARTITION_MODE_ENV } from './coverage-partitions.ts'
import { renderChangeScope } from './change-scope.ts'

const root = resolve(import.meta.dirname, '..')

interface ChangeScopeReport {
  readonly paths: {
    readonly committed: readonly string[]
    readonly staged: readonly string[]
    readonly unstaged: readonly string[]
    readonly untracked: readonly string[]
  }
}

/** Return the package directories whose TypeScript runtime sources changed. */
export function changedPackageDirectories(report: ChangeScopeReport, repositoryRoot = root): string[] {
  const packages = new Set<string>()
  for (const path of changedPackageSourceFiles(report, repositoryRoot)) {
    const match = /^packages\/([^/]+)\/([^/]+)\/src\//u.exec(path)
    if (match !== null) packages.add(`packages/${match[1]}/${match[2]}`)
  }
  return [...packages].sort()
}

/** Return existing changed runtime source files, excluding declarations and deleted paths. */
export function changedPackageSourceFiles(report: ChangeScopeReport, repositoryRoot = root): string[] {
  const paths = [
    ...report.paths.committed,
    ...report.paths.staged,
    ...report.paths.unstaged,
    ...report.paths.untracked,
  ]
  return [...new Set(paths)].filter((path) => {
    if (path.endsWith('.d.ts') || path.endsWith('.d.tsx') || path.endsWith('/types.ts')) return false
    if (!/^packages\/[^/]+\/[^/]+\/src\/.+\.(?:ts|tsx)$/u.test(path)) return false
    const match = /^packages\/([^/]+)\/([^/]+)\/src\//u.exec(path)
    return match !== null
      && existsSync(join(repositoryRoot, `packages/${match[1]}/${match[2]}`, 'package.json'))
      && existsSync(join(repositoryRoot, path))
  }).sort()
}

/** Pick a locally resolvable base ref for the change-scope report. */
export function changeBaseRef(repositoryRoot = root): string {
  const explicit = process.env.CLOCKY_CHANGE_BASE
  if (explicit !== undefined && explicit !== '') return explicit
  const pullRequestBase = process.env.GITHUB_BASE_REF
  if (pullRequestBase !== undefined && pullRequestBase !== '') {
    const remote = `origin/${pullRequestBase}`
    if (resolvesCommit(repositoryRoot, remote)) return remote
    throw new Error(
      `changed-package-coverage: pull-request base ${JSON.stringify(remote)} is unavailable; `
      + 'fetch the base ref or set CLOCKY_CHANGE_BASE to its commit',
    )
  }
  return 'HEAD'
}

/** Run one changed-package coverage report from the repository-local temp root. */
export function runChangedPackageCoverage(repositoryRoot = root): number {
  const tempRoot = resolve(repositoryRoot, '.tmp')
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 })
  const coverageDirectory = mkdtempSync(join(tempRoot, 'coverage-changed-'))
  const base = changeBaseRef(repositoryRoot)
  try {
    const report = JSON.parse(renderChangeScope(['--base', base], repositoryRoot)) as ChangeScopeReport
    const sourceFiles = changedPackageSourceFiles(report, repositoryRoot)
    const packages = changedPackageDirectories(report, repositoryRoot)
    if (packages.length === 0) {
      console.log(`changed-package-coverage: no changed package runtime sources against ${base}`)
      return 0
    }

    const args = [
      'exec',
      'vitest',
      'run',
      ...packages.map(directory => join(directory, 'tests')),
      '--coverage',
      '--coverage.reportOnFailure',
      `--coverage.reportsDirectory=${relative(repositoryRoot, coverageDirectory)}`,
      ...sourceFiles.map(path => `--coverage.include=${path}`),
    ]
    const npmExecpath = process.env.npm_execpath
    const environment: NodeJS.ProcessEnv = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (name !== COVERAGE_EXEMPT_ENV && name !== COVERAGE_PARTITION_MODE_ENV) environment[name] = value
    }
    environment.CLOCKY_CHANGED_COVERAGE = '1'
    const command = npmExecpath === undefined || npmExecpath === ''
      ? process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
      : process.execPath
    const commandArgs = npmExecpath === undefined || npmExecpath === '' ? args : [npmExecpath, ...args]
    console.log(`changed-package-coverage: checking ${packages.join(', ')}`)
    const result = spawnSync(command, commandArgs, { cwd: repositoryRoot, env: environment, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    return result.status ?? 1
  } finally {
    rmSync(coverageDirectory, { recursive: true, force: true })
  }
}

/** Check one Git ref without changing repository state. */
function resolvesCommit(repositoryRoot: string, ref: string): boolean {
  return spawnSync('git', ['-C', repositoryRoot, 'rev-parse', '--verify', `${ref}^{commit}`], {
    stdio: 'ignore',
  }).status === 0
}

if (import.meta.main) process.exitCode = runChangedPackageCoverage()
