/** Real coordinator/worker tools produce shared-root observations without an artifact provider. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { teamWorkspaceObservationSchema } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'workspace-observation-model'
const finishCoordinator = Promise.withResolvers<undefined>()
function calls(messages: GenerateOptions['messages'], name: string): boolean {
  return messages.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'tool-call' && block.name === name))
}
function assignment(messages: GenerateOptions['messages']): { taskId: string; attemptId: string } | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text' || !block.text.startsWith('Team task assignment:')) continue
      const match = /\nTask: (\S+)\nAttempt: (\S+)/u.exec(block.text)
      assert(match?.[1] !== undefined && match[2] !== undefined)
      return { taskId: match[1], attemptId: match[2] }
    }
  }
  return undefined
}
function tool(name: string, args: Record<string, unknown>): StreamChunk[] {
  const id = CallId(`observation-${name}`)
  const value = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: value },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: value } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
class ObservationModel extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title') {
      const task = assignment(options.messages)
      if (task !== undefined) {
        const next = !calls(options.messages, 'write')
          ? tool('write', { file_path: 'declared/from-fs.txt', content: 'Written by the actual FS tool.\n' })
          : !calls(options.messages, 'bash')
            ? tool('bash', { command: "printf 'Written by the actual shell.\\n' > undeclared-from-shell.txt", description: 'Write the workspace observation sample' })
            : !calls(options.messages, 'team_task_report')
              ? tool('team_task_report', { task_id: task.taskId, attempt_id: task.attemptId, outcome: 'completed', summary: 'The workspace samples are written.' })
              : undefined
        if (next !== undefined) { yield* next; return }
      } else if (!calls(options.messages, 'team_task_start') && options.messages.some(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text.includes('Start workspace observation.')))) {
        yield* tool('team_task_start', { subject: 'Observe actual shared workspace writes.',
          instructions: 'Write the two requested files with FS and shell tools, then report completion.', read_scopes: [], write_scopes: ['declared'] })
        return
      } else if (calls(options.messages, 'team_task_start')) {
        const aborted = Promise.withResolvers<undefined>()
        const cancel = (): void => { aborted.resolve(undefined) }
        options.signal?.addEventListener('abort', cancel, { once: true })
        try { await Promise.race([finishCoordinator.promise, aborted.promise]) } finally { options.signal?.removeEventListener('abort', cancel) }
      }
    }
    const text = 'Workspace observation recorded.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function run(ctx: Context, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: 'Observe shared workspace changes.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL } })
  await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, content: [{ type: 'text', text: 'Start workspace observation.' }] })
  let state = await ctx.teams.getTeam({ teamId: handle.teamId })
  for (;;) {
    if (state.workspaceAllocations.some(allocation => allocation.lifecycle === 'released')) break
    assert.equal(state.team.phase, 'active', JSON.stringify(state))
    await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: state.team.cursor })
    state = await ctx.teams.getTeam({ teamId: handle.teamId })
  }
  const allocation = state.workspaceAllocations[0]
  assert(allocation !== undefined)
  const task = state.tasks.find(value => value.id === allocation.taskId)
  const outcome = task?.attemptHistory.find(value => value.id === allocation.attemptId)?.outcome
  assert(outcome?.kind === 'completed')
  assert.deepEqual(outcome.result.changedPaths, ['declared/from-fs.txt', 'undeclared-from-shell.txt'])
  assert.equal(outcome.result.artifacts?.length ?? 0, 0)
  const audit = await ctx.teams.readAudit({ teamId: handle.teamId, afterCursor: -1, limit: 128 })
  const observations = audit.items.filter(item => item.type === 'workspace/observed')
    .map(item => teamWorkspaceObservationSchema.parse(item.facts['observation']))
  assert.deepEqual(observations.map(value => value.stage), ['baseline', 'publish', 'release'])
  const publication = observations.find(value => value.stage === 'publish')
  assert(publication !== undefined)
  assert.deepEqual(publication.paths, [
    { path: 'declared/from-fs.txt', change: 'added', classification: 'declared' },
    { path: 'undeclared-from-shell.txt', change: 'added', classification: 'undeclared' },
  ])
  assert.equal(publication.truncated, false)
  assert.equal(allocation.observation?.stage, 'release')
  assert.equal(allocation.observation.truncated, false)
  assert.equal(await readFile(join(process.cwd(), 'declared/from-fs.txt'), 'utf8'), 'Written by the actual FS tool.\n')
  assert.equal(await readFile(join(process.cwd(), 'undeclared-from-shell.txt'), 'utf8'), 'Written by the actual shell.\n')
  finishCoordinator.resolve(undefined)
  await handle.coordinatorLease.localAgent?.whenIdle()
  process.stdout.write(`${JSON.stringify({ provider: allocation.provider, artifactCount: outcome.result.artifacts?.length ?? 0,
    stages: observations.map(value => value.stage), paths: publication.paths, truncated: publication.truncated,
    allocation: allocation.lifecycle, sourceVersionChanged: publication.base?.digest !== publication.final.digest })}\n`)
  exit(0)
}
export const name = 'headless-workspace-observation-driver'
export const inject = ['llm', 'teamRuns', 'teams', 'agents']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter([MODEL], new ObservationModel()), 'observationFixture.model()')
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('Workspace observation fixture requires appExit')
  void run(ctx, exit).catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); exit(1) })
}
