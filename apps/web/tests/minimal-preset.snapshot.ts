import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@clocky/clocky-agent'
import { CallId, createUserMessage } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-system-prompt'
import { assertFixtureInventory, launchWebScaffold, type WebScaffold } from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/minimal-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const PROMPT = 'Reply exactly MINIMAL_PRESET_REQUEST_OK and stop.'

describe('minimal agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let disposeInjectedPrompt: () => void

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE })
    disposeInjectedPrompt = scaffold.ctx.systemPrompt.section({
      name: 'test:injected-prompt',
      order: 999,
      text: 'THIS TEXT MUST NOT REACH THE MODEL.',
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('minimal-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'test-provider', model: 'test-model' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    try {
      disposeInjectedPrompt?.()
    } catch (error: unknown) {
      failures.push(error)
    }
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'minimal preset smoke teardown failed')
  })

  it('sends the exact RL prompt and schemas, then executes the persistent shell and editor', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the minimal agent issued no model request')
    expect(agentHandle.agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@clocky/clocky-system-prompt')).toBe(true)
    const runtimeContext = agentHandle.agent.session.events.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@clocky/clocky-system-prompt'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    expect(runtimeContext.some(text => text.includes('Current Clocky file policy: workspace-write'))).toBe(true)
    expect(runtimeContext.some(text => text.includes(JSON.stringify(scaffold.workspaceCwd)))).toBe(true)
    expect(runtimeContext.some(text => text.includes('Approval policy: ask.'))).toBe(true)
    // The filesystem is host-owned and inherited by the preset; the denied
    // mutation below proves the scoped editor uses that enforcing provider.
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeUndefined()

    const stateDir = join(scaffold.workspaceCwd, 'persistent-state')
    await mkdir(stateDir)
    const signal = new AbortController().signal
    await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-bash-state-setup'),
      name: 'bash',
      arguments: { command: `cd ${JSON.stringify(stateDir)} && export CLOCKY_MINIMAL_STATE=PERSISTED` },
      agent: agentHandle.agent,
    })
    const bash = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-bash-state-read'),
      name: 'bash',
      arguments: { command: 'printf \'%s:%s\n\' "$CLOCKY_MINIMAL_STATE" "$PWD"' },
      agent: agentHandle.agent,
    })
    const seedPath = join(scaffold.workspaceCwd, 'preset-smoke.txt')
    await writeFile(seedPath, 'MINIMAL_EDITOR_OK\n')
    const editor = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-editor-smoke'),
      name: 'str_replace_editor',
      arguments: { command: 'view', path: seedPath },
      agent: agentHandle.agent,
    })
    const outsidePath = join(process.cwd(), '.tmp', 'minimal-preset-outside.txt')
    const outside = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-editor-outside'),
      name: 'str_replace_editor',
      arguments: { command: 'create', path: outsidePath, file_text: 'MUST_NOT_WRITE' },
      agent: agentHandle.agent,
    })

    const text = (result: typeof bash): string => result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .replaceAll(scaffold.workspaceCwd, '{{cwd}}')
      .trimEnd()

    expect({
      prompt: requestHeader.system,
      tools: requestHeader.tools?.map(tool => tool.name),
      bash: text(bash),
      editor: text(editor),
    }).toMatchInlineSnapshot(`
      {
        "bash": "PERSISTED:{{cwd}}/persistent-state",
        "editor": "Here's the content of {{cwd}}/preset-smoke.txt with line numbers (which has a total of 2 lines):
           1  MINIMAL_EDITOR_OK
           2",
        "prompt": "You are a helpful software engineer assistant.",
        "tools": [
          "bash",
          "str_replace_editor",
        ],
      }
    `)
    expect(outside.isError).toBe(true)
    expect(text(outside)).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
  })
})
