/** Exact-version Harbor business summaries over authorized recorded evidence only.
 * @module @clocky/clocky-simulation-world/harbor-summary
 */
import { z } from 'zod'
import type { SimulationWorldBusinessSummary, SimulationWorldBusinessSummaryEvidence } from '@clocky/clocky-simulation'
import { HARBOR_ACTORS, harborRequestSchema, harborResultSchema } from './harbor-protocol.ts'
import type { HarborContract } from './harbor-protocol.ts'

const overviewSchema = z.object({ actors: z.array(z.object({ id: z.string(), kind: z.string() })),
  organizations: z.array(z.object({ founder: z.string(), members: z.record(z.string(), z.string()) })),
  openOrders: z.number().int().nonnegative(), openLoans: z.number().int().nonnegative() })
const known = (value: number) => ({ status: 'known' as const, value })
const unknown = (reason: 'missing-evidence' | 'stale-evidence' | 'unconfirmed-effects' | 'invalid-evidence') =>
  ({ status: 'unknown' as const, reason })
const notApplicable = { status: 'not-applicable' as const }

/**
 * Separate Native acceptance, judge disposition and achieved business effects.
 * @param contract - Exact installed request/result parser generation.
 * @param evidence - Authorized original case and independently disclosed environment context.
 * @returns bounded facts; judge acceptance alone never proves delivery or completion.
 */
export function harborBusinessSummary(contract: HarborContract,
  evidence: SimulationWorldBusinessSummaryEvidence): SimulationWorldBusinessSummary {
  const privateCommand = evidence.requestBody.status === 'allowed'
    ? harborRequestSchema.parse(contract.definition.schemas.request.parse(evidence.requestBody.proposal.payload)).command : undefined
  const result = evidence.result
  const receipt = result?.outcome.kind === 'committed'
    ? harborResultSchema.parse(contract.definition.schemas.result.parse(result.payload)) : undefined
  const command = receipt?.command ?? privateCommand?.kind
  const publicProfile = evidence.environment.status === 'allowed' ? evidence.environment.profile.harbor : undefined
  const environment = z.object({ revision: z.number().int().nonnegative(), day: z.number().int().min(0).max(365),
    publishedAtNativeSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    overview: overviewSchema }).safeParse(publicProfile)
  const publication = environment.success ? environment.data.publishedAtNativeSequence : undefined
  const validPublication = publication !== undefined && publication <= evidence.nativeRevision
  const latestResult = evidence.targetEffects.latestResultSequence ?? -1
  const fresh = validPublication && publication >= latestResult && !evidence.targetEffects.unconfirmed
  const overview = environment.success && fresh ? environment.data.overview : undefined
  const unavailable = evidence.environment.status === 'withheld' ? { status: 'withheld' as const }
    : evidence.targetEffects.unconfirmed ? unknown('unconfirmed-effects')
      : publication !== undefined && publication > evidence.nativeRevision ? unknown('invalid-evidence')
        : validPublication && publication < latestResult ? unknown('stale-evidence') : unknown('missing-evidence')
  let businessOutcome: SimulationWorldBusinessSummary['businessOutcome'] = command === undefined || command === 'act'
    ? 'unknown' : 'not-applicable'
  const audit = receipt?.receipt.audit
  const auditFresh = result !== undefined && result.sequence >= latestResult && !evidence.targetEffects.unconfirmed
  const auditCount = (value: number) => auditFresh ? known(value)
    : unknown(evidence.targetEffects.unconfirmed ? 'unconfirmed-effects' : 'stale-evidence')
  if (command === 'audit' || command === 'finish') {
    businessOutcome = audit?.kind === 'report' ? audit.mechanicallyComplete ? 'achieved' : 'not-achieved' : 'unknown'
  } else if (command === 'act' && (receipt?.ok === false || result?.outcome.kind === 'rejected')) {
    businessOutcome = 'not-achieved'
  }
  return { version: 1, label: command === undefined ? 'Harbor execution' : `Harbor ${command}`, submission: 'accepted',
    execution: receipt !== undefined ? receipt.ok ? 'accepted' : 'rejected'
      : result !== undefined ? 'not-applicable' : evidence.executionUnknown ? 'unknown' : 'pending',
    businessOutcome, nativeRevision: evidence.nativeRevision,
    counts: { businessEntities: overview === undefined ? unavailable : known(overview.actors.length),
      firms: overview === undefined ? unavailable : known(overview.actors.filter(actor => actor.kind === 'firm').length),
      organizations: overview === undefined ? unavailable : known(overview.organizations.length),
      memberships: overview === undefined ? unavailable : known(overview.organizations.reduce((sum, organization) =>
        sum + Object.keys(organization.members).length, 0)),
      founderRepresentedEntities: overview === undefined ? unavailable : known(overview.actors.filter(actor =>
        !(HARBOR_ACTORS as readonly string[]).includes(actor.id)).length),
      // The installed Harbor action protocol has organizations and membership,
      // but no separate alliance or employment relation model.
      alliances: notApplicable, employmentRelationships: notApplicable, employedPeople: notApplicable,
      technicalRoles: known(evidence.technicalCounts.roles), independentSessions: known(evidence.technicalCounts.independentSessions),
      openOrders: overview === undefined ? audit?.kind === 'report' ? auditCount(audit.openOrders.length) : unavailable
        : known(overview.openOrders),
      openLoans: overview === undefined ? audit?.kind === 'report' ? auditCount(audit.openLoans.length) : unavailable
        : known(overview.openLoans) },
    sources: [{ kind: 'request', sequence: evidence.request.sequence },
      ...result === undefined ? [] : [{ kind: 'result' as const, sequence: result.sequence }],
      ...!environment.success || !validPublication || evidence.environment.status !== 'allowed' ? [] : [{
        kind: 'environment' as const, sequence: publication, domainRevision: environment.data.revision,
        domainTime: String(environment.data.day), profileRevision: evidence.environment.profileRevision }],
      { kind: 'bindings', sequence: evidence.nativeRevision }],
  }
}
