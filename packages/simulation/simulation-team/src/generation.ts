import { generationInput, assertGenerationEvidence } from './generation-evidence.ts'
import { generationRecordAt } from '@clocky/clocky-simulation'
/** Isolated, tool-free model input and durable output for a Native-owned generation job. */
import { isDeepStrictEqual } from 'node:util'
import { BlockAssembler, deepFreeze } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import type { Session } from '@clocky/clocky-session'
import type { SimulationRun, SimulationGenerationJob, SimulationGenerationRecord, SimulationTokenUsage } from '@clocky/clocky-simulation'

/**
 * Execute at most one accepted request using its dedicated Session and exact input bytes.
 * @param run - Durable job owner and shared run budget.
 * @param jobId - Already accepted job; retries with retained outputs do no inference.
 * @param session - Dedicated canonical Session, never a director or general actor history.
 * @param authorize - Current disclosure authority; loss blocks validation but preserves received output.
 * @param flush - Session persistence barrier.
 * @param stream - Pool-admitted, tool-free request callback supplied by the Team owner.
 * @param signal - Connection/caller cancellation; unknown accepted IO remains charged.
 * @returns original retained result after schema validation; unresolved provider IO throws without regeneration.
 */
export async function executeGeneration(run: SimulationRun, jobId: string, session: Session,
  authorize: (job: SimulationGenerationJob) => void, flush: () => Promise<boolean>,
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>, signal: AbortSignal): Promise<SimulationGenerationRecord> {
  const original = generationRecordAt(run.snapshot(), jobId)
  if (original === undefined || session.id !== original.binding.sessionId
    || session.header.participantId !== original.binding.participantId || session.header.teamId !== original.binding.teamId)
    throw new Error('Generation requires its original canonical Session')
  assertGenerationEvidence(run.snapshot(), original.binding, session.header, session.events)
  authorize(structuredClone(original.job))
  if (original.status !== 'accepted') {
    if (original.status === 'generating' || original.status === 'unknown') {
      const output = session.events.findLast(event => event.type === 'simulation/generation-output' && event.data.jobId === jobId)
      if (output?.type !== 'simulation/generation-output') throw new Error('Generation original attempt requires reconciliation, not regeneration')
      if (!await flush()) throw new Error('Generation reconciliation requires durable original output')
      await run.transitionGeneration({ kind: 'output', id: original.job.id, content: output.data.content,
        ...output.data.usage === undefined ? {} : { usage: output.data.usage } }, () => {})
      return await run.transitionGeneration({ kind: 'validate', id: original.job.id }, authorize)
    }
    if (original.status === 'output-retained') return await run.transitionGeneration({ kind: 'validate', id: original.job.id }, authorize)
    return original
  }
  const job = original.job
  const priorInput = session.events.filter(event => event.type === 'simulation/generation-input')
  if (session.events.some(event => ['user/message', 'assistant/message', 'simulation/context-view', 'team/channel-view', 'request/header', 'request/context', 'compaction/request', 'compaction/summary', 'session/title-llm-request', 'tool/call', 'tool/result'].includes(event.type)))
    throw new Error('Generation refuses a Session with unrelated cognition history')
  if (priorInput.some(event => event.data.scope !== job.scope || !isDeepStrictEqual(event.data.audience, job.audience)))
    throw new Error('Generation Session contains another disclosure scope')
  const { message, input } = generationInput(original)
  if (Buffer.byteLength(JSON.stringify(message), 'utf8') > 1048576) throw new Error('Complete generation input exceeds its Session byte allowance')
  const existing = priorInput.find(event => event.data.jobId === job.id)
  if (existing !== undefined && !isDeepStrictEqual(existing.data, input)) throw new Error('Generation Session input changed its retained bytes')
  if (existing === undefined) session.append('simulation/generation-input', input)
  if (!await flush()) throw new Error('Generation requires durable Session input before provider admission')
  signal.throwIfAborted()
  const recordedInput = session.events.findLast(event => event.type === 'simulation/generation-input' && event.data.jobId === job.id)
  if (recordedInput === undefined) throw new Error('Generation lost its original persisted input')
  await run.transitionGeneration({ kind: 'start', id: job.id, sessionSequence: recordedInput.seq }, authorize)
  let usage: SimulationTokenUsage | undefined, completed = false, streamedBytes = 0
  const assembler = new BlockAssembler()
  const options: GenerateOptions = Object.freeze({ provider: job.model.provider, model: job.model.name,
    messages: deepFreeze([message]), sessionId: session.id, signal, tools: deepFreeze([]), maxTokens: job.budget.maxTokens })
  try {
    for await (const chunk of stream(options)) {
      if (chunk.type === 'usage') usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens,
        ...chunk.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: chunk.usage.cacheReadTokens },
        ...chunk.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: chunk.usage.cacheWriteTokens } }
      signal.throwIfAborted()
      if (chunk.type === 'tool-call-delta' || chunk.type === 'block-start' && chunk.blockType === 'tool-call'
        || chunk.type === 'block-end' && chunk.block.type === 'tool-call') throw new Error('Generation assistant cannot invoke tools')
      streamedBytes += Buffer.byteLength(JSON.stringify(chunk), 'utf8')
      if (streamedBytes > 1048576) throw new Error('Complete generation stream exceeded its byte allowance')
      assembler.push(chunk)
      if (chunk.type === 'finish') completed = chunk.reason.kind === 'stop' || chunk.reason.kind === 'max-tokens'
    }
    if (!completed) throw new Error('Generation provider did not retain a complete finish')
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning'))
      throw new Error('Generation requires a textual response')
    const content = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    session.append('simulation/generation-output', { jobId: job.id, content, ...usage === undefined ? {} : { usage } })
    if (!await flush()) throw new Error('Generation output requires durable Session storage')
    // Settling accepted provider IO is allowed after revocation; only validation/incorporation require fresh authority.
    await run.transitionGeneration({ kind: 'output', id: job.id, content, ...usage === undefined ? {} : { usage } }, () => {})
  } catch (error) {
    const retained = generationRecordAt(run.snapshot(), job.id)
    if (retained?.status === 'generating' || retained?.status === 'unknown') await run.transitionGeneration({ kind: 'unknown', id: job.id,
      reason: 'provider-or-persistence-interrupted', ...usage === undefined ? {} : { observedUsage: usage } }, () => {})
    throw error
  }
  return await run.transitionGeneration({ kind: 'validate', id: job.id }, authorize)
}
