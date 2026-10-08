import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@clocky/cordis'
import { AcpProvider, apply, Config, inject, name } from '../src/index.ts'

describe('ACP Team AgentRuntime provider', () => {
  it('exposes a bounded provider configuration and Team-capable injection contract', () => {
    const config = Config({ command: 'clocky-acp-agent' })

    expect(name).toBe('agent-runtime-acp')
    expect(inject).toEqual(['agentRuntimes', 'subprocess', 'sessions', 'sessionPersistence'])
    expect(config).toMatchObject({
      command: 'clocky-acp-agent',
      args: [],
      env: {},
      disposeEofGraceMs: 6_000,
      teamLinkProviderPrefix: 'acp-link',
      teamLinkReconnectDelayMs: 100,
    })
  })

  it('rejects timer values beyond Node’s safe delay range', () => {
    const maximum = 2_147_483_647
    expect(() => Config({ command: 'clocky-acp-agent', disposeEofGraceMs: maximum + 1 })).toThrow()
    expect(() => Config({ command: 'clocky-acp-agent', teamLinkReconnectDelayMs: maximum + 1 })).toThrow()
  })
})

/** Exercise loader-facing config rejection before any runtime contribution is registered. */
it.each([
  [{ recoverySupervisor: { name: 'supervisor', version: 1, endpointId: 'endpoint' } }, 'requires recoveryProfile'],
  [{ recoveryProfile: 'profile' }, 'must be configured together'],
  [{ recoveryHostId: 'host' }, 'must be configured together'],
  [{ recoveryFenceGraceMs: 100 }, 'must be configured together'],
  [{ recoveryProfile: ' ', recoveryHostId: 'host' }, 'recoveryProfile must be non-empty'],
  [{ recoveryProfile: ' profile', recoveryHostId: 'host' }, 'recoveryProfile must be non-empty'],
  [{ recoveryProfile: 'profile', recoveryHostId: ' host ' }, 'recoveryHostId must be non-empty'],
  ...[0, -1, 1.5, 2_147_483_648].map(recoveryFenceGraceMs => [
    { recoveryProfile: 'profile', recoveryHostId: 'host', recoveryFenceGraceMs }, 'positive safe integer',
  ] as const),
] satisfies ReadonlyArray<readonly [Partial<Config>, string]>)('rejects incomplete or unsafe recovery configuration %j', (config, message) => {
  const effect = vi.fn()
  const ctx = { effect } as unknown as Context
  expect(() => { apply(ctx, { command: 'agent', ...config }) }).toThrow(message)
  expect(effect).not.toHaveBeenCalled()
})

it('refuses future activation after provider admission is retired', async () => {
  const provider = new AcpProvider({} as Context, 'acp', {
    providerName: 'acp', command: 'agent', args: [], env: {}, disposeEofGraceMs: 100,
    teamLinkProviderPrefix: 'link', teamLinkReconnectDelayMs: 100,
  }, undefined)
  provider.closeAdmission()
  await expect(provider.activate({} as never)).rejects.toThrow("provider 'acp' is closed")
})

it('rejects recovery when the process inspector cannot prove exact creation identity', () => {
  const ctx = {} as Context
  const config = {
    providerName: 'acp', command: 'agent', args: [], env: {}, disposeEofGraceMs: 100,
    teamLinkProviderPrefix: 'link', teamLinkReconnectDelayMs: 100,
    recovery: { profile: 'local', hostId: 'host', fenceGraceMs: 100 },
  }
  expect(() => new AcpProvider(ctx, 'acp', config, { hasExactIdentity: false } as never))
    .toThrow('requires exact local process creation identities')
  expect(() => new AcpProvider(ctx, 'acp', config, undefined)).toThrow('requires exact local process creation identities')
})
