import type {
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemWorkspaceAllocationScope,
  TeamWorkspaceAllocationActivateInput,
  TeamWorkspaceAllocationPreserveInput,
  TeamWorkspaceAllocationReleaseInput,
  TeamWorkspaceAllocationReleaseRequestInput,
  TeamWorkspaceAllocationReserveInput,
  TeamWorkspaceAllocationSnapshot,
} from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'

/** Reserve one provider allocation through a short-lived exact fixture proof. */
export async function reserveTestWorkspaceAllocation(
  ctx: Context,
  input: TeamWorkspaceAllocationReserveInput,
): Promise<TeamWorkspaceAllocationSnapshot> {
  return await withTestWorkspaceAllocationProof(ctx, {
    kind: 'workspace-allocation-reserve', ...structuredClone(input),
  }, async actor => await ctx.teams.reserveWorkspaceAllocation({ actor, ...input }))
}

/** Mark one provider allocation active through a short-lived exact fixture proof. */
export async function activateTestWorkspaceAllocation(
  ctx: Context,
  input: TeamWorkspaceAllocationActivateInput,
): Promise<TeamWorkspaceAllocationSnapshot> {
  return await withTestWorkspaceAllocationProof(ctx, {
    kind: 'workspace-allocation-activate', ...structuredClone(input),
  }, async actor => await ctx.teams.activateWorkspaceAllocation({ actor, ...input }))
}

/** Persist allocation release intent through a short-lived exact fixture proof. */
export async function requestTestWorkspaceAllocationRelease(
  ctx: Context,
  input: TeamWorkspaceAllocationReleaseRequestInput,
): Promise<TeamWorkspaceAllocationSnapshot> {
  return await withTestWorkspaceAllocationProof(ctx, {
    kind: 'workspace-allocation-release-request', ...structuredClone(input),
  }, async actor => await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
}

/** Preserve one provider allocation through a short-lived exact fixture proof. */
export async function preserveTestWorkspaceAllocation(
  ctx: Context,
  input: TeamWorkspaceAllocationPreserveInput,
): Promise<TeamWorkspaceAllocationSnapshot> {
  return await withTestWorkspaceAllocationProof(ctx, {
    kind: 'workspace-allocation-preserve', ...structuredClone(input),
  }, async actor => await ctx.teams.preserveWorkspaceAllocation({ actor, ...input }))
}

/** Confirm one provider allocation release through a short-lived exact fixture proof. */
export async function confirmTestWorkspaceAllocationRelease(
  ctx: Context,
  input: TeamWorkspaceAllocationReleaseInput,
): Promise<TeamWorkspaceAllocationSnapshot> {
  return await withTestWorkspaceAllocationProof(ctx, {
    kind: 'workspace-allocation-release', ...structuredClone(input),
  }, async actor => await ctx.teams.confirmWorkspaceAllocationRelease({ actor, ...input }))
}

/** Retain one exact workspace allocation scope only until its fixture Hub call settles. */
async function withTestWorkspaceAllocationProof<T>(
  ctx: Context,
  scope: TeamSystemWorkspaceAllocationScope,
  operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  const source: TeamSystemWorkspaceAllocationProofSource = {
    name: 'team-workspace-test',
    resolveWorkspaceAllocationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource(source)
  const proof = createTestWorkspaceAllocationProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestWorkspaceAllocationProof(): TeamSystemWorkspaceAllocationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test workspace-allocation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkspaceAllocationProof
}
