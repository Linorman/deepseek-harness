/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkPrivateCompatibilityDependencyIsolation,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@clocky/clocky-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@clocky/clocky-prototype' },
    })).toEqual([
      '@clocky/clocky-prototype: experimental package name must start with "@clocky/clocky-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@clocky/clocky-experimental-prototype: experimental package must set "private": true',
      '@clocky/clocky-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@clocky/clocky-consumer',
          [section]: { '@clocky/clocky-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@clocky/clocky-consumer: ${section}.@clocky/clocky-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@clocky/clocky-test-only',
        devDependencies: { '@clocky/clocky-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@clocky/clocky-experimental-consumer',
        dependencies: { '@clocky/clocky-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@clocky/clocky-python-runtime',
        dependencies: { '@clocky/clocky-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@clocky/clocky-python-runtime: dependencies.@clocky/clocky-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('private compatibility workspace constraints', () => {
  const compatibility: WorkspaceManifest = {
    dir: 'packages/subagent/subagent',
    manifest: { name: '@clocky/clocky-subagent', private: true },
  }

  it('requires private compatibility manifests without publication metadata', () => {
    expect(checkPrivateCompatibilityDependencyIsolation([compatibility])).toEqual([])
  })

  it('rejects release and Python runtime dependencies on compatibility packages', () => {
    const consumers: WorkspaceManifest[] = [
      compatibility,
      {
        dir: 'packages/core/consumer',
        manifest: { name: '@clocky/clocky-consumer', dependencies: { '@clocky/clocky-subagent': 'workspace:^' } },
      },
      {
        dir: 'python/sdk-runtime',
        manifest: { name: 'clocky-jsonrpc-agent-pkg', dependencies: { '@clocky/clocky-subagent': 'workspace:^' } },
      },
    ]

    expect(checkPrivateCompatibilityDependencyIsolation(consumers)).toEqual([
      '@clocky/clocky-consumer: dependencies.@clocky/clocky-subagent must not reference a private compatibility package',
      'clocky-jsonrpc-agent-pkg: dependencies.@clocky/clocky-subagent must not reference a private compatibility package',
    ])
  })
})
