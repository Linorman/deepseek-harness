/** Authenticated task-linked consult input, keyed retry and restart through the real Host composition. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import type { Context } from '@clocky/cordis'
import { InProcessApiClient, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import type { RpcResponse } from '@clocky/clocky-host-apiproxy'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { channelInvitationIdempotencyKeySchema, channelPostIdempotencyKeySchema, teamTaskCreateIdempotencyKeySchema,
  teamTaskIdSchema, teamEnvelopeSchema, channelIdSchema, teamIdSchema } from '@clocky/clocky-team'

class QuietModel extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

function value<T>(response: RpcResponse<T>): T {
  assert(response.result.ok, JSON.stringify(response.result))
  return response.result.value
}

async function run(ctx: Context) {
  await ctx.get('loader')?.await()
  const lease = await ctx.productPrincipals.authenticate({ provider: 'human-inbox-fixture', credential: 'keyless-human-inbox' })
  try {
    return await lease.withCall(async (call) => {
      const client = new InProcessApiClient(toFetchHandler(ctx.apiProxy, { authenticatedProductCall: call }))
      const stateFile = 'channel-task-input.json'
      if (process.env.CLOCKY_CHANNEL_INPUT_RESTART === '1') {
        const saved = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>
        const envelope = teamEnvelopeSchema.parse(saved.envelope)
        const channelId = channelIdSchema.parse(saved.channelId)
        const teamId = teamIdSchema.parse(saved.teamId)
        const retried = value(await client.teams.channelInput({ channelId, expectedCursor: 0,
          idempotencyKey: channelPostIdempotencyKeySchema.parse('task-consult'), audience: null,
          delivery: 'turn', content: [{ type: 'text', text: 'Task question' }], taskId: envelope.taskId }))
        assert.deepEqual(retried, envelope)
        const page = value(await client.teams.channelRead({ channelId, afterCursor: -1, limit: 32 }))
        assert.equal(page.records.filter(record => record.type === 'channel/envelope').length, 1)
        assert.equal(page.channel.phase, 'closed')
        assert.equal(envelope.teamId, teamId)
        return { phase: 'restart', retainedTask: true, originalEnvelope: true, envelopeCount: 1 }
      }
      const state = value(await client.teams.create({ objective: 'Task-linked consult retry.', cwd: process.cwd() }))
      const teamId = state.team.id
      const human = state.participants.find(member => member.role === 'human')
      const coordinator = state.participants.find(member => member.role === 'coordinator')
      assert(human !== undefined && coordinator !== undefined)
      const task = value(await client.teams.taskCreate({ teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
        idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('consult-task'), subject: 'Task question', description: 'Ask about a task.',
        blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }))
      const channel = value(await client.teams.channelOpen({ teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
        adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'directed', version: 1 }, limits: {},
        participants: [{ id: human.id, role: 'initiator' }, { id: coordinator.id, role: 'respondent' }] }))
      const channelId = channel.manifest.id
      const own = value(await client.teams.channelInvitation({ channelId }))
      value(await client.teams.channelInvitationAcknowledge({ channelId, revision: own.invitation.revision,
        manifestFingerprint: own.invitation.manifestFingerprint, idempotencyKey: channelInvitationIdempotencyKeySchema.parse('consult-consent') }))
      let current = await ctx.teams.getChannel({ channelId })
      while (current.phase === 'pending') {
        await ctx.teams.watchChannel({ channelId, afterCursor: current.cursor })
        current = await ctx.teams.getChannel({ channelId })
      }
      const input = { channelId, expectedCursor: current.cursor, taskId: task.id,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('task-consult'), audience: null,
        delivery: 'turn' as const, content: [{ type: 'text' as const, text: 'Task question' }] }
      const envelope = value(await client.teams.channelInput(input))
      assert.equal(envelope.kind, 'request')
      assert.equal(envelope.taskId, task.id)
      assert.deepEqual(value(await client.teams.channelInput(input)), envelope)
      assert.deepEqual(value(await client.teams.channelInput({ ...input, taskId: undefined })), envelope)
      const changed = await client.teams.channelInput({ ...input, taskId: teamTaskIdSchema.parse('another-task') })
      assert(!changed.result.ok && changed.result.error.code === 'team-channel-idempotency-conflict')
      value(await client.teams.channelClose({ channelId, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor }))
      assert.deepEqual(value(await client.teams.channelInput(input)), envelope)
      await writeFile(stateFile, `${JSON.stringify({ teamId, channelId, envelope })}\n`)
      return { phase: 'create', retainedTask: true, retryAfterAdvance: true, retryAfterClose: true, changedTask: 'conflict' }
    })
  } finally { await lease.revoke() }
}

export const name = 'channel-task-input-driver'
export const inject = ['apiProxy', 'teams', 'llm', 'productPrincipals']
/** Drive authenticated input against Loader-owned providers. @param ctx - Complete Host composition. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['human-question-model'], new QuietModel())
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx).then((output) => { process.stdout.write(`${JSON.stringify(output)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
