/** UTF-8 display prefixes shared by bounded Team readers. */
import type { TeamSelectionText } from './types.ts'
const utf8 = new TextEncoder()

/** Retain complete Unicode code points within the display allowance.
 * @param value - Complete display text.
 * @param maxBytes - Maximum prefix bytes.
 * @returns text and an explicit truncation marker.
 */
export function teamTextSummary(value: string, maxBytes: number): TeamSelectionText {
  let text = ''
  let bytes = 0
  for (const character of value) {
    const size = utf8.encode(character).byteLength
    if (bytes + size > maxBytes) return { text, truncated: true }
    text += character
    bytes += size
  }
  return { text, truncated: false }
}
