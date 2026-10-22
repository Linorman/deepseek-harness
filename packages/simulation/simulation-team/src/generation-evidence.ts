/** Exact cross-owner evidence for isolated generation attempts. */
import { isDeepStrictEqual } from 'node:util'
import type { UserMessage } from '@clocky/clocky-llm'
import { MessageId } from '@clocky/clocky-llm'
import { generationOutputContract } from '@clocky/clocky-simulation'
import type { SessionEvent, SessionHeader } from '@clocky/clocky-session'
import type { SimulationEntityBinding, SimulationGenerationRecord, SimulationSnapshot } from '@clocky/clocky-simulation'

/** Reconstruct the sole authorized input from its durable Native job.
 * @param record - Original accepted request and frozen planner reads.
 * @returns exact user message and persisted input payload.
 */
export function generationInput(record: SimulationGenerationRecord): {
  message: UserMessage
  input: SessionEvent<'simulation/generation-input'>['data']
} {
  const job = record.job
  const message = { id: MessageId(`generation:${job.id}`), role: 'user' as const, source: { kind: 'plugin' as const, plugin: 'simulation-team' },
    content: [{ type: 'text' as const, text: JSON.stringify({ purpose: job.purpose, outputSchema: job.outputSchema,
      outputContract: generationOutputContract(job), inputs: job.inputs, ...job.planner === undefined ? {} : { assignment: job.planner },
      ...record.planningReads === undefined ? {} : { readSet: record.planningReads } }) }] }
  const input = { jobId: job.id, scope: job.scope, audience: job.audience, message: JSON.stringify(message),
    provider: job.model.provider, model: job.model.name, modelVersion: job.model.version,
    promptVersion: job.promptVersion, policyVersion: job.policyVersion }
  return { message, input }
}

/** Whether an original dispatched attempt requires materialized Session history.
 * @param state - Native projection at the owner cut.
 * @param binding - Canonical entity Session binding.
 * @returns whether missing history must refuse the cut.
 */
export function generationRequiresHistory(state: SimulationSnapshot, binding: SimulationEntityBinding): boolean {
  return Object.values(state.generationJobs ?? {}).some(record => record.binding.sessionId === binding.sessionId
    && (record.sessionSequence !== undefined || record.content !== undefined))
}

/** Validate every generation owned by this canonical Session, including interrupted attempts.
 * @param state - Native projection at the owner cut.
 * @param binding - Canonical entity Session binding.
 * @param header - Retained Session identity.
 * @param events - Complete original Session history.
 * @returns normally only when all known input/output relationships match.
 */
export function assertGenerationEvidence(state: SimulationSnapshot, binding: SimulationEntityBinding,
  header: SessionHeader, events: readonly SessionEvent[]): void {
  const records = Object.values(state.generationJobs ?? {}).filter(record => record.binding.sessionId === binding.sessionId)
  if (records.length === 0) return
  if (header.id !== binding.sessionId || header.teamId !== binding.teamId || header.participantId !== binding.participantId)
    throw new Error('Generation evidence has another canonical Session binding')
  for (const record of records) {
    if (!isDeepStrictEqual(record.binding, binding)) throw new Error('Generation evidence changed its Native binding')
    const inputs = events.filter(event => event.type === 'simulation/generation-input' && event.data.jobId === record.job.id)
    const outputs = events.filter(event => event.type === 'simulation/generation-output' && event.data.jobId === record.job.id)
    const input = inputs[0], output = outputs[0]
    if (inputs.length > 1 || outputs.length > 1) throw new Error('Generation evidence duplicates an original attempt')
    if (input !== undefined && (input.type !== 'simulation/generation-input'
      || !isDeepStrictEqual(input.data, generationInput(record).input))) throw new Error('Generation evidence changed its exact input')
    if (record.sessionSequence !== undefined && input?.seq !== record.sessionSequence)
      throw new Error('Generation evidence lost its original input sequence')
    if (output !== undefined && (input === undefined || output.seq <= input.seq || record.sessionSequence === undefined))
      throw new Error('Generation output has no original dispatched input')
    if (record.content !== undefined && (output?.type !== 'simulation/generation-output'
      || output.data.content !== record.content || !isDeepStrictEqual(output.data.usage, record.usage)))
      throw new Error('Generation evidence lost its exact retained output')
  }
  for (const event of events) {
    if ((event.type === 'simulation/generation-input' || event.type === 'simulation/generation-output')
      && !records.some(record => record.job.id === event.data.jobId)) throw new Error('Generation evidence has an unowned attempt')
  }
}
