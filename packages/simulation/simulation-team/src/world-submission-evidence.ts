/** Reconstruct a bounded Native rejection from the original staged and submitted Session tool calls. */
import { z } from 'zod'
import type { SessionEvent } from '@clocky/clocky-session'
import { simulationProposalSchema, simulationWorldSubmissionHash } from '@clocky/clocky-simulation'
import type { SimulationDecision } from '@clocky/clocky-simulation'

/**
 * Verify the refused body without copying it into Native history or relaxing its byte allowance.
 * @param decision - Cancelled, consumed world decision with Native-generated refusal metadata.
 * @param events - Complete original canonical Session history.
 * @returns whether this input's turn successfully staged and then submitted the exact rejected proposal hash.
 */
export function worldSubmissionEvidenceMatches(decision: SimulationDecision, events: readonly SessionEvent[]): boolean {
  const blocked = decision.worldSubmissionBlock, consumption = decision.consumption
  if (blocked === undefined || consumption === undefined) return false
  const start = events.slice(0, consumption.consumedSequence + 1).findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  if (start?.type !== 'turn/start') return false
  const calls = events.filter(event => event.type === 'tool/call' && event.data.turn === start.data.turn)
  const submit = calls.findLast(event => event.type === 'tool/call' && event.data.name === 'simulation_submit')
  if (submit?.type !== 'tool/call') return false
  const stage = calls.findLast(event => event.type === 'tool/call' && event.data.name === 'simulation_stage' && event.seq < submit.seq)
  if (stage?.type !== 'tool/call') return false
  const result = events.find(event => event.type === 'tool/result' && event.data.message.content[0].toolCallId === stage.data.callId)
  if (result?.type !== 'tool/result' || result.data.error !== undefined || result.seq > submit.seq) return false
  let input: unknown
  try { input = JSON.parse(stage.data.arguments) }
  catch { return false } // Unparseable original tool arguments cannot attest a rejected submission.
  const parsed = z.strictObject({ proposals: z.array(simulationProposalSchema) }).safeParse(input)
  return parsed.success && simulationWorldSubmissionHash(parsed.data.proposals) === blocked.proposalHash
}
