import { Context } from '@clocky/cordis'
import ProductPrincipalRegistry, {
  ProductPrincipalError,
  productPrincipalId,
} from '@clocky/clocky-product-principal'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { JsonRpcLineTransport } from '@clocky/clocky-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '@clocky/clocky-sdk-jsonrpc-server'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as ToolTeam from '@clocky/clocky-tool-team'

const root = process.env.CLOCKY_REMOTE_LINK_SESSION_ROOT
if (root === undefined || root.length === 0) throw new Error('CLOCKY_REMOTE_LINK_SESSION_ROOT is required')
const REMOTE_SDK_TEST_CREDENTIAL = 'sdk-remote-test-credential'

class MockAdapter extends LlmAdapter {
  private reported = false
  private finalized = false

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const assignment = options.messages.find(message => message.source?.kind === 'team-task-assignment')?.source
    if (!this.reported && assignment?.kind === 'team-task-assignment') {
      this.reported = true
      const argumentsJson = JSON.stringify({
        task_id: assignment.taskId,
        attempt_id: assignment.attemptId,
        outcome: 'completed',
        summary: 'SDK remote worker completed its assigned task.',
      })
      const callId = CallId('sdk-remote-team-task-report')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'team_task_report', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'team_task_report', arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const direct = options.messages.find(message => message.source?.kind === 'team-envelope')?.source
    const waitsForInterrupt = options.messages.some(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Wait for a remote soft interrupt.')))
    if (direct?.kind === 'team-envelope' && waitsForInterrupt) {
      const signal = options.signal
      if (signal === undefined) throw new Error('SDK remote interrupt fixture requires a turn signal')
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      }
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Team soft interrupt' } } }
      return
    }
    const requestsFinal = options.messages.some(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Emit a remote final.')))
    if (!this.finalized && direct?.kind === 'team-envelope' && requestsFinal) {
      this.finalized = true
      const argumentsJson = JSON.stringify({
        channel_id: direct.channelId,
        text: 'SDK remote coordinator final.',
      })
      const callId = CallId('sdk-remote-team-final')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'team_final', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'team_final', arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const ctx = new Context()
await ctx.plugin(ProductPrincipalRegistry)
ctx.productPrincipals.registerProvider({
  name: 'local',
  async authenticate(request) {
    if (request.credential === undefined || request.credential.length === 0) {
      throw new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
    }
    if (request.credential !== REMOTE_SDK_TEST_CREDENTIAL) {
      throw new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
    }
    const controller = new AbortController()
    return {
      principal: Object.freeze({
        id: productPrincipalId('sdk-remote-test-principal'),
        issuer: 'local',
        subject: 'sdk-remote-test',
        assurance: 'test',
        credentialGeneration: 1,
      }),
      signal: controller.signal,
      revoke: () => { controller.abort() },
    }
  },
})
await mountAgentLoopTestDependencies(ctx)
ctx.llm.registerAdapter(['mock'], new MockAdapter())
await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(TeamLinkRegistry)
await ctx.plugin(ToolTeam)

const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
const server = new HarnessSdkJsonRpcServer(ctx, transport)
let shutdown: Promise<void> | undefined

transport.onRequest(async (method, params) => {
  const result = await server.handleRequest(method, params)
  if (method === 'shutdown') {
    setImmediate(() => {
      shutdown ??= (async () => {
        await transport.flush()
        transport.close()
        await ctx.fiber.dispose()
        process.exit(0)
      })()
    })
  }
  return result
})
transport.start()
