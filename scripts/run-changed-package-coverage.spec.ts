import { describe, expect, it } from 'vitest'
import {
  changeBaseRef,
  changedPackageDirectories,
  changedPackageSourceFiles,
} from './run-changed-package-coverage.ts'

const repositoryRoot = process.cwd()

function withEnvironment<T>(name: string, value: string | undefined, operation: () => T): T {
  const prior = process.env[name]
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
  try {
    return operation()
  } finally {
    if (prior === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = prior
  }
}

describe('changed-package coverage scope', () => {
  it('selects only existing package runtime sources and their package roots', () => {
    const report = {
      paths: {
        committed: ['packages/core/product-principal/src/index.ts', 'packages/core/product-principal/src/types.ts'],
        staged: ['packages/core/product-principal/src/missing.ts'],
        unstaged: ['packages/core/product-principal/src/index.d.ts'],
        untracked: ['packages/core/product-principal/tests/registry.spec.ts'],
      },
    }

    expect(changedPackageSourceFiles(report, repositoryRoot)).toEqual([
      'packages/core/product-principal/src/index.ts',
    ])
    expect(changedPackageDirectories(report, repositoryRoot)).toEqual(['packages/core/product-principal'])
  })

  it('honors an explicit base even when pull-request metadata is present', () => {
    withEnvironment('GITHUB_BASE_REF', 'missing-base', () => {
      withEnvironment('CLOCKY_CHANGE_BASE', 'HEAD', () => {
        expect(changeBaseRef(repositoryRoot)).toBe('HEAD')
      })
    })
  })

  it('fails closed when a declared pull-request base is unavailable', () => {
    withEnvironment('CLOCKY_CHANGE_BASE', undefined, () => {
      withEnvironment('GITHUB_BASE_REF', 'missing-base', () => {
        expect(() => changeBaseRef(repositoryRoot)).toThrow(/pull-request base .* unavailable/u)
      })
    })
  })
})
