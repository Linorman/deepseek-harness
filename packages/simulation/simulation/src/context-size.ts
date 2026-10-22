/** Native context byte pricing shared by runtime and creation preflight. @module @clocky/clocky-simulation/context-size */
import type { SimulationContextSection } from '@clocky/clocky-session/types'

/**
 * Price the complete serialized content-block array using the Native context byte-budget rule.
 * @param sections - Selected sections; wrappers and Unicode encoding are included in the result.
 * @returns exact UTF-8 bytes retained by the context owner, independent of token estimation.
 */
export function simulationContextBytes(sections: readonly Pick<SimulationContextSection, 'blocks'>[]): number {
  return new TextEncoder().encode(JSON.stringify(sections.flatMap(section => section.blocks))).byteLength
}
