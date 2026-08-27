/**
 * Registry tests for `@clocky/clocky-shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { CallId } from '@clocky/clocky-llm'
import type { Agent } from '@clocky/clocky-agent'
import type { ToolExecution } from '@clocky/clocky-tools'
import { ShellEnvRegistry } from '@clocky/clocky-shell-env'
import * as BashEnvPlugin from '@clocky/clocky-shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: CallId('bash-env-call'),
    rootCallId: CallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : { agent: { session: { header: { version: 0, id: sessionId, createdAt: 0 } } } as Agent }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { clockyHome: './test-clocky-home' })

    expect(registry.collect(execution())).toEqual({
      CLOCKY_HOME: resolve('./test-clocky-home'),
      CLOCKY_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      CLOCKY_HOME: resolve('./test-clocky-home'),
      CLOCKY_SESSION_ID: 'session-a',
      CLOCKY_SHELL: '1',
    })
  })

  it('resolves CLOCKY_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('CLOCKY_HOME', './ambient-clocky-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).CLOCKY_HOME).toBe(resolve('./ambient-clocky-home'))

    vi.stubEnv('CLOCKY_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).CLOCKY_HOME).toBe(join(homedir(), '.clocky'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { clockyHome: './test-clocky-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        CLOCKY_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { CLOCKY_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        CLOCKY_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ CLOCKY_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('CLOCKY_SESSION_OPTIONAL')
    expect(registry.collect(execution()).CLOCKY_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).CLOCKY_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'CLOCKY_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'CLOCKY_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { clockyHome: './test-clocky-home' })
    registry.register({
      name: 'first',
      variables: { CLOCKY_SHARED: { description: 'First owner.' } },
      resolve: () => ({ CLOCKY_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { CLOCKY_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ CLOCKY_SHARED: 'second' }),
    })).toThrow(/CLOCKY_SHARED.*first.*second|CLOCKY_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { clockyHome: './test-clocky-home' })
    registry.register({
      name: 'declared',
      variables: { CLOCKY_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { CLOCKY_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { CLOCKY_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { clocky_invalid: { description: 'Invalid key.' } } as unknown as Record<'CLOCKY_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { CLOCKY_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { CLOCKY_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { clockyHome: './test-clocky-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { CLOCKY_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ CLOCKY_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*CLOCKY_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { clockyHome: './test-clocky-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { CLOCKY_STRING: { description: 'String fact.' } },
      resolve: () => ({ CLOCKY_STRING: 42 }) as unknown as Record<'CLOCKY_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*CLOCKY_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { clockyHome: './test-clocky-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { CLOCKY_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ CLOCKY_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).CLOCKY_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('CLOCKY_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { clockyHome: './test-clocky-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { CLOCKY_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ CLOCKY_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).CLOCKY_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('CLOCKY_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service and the persistence contributor on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([
      {
        contributor: 'session-persistence',
        description: 'Absolute target path of the current session JSONL when the active persistence backend provides one.',
        key: 'CLOCKY_SESSION_JSONL',
      },
    ])
  })

  it('the persistence contributor resolves CLOCKY_SESSION_JSONL only for a jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'jsonl' as const, path: 'C:\\sessions\\s.jsonl' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p')).CLOCKY_SESSION_JSONL).toBe('C:\\sessions\\s.jsonl')
  })

  it('the persistence contributor omits the variable for a non-jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'sqlite' as const, path: 'C:\\sessions\\s.db' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('CLOCKY_SESSION_JSONL')
  })

  it('the persistence contributor omits the variable without a persistence backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('CLOCKY_SESSION_JSONL')
  })
})
