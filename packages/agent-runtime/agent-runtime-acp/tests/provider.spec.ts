import { describe, expect, it } from 'vitest'
import { Config, inject, name } from '../src/index.ts'

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
