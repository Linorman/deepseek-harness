/** Strict JSON primitives shared by versioned channel protocol parsers. */
import type { JsonObject, JsonValue } from './types.ts'

/** Require precisely the protocol-owned recovery fields.
 * @param value - Parsed JSON object.
 * @param keys - Complete allowed own-key set for the selected protocol state.
 * @param subject - Diagnostic subject supplied by the owning protocol.
 */
export function assertChannelJsonKeys(value: JsonObject, keys: readonly string[], subject: string): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${subject} has unsupported fields`)
}

/** Identify an object before reading adapter-owned JSON fields.
 * @param value - JSON value being inspected.
 * @returns whether the value is a non-null object other than an array.
 */
export function isChannelJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require nonempty protocol text without trimming or changing its opaque identity.
 * @param value - Candidate field from parsed protocol JSON.
 * @param subject - Diagnostic subject supplied by the owning protocol.
 * @returns the original nonempty string.
 */
export function requireChannelJsonText(value: JsonValue | undefined, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a nonempty string`)
  return value
}
