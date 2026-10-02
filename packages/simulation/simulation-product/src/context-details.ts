/** Project only the recorded decision view; neither current knowledge nor complete model requests are reconstructed. */
import type { SimulationContextPreparation } from '@clocky/clocky-simulation'
import type { SimulationProductContextItem, SimulationProductFrozenContext } from './collections-types.ts'
import type { SimulationProductText } from './types.ts'

/**
 * Disclose the retained context under an independent body policy without consulting current knowledge.
 * @param context - Frozen, replay-validated native preparation.
 * @param text - Deployment-owned metadata label projection.
 * @param allowed - Current independent body-read permission.
 * @param maxPartBytes - At least four UTF-8 bytes per text part, before whole-response accounting.
 * @returns ordered section parts followed by recorded knowledge and source references, without current-world lookups.
 */
export function contextRows(context: SimulationContextPreparation | undefined, text: (value: string) => SimulationProductText,
  allowed: boolean, maxPartBytes: number): SimulationProductContextItem[] {
  if (context?.status !== 'prepared') return []
  const sections: SimulationProductContextItem[] = context.view.content.flatMap<SimulationProductContextItem>((section, index) =>
    section.blocks.flatMap<SimulationProductContextItem>((block, position) => {
      const base = { kind: 'section' as const, index, block: position, section: text(section.kind), required: context.requiredSections.includes(section.kind) }
      if (!allowed) return [{ ...base, body: { status: 'withheld' as const } }]
      // Extensible ContentBlock kinds may contain arbitrary provider payloads. Only recorded plain text has a product renderer.
      if (block.type !== 'text') return [{ ...base, body: { status: 'unsupported' as const } }]
      const parts = splitText(block.text, maxPartBytes)
      return parts.map((value, part) => ({ ...base, body: { status: 'text' as const, text: value, part, parts: parts.length } }))
    }))
  return [...sections, ...(context.knowledge ?? []).map(value => ({ kind: 'knowledge' as const, id: value.id, revision: value.revision })),
    ...context.view.sources.map((value, sourceIndex) => value.kind === 'run-event' ? { kind: value.kind, sequence: value.sequence }
      : { kind: value.kind, sourceIndex, teamId: value.teamId, channelId: value.channelId, envelopeId: value.envelopeId })]
}

/**
 * Preserve original context provenance separately from current read observations.
 * @param context - Prepared frozen view only.
 * @param text - Bounded display values for implementation versions.
 * @returns safe original projection/clock/version metadata, distinct from current observations.
 */
export function frozenContext(context: Extract<SimulationContextPreparation, { status: 'prepared' }>,
  text: (value: string) => SimulationProductText): SimulationProductFrozenContext {
  const view = context.view
  return { time: view.time, slot: view.slot, entityId: view.entityId, epoch: view.epoch, projections: view.projections,
    versions: { rules: text(view.versions.rules), policy: text(view.versions.policy),
      persona: text(view.versions.persona), model: text(view.versions.model) } }
}

/**
 * Split authorized original text without truncation or scalar fragmentation.
 * @param value - Exact retained text, including an intentionally empty string.
 * @param maxBytes - At least four UTF-8 bytes per part, validated by the owning product configuration.
 * @returns ordered parts that concatenate to the original text.
 */
export function splitText(value: string, maxBytes: number): string[] {
  return [...textParts(value, maxBytes)]
}

/**
 * Iterate Unicode-safe text fragments without retaining a per-character or per-part array.
 * @param value - Authorized original text.
 * @param maxBytes - Positive deployment bound of at least four UTF-8 bytes.
 * @returns ordered fragments, including one fragment for empty text.
 */
export function* textParts(value: string, maxBytes: number): Generator<string> {
  let part = '', bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (bytes + size > maxBytes) { yield part; part = ''; bytes = 0 }
    part += character; bytes += size
  }
  yield part
}
