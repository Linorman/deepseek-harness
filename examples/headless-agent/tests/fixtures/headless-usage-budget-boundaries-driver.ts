/** Test deployment creates typed-budget Teams; real Agents, usage observers and closure drivers enforce them. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import type { Context } from '@clocky/cordis'
import { createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import type {
  JsonObject, TeamAuditEntry, TeamId, TeamSystemRootCreationProof, TeamSystemRootCreationScope,
  TeamSystemTopologyProof, TeamSystemTopologyScope,
} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-team-closure-driver'
import { TeamLinkError } from '@clocky/clocky-team-link'

class UsageModel extends LlmAdapter {
  requests = 0
  private readonly inputTokens: number
  private readonly outputTokens: number
  constructor(inputTokens: number, outputTokens: number) {
    super()
    this.inputTokens = inputTokens
    this.outputTokens = outputTokens
  }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Accounted observation.' } }
    if (options.purpose !== 'session-title') {
      this.requests += 1
      yield { type: 'usage', usage: { inputTokens: this.inputTokens, outputTokens: this.outputTokens } }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function token(): object {
  return Object.freeze({ toJSON(): never { throw new TypeError('Deployment authority is runtime-only') } })
}

/** Root creation is fixture-owned because shipped TeamRun.create does not accept typed budget configuration. */
function deployment(ctx: Context) {
  const roots = new WeakMap<TeamSystemRootCreationProof, TeamSystemRootCreationScope>()
  const topology = new WeakMap<TeamSystemTopologyProof, TeamSystemTopologyScope>()
  ctx.teams.registerSystemRootCreationProofSource({ name: 'team-run', resolveRootCreationProof: actor => roots.get(actor) })
  ctx.teams.registerSystemTopologyProofSource({ name: 'team-run', resolveTopologyProof: actor => topology.get(actor) })
  return {
    async create(objective: string, budgets: JsonObject) {
      const scope: TeamSystemRootCreationScope = { kind: 'team-run-root-create', goal: { objective, budgets: {} }, rules: {}, budgets }
      const actor = token() as TeamSystemRootCreationProof
      roots.set(actor, scope)
      try { return await ctx.teams.createTeam({ actor, goal: scope.goal, rules: scope.rules, budgets: scope.budgets }) }
      finally { roots.delete(actor) }
    },
    async withTopology<T>(scope: TeamSystemTopologyScope, operation: (actor: TeamSystemTopologyProof) => Promise<T>) {
      const actor = token() as TeamSystemTopologyProof
      topology.set(actor, scope)
      try { return await operation(actor) }
      finally { topology.delete(actor) }
    },
  }
}

async function usageRecords(ctx: Context, teamId: TeamId): Promise<TeamAuditEntry[]> {
  const entries: TeamAuditEntry[] = []
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    entries.push(...page.items.filter(entry => entry.type === 'usage/changed'))
    if (page.nextCursor === undefined) return entries
    afterCursor = page.nextCursor
  }
}

async function run(ctx: Context) {
  await ctx.get('loader')?.await()
  const owner = deployment(ctx)
  const scenarios = [
    { name: 'stricter-output', budgets: { maxOutputTokens: 20 }, inputTokens: 0, outputTokens: 1,
      code: 'TEAM_TOKEN_BUDGET_EXCEEDED', key: 'maxOutputTokens', limit: 1 },
    { name: 'fractional-cost', budgets: { maxCostUnits: 0.5 }, inputTokens: 1, outputTokens: 0,
      code: 'TEAM_COST_BUDGET_EXCEEDED', key: 'maxCostUnits', limit: 0.5 },
    { name: 'zero-input', budgets: { maxInputTokens: 0 }, inputTokens: 0, outputTokens: 0,
      code: 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED', key: 'maxInputTokens', limit: 0 },
  ]
  const results: JsonObject[] = []
  for (const scenario of scenarios) {
    const provider = `usage-boundary-${scenario.name}`
    const model = new UsageModel(scenario.inputTokens, scenario.outputTokens)
    ctx.llm.registerAdapter([provider], model)
    const created = await owner.create(scenario.name, scenario.budgets)
    const teamId = created.team.id
    const participant = { kind: 'local-agent' as const, displayName: 'Budget reporter', role: 'worker', capabilities: [] }
    const invited = await owner.withTopology({ kind: 'team-run-bootstrap-participant-invite', teamId,
      expectedCursor: created.team.cursor, participant },
    async actor => await ctx.teams.inviteParticipant({ actor, teamId, expectedCursor: created.team.cursor, ...participant }))
    for (const [expectedPhase, phase] of [['invited', 'provisioning'], ['provisioning', 'active']] as const) {
      const expectedCursor = (await ctx.teams.getTeam({ teamId })).team.cursor
      await owner.withTopology({ kind: 'team-run-bootstrap-participant-phase', teamId, participantId: invited.id,
        expectedCursor, expectedPhase, phase }, async actor => await ctx.teams.transitionParticipantPhase({
        actor, teamId, participantId: invited.id, expectedCursor, phase,
      }))
    }
    const activation = { teamId, participantId: invited.id, provider: 'in-process',
      sessionId: SessionId(`usage-boundary-${randomUUID()}`), seed: { kind: 'fresh' as const },
      agent: { cwd: process.cwd(), options: { provider, model: provider } }, signal: new AbortController().signal }
    if (scenario.limit === 0) {
      await ctx.teamClosureDriver.drive()
      await assert.rejects(ctx.teamActivations.activate({ ...activation,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor }), { code: 'TEAM_INVALID_ARGUMENT' })
      assert.equal(model.requests, 0)
      assert.equal((await usageRecords(ctx, teamId)).length, 0)
    } else {
      const lease = await ctx.teamActivations.activate({ ...activation,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor })
      const agent = lease.localAgent
      assert(agent !== undefined)
      try {
        // A connected Link proves AgentClient completed workspace recovery before the first model step.
        let borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
        while (borrower === undefined) {
          await setImmediate()
          borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
        }
        for (;;) {
          let connected = false
          try { connected = await borrower.withLink(async () => true) }
          catch (error: unknown) {
            if (!(error instanceof TeamLinkError) || error.code !== 'TEAM_LINK_BOUND_LINK_UNAVAILABLE') throw error
          }
          if (connected) break
          await setImmediate()
        }
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Produce one accounted observation.' }], source: { kind: 'user' } }))
        await agent.whenIdle()
        await ctx.sessions.flush(agent.session)
        assert.equal(model.requests, 1)
        const message = agent.session.events.filter(event => event.type === 'assistant/message' && event.data.usage !== undefined)
        assert.equal(message.length, 1)
        for (;;) {
          const state = await ctx.teams.getTeam({ teamId })
          if ((await usageRecords(ctx, teamId)).length === 1) break
          await ctx.teams.watchTeam({ teamId, afterCursor: state.team.cursor })
        }
        assert.equal((await ctx.teams.getTeam({ teamId })).team.phase, 'active')
        await ctx.teamClosureDriver.drive()
      } finally { await lease.dispose() }
    }
    const final = await ctx.teams.getTeam({ teamId })
    assert.equal(final.team.phase, 'stalled')
    assert.deepEqual(final.team.stallReason, { code: scenario.code,
      message: `Team '${teamId}' reached its ${scenario.key} budget of ${scenario.limit}` })
    assert(final.activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
    results.push({ scenario: scenario.name, phase: final.team.phase, reason: scenario.code, limit: scenario.limit,
      modelRequests: model.requests, usageRecords: (await usageRecords(ctx, teamId)).length,
      inputTokens: final.usage?.inputTokens ?? 0, outputTokens: final.usage?.outputTokens ?? 0, costUnits: final.usage?.costUnits ?? 0 })
  }
  return { producer: 'team-agent-client', observer: 'team-closure-driver', scenarios: results }
}

/** Test deployment plugin identity. */
export const name = 'usage-budget-boundaries-driver'
/** Real usage, activation and closure owners required before the fixture starts. */
export const inject = ['teams', 'llm', 'sessions', 'teamActivations', 'teamLinks', 'teamClosureDriver']

/** Run the budget fixture in the actual Loader composition. @param ctx - Loaded application context. */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx).then((output) => {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
