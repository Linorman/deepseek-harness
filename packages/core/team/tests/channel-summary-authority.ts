import type {
  ChannelSummarizeRequest,
  ChannelSummaryRecord,
  TeamSystemChannelSummaryProof,
  TeamSystemChannelSummaryProofSource,
  TeamSystemChannelSummaryScope,
} from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'

/**
 * Append one channel summary through a short-lived exact fixture proof.
 * This isolated provider fixture supplies exact output while retaining caller authorization.
 * @param ctx - isolated Hub fixture context without a summary owner.
 * @param input - complete JSON-only summary payload selected by the fixture.
 * @returns the durable summary record accepted by the Hub.
 */
export async function summarizeTestChannel(
  ctx: Context,
  input: Omit<ChannelSummarizeRequest, 'actor'>,
): Promise<ChannelSummaryRecord> {
  const { requester, ...payload } = input
  const scope: TeamSystemChannelSummaryScope = { kind: 'channel-summary', ...structuredClone(payload) }
  return await withTestChannelSummaryProof(ctx, scope, async actor =>
    await ctx.teams.summarizeChannel({ actor, requester, ...payload }))
}

/** Retain one exact channel summary scope only until its fixture Hub call settles. */
async function withTestChannelSummaryProof<T>(
  ctx: Context,
  scope: TeamSystemChannelSummaryScope,
  operation: (actor: TeamSystemChannelSummaryProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope>()
  const source: TeamSystemChannelSummaryProofSource = {
    name: 'team-channel-summary',
    resolveChannelSummaryProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemChannelSummaryProofSource(source)
  const proof = createTestChannelSummaryProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestChannelSummaryProof(): TeamSystemChannelSummaryProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test channel-summary proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelSummaryProof
}
