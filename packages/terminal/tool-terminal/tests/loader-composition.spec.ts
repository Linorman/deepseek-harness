import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import Include from '@clocky/cordis-plugin-include'
import { CallId } from '@clocky/clocky-llm'
import { Session, SessionId } from '@clocky/clocky-session'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import SystemPrompt from '@clocky/clocky-system-prompt'
import ToolRuntime from '@clocky/clocky-tools'
import TerminalSessionService from '@clocky/clocky-terminal'
import SandboxProvider from '@clocky/clocky-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@clocky/clocky-sandbox'
import SandboxPolicyService from '@clocky/clocky-sandbox-policy'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import * as TerminalLocal from '@clocky/clocky-terminal-bash'
import * as ToolPty from '@clocky/clocky-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'clocky-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@clocky/clocky-agent'",
      "- name: '@clocky/clocky-system-prompt'",
      "- name: '@clocky/clocky-tools'",
      "- name: '@clocky/clocky-terminal'",
      "- name: '@clocky/clocky-test-sandbox'",
      "- name: '@clocky/clocky-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@clocky/clocky-subprocess-local'",
      "- name: '@clocky/clocky-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@clocky/clocky-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@clocky/clocky-agent', AgentRegistry],
      ['@clocky/clocky-system-prompt', SystemPrompt],
      ['@clocky/clocky-tools', ToolRuntime],
      ['@clocky/clocky-terminal', TerminalSessionService],
      ['@clocky/clocky-test-sandbox', PassthroughSandbox],
      ['@clocky/clocky-sandbox-policy', SandboxPolicyService],
      ['@clocky/clocky-subprocess-local', LocalSubprocessRuntime],
      ['@clocky/clocky-terminal-bash', TerminalLocal],
      ['@clocky/clocky-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: CallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: CallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: CallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
