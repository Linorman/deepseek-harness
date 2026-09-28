/** Real coordinator/worker tools produce shared-root observations without an artifact provider. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { teamWorkspaceObservationSchema, teamWorkspaceAllocationIdSchema, teamWorkspaceExecutionWorldSchema,
  teamClosureIdempotencyKeySchema } from '@clocky/clocky-team'
import { TeamWorkspaceLostError } from '@clocky/clocky-team-workspace'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import { AgentWorkspaceUnavailableError, resolveAgentWorkspaceRoot } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'workspace-observation-model'
const finishCoordinator = Promise.withResolvers<undefined>()
/** Select an external execution-world failure before the worker receives its input. */
export interface Config { readonly materializationLoss: boolean; readonly unconfirmedRecovery: boolean; readonly closureLoss: boolean }
/** Keep the normal observation scenario as the default. */
export const Config: z<Config> = z.object({
  materializationLoss: z.boolean().default(false), unconfirmedRecovery: z.boolean().default(false),
  closureLoss: z.boolean().default(false),
})
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
  workerRequests = 0
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title') {
      const task = assignment(options.messages)
      if (task !== undefined) {
        this.workerRequests += 1
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
async function run(ctx: Context, exit: (code: number) => void, config: Config, model: ObservationModel,
  probe: { preparations: number; abandoned: number }, cleanup: Promise<undefined>,
  closure: PromiseWithResolvers<undefined>): Promise<void> {
  await ctx.get('loader')?.await()
  const handle = await ctx.teamRuns.create({ objective: 'Observe shared workspace changes.', cwd: process.cwd(),
    selection: { provider: MODEL, model: MODEL } })
  await ctx.teamRuns.postHumanInput({ teamId: handle.teamId, content: [{ type: 'text', text: 'Start workspace observation.' }] })
  let state = await ctx.teams.getTeam({ teamId: handle.teamId })
  for (;;) {
    if (config.closureLoss && state.workspaceAllocations.length > 0 && state.team.closure === undefined) {
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const actor = issuer.issue(handle.coordinatorLease.binding)
      try {
        await ctx.teams.failTeam({ actor: actor.proof, teamId: state.team.id, expectedCursor: state.team.cursor,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse('materialization-closure'),
          reason: { code: 'FIXTURE_FAILURE', message: 'Close while provider materialization is pending.' } })
      } finally { actor.revoke(); issuer.close() }
      const workerActivationId = state.workspaceAllocations[0]!.activationId
      for (;;) {
        const stopping = await ctx.teams.getTeam({ teamId: state.team.id })
        if (stopping.activations.every(binding => binding.activation.id === workerActivationId
          ? binding.activation.status === 'stopping' : binding.quiescedAt !== undefined)) break
        await ctx.teams.watchTeam({ teamId: state.team.id, afterCursor: stopping.team.cursor })
      }
      closure.resolve(undefined)
    }
    if (state.workspaceAllocations.some(allocation => allocation.lifecycle === (config.unconfirmedRecovery ? 'unavailable' : 'released'))
      && (!config.materializationLoss || state.tasks.some(task => task.attemptHistory.length > 0))) break
    assert(state.team.phase === 'active' || config.closureLoss && state.team.phase === 'quiescing'
      || config.unconfirmedRecovery && state.team.phase === 'stalled', JSON.stringify(state))
    await ctx.teams.watchTeam({ teamId: handle.teamId, afterCursor: state.team.cursor })
    state = await ctx.teams.getTeam({ teamId: handle.teamId })
  }
  const allocation = state.workspaceAllocations[0]
  assert(allocation !== undefined)
  const task = state.tasks.find(value => value.id === allocation.taskId)
  const outcome = task?.attemptHistory.find(value => value.id === allocation.attemptId)?.outcome
  if (config.materializationLoss) {
    await cleanup
    assert(outcome?.kind === 'failed' || outcome?.kind === 'released')
    assert.equal(outcome.kind, config.closureLoss ? 'released' : 'failed')
    if (outcome.kind === 'failed') assert.equal(outcome.failure.code, 'WORKSPACE_LOST')
    assert.equal(model.workerRequests, 0)
    assert.equal(probe.preparations, 1)
    assert.equal(probe.abandoned, 1)
    if (config.unconfirmedRecovery) {
      const worker = ctx.agents.get(allocation.sessionId)
      assert(worker !== undefined)
      const original = ctx.teamLinks.getBoundLinkBorrower(worker)
      assert(original instanceof TeamAgentClient.FixedBindingTeamAgentLinkDelivery)
      await original.close()
      const binding = state.activations.find(candidate => candidate.activation.id === allocation.activationId)
      assert(binding !== undefined)
      const delivery = new TeamAgentClient.FixedBindingTeamAgentLinkDelivery(ctx, { agent: worker, binding }, { consumeWorkspace: true })
      const recovered = Promise.withResolvers<undefined>()
      const connect = ctx.teamLinks.connect.bind(ctx.teamLinks)
      ctx.teamLinks.connect = async (request) => {
        if (request.binding.sessionId === worker.session.id) recovered.resolve(undefined)
        return await connect(request)
      }
      try {
        ctx.effect(() => { delivery.start(); return () => delivery.close() }, 'observationFixture.recoveredDelivery()')
        await recovered.promise
      } finally { ctx.teamLinks.connect = connect }
      assert.throws(() => resolveAgentWorkspaceRoot(worker), AgentWorkspaceUnavailableError)
      assert.equal(model.workerRequests, 0)
    }
    finishCoordinator.resolve(undefined)
    await handle.coordinatorLease.localAgent?.whenIdle()
    process.stdout.write(`${JSON.stringify({ provider: allocation.provider, allocation: allocation.lifecycle,
      task: task?.phase, ...outcome.kind === 'failed' ? { failure: outcome.failure.code } : {},
      workerRequests: model.workerRequests, ...probe,
      ...config.unconfirmedRecovery ? { recoveredRootUnavailable: true } : {} })}\n`)
    exit(0)
    return
  }
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
export const inject = ['llm', 'teamRuns', 'teams', 'agents', 'teamWorkspaces', 'teamLinks', 'sessions']
export function apply(ctx: Context, config: Config): void {
  const model = new ObservationModel()
  const probe = { preparations: 0, abandoned: 0 }
  const cleanup = Promise.withResolvers<undefined>()
  const closure = Promise.withResolvers<undefined>()
  ctx.effect(() => ctx.llm.registerAdapter([MODEL], model), 'observationFixture.model()')
  if (config.materializationLoss) {
    const world = teamWorkspaceExecutionWorldSchema.parse({ kind: 'e2b', id: 'materialization-loss-world' })
    ctx.effect(() => ctx.teamWorkspaces.registerProvider({
      name: 'materialization-loss', modes: ['shared'], async eligible() { return true },
      async prepare(request) {
        probe.preparations += 1
        return { ...request, id: teamWorkspaceAllocationIdSchema.parse(`loss:${request.attemptId}`),
          provider: 'materialization-loss', mode: 'shared', executionWorld: world,
          async materialize() {
            if (config.closureLoss) await closure.promise
            throw new TeamWorkspaceLostError({ executionWorld: world,
              reason: config.unconfirmedRecovery ? 'manifest-missing' : 'sandbox-expired',
              terminationProven: !config.unconfirmedRecovery, artifacts: [] })
          },
          async abandon() { probe.abandoned += 1; cleanup.resolve(undefined) },
        }
      },
      async restore() { throw new Error('Lost materialization has no restorable handle') },
      async reconcileRelease() { throw new Error('Lost materialization has no materialized handle') },
    }), 'observationFixture.workspaceLoss()')
  }
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('Workspace observation fixture requires appExit')
  void run(ctx, exit, config, model, probe, cleanup.promise, closure).catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`); exit(1)
  })
}
