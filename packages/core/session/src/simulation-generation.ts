/** Strict required helper events at durable and SDK boundaries; no live Simulation service is consulted. */

/**
 * Validate the complete original tool-free input or retained raw output envelope.
 * @param value - Untrusted durable or wire event.
 * @returns whether identity, source, request bytes and optional usage have their exact supported shape.
 */
export function isSimulationGenerationEvent(value: unknown): boolean {
  if (!exact(value, ['type', 'seq', 'time', 'data']) || !counter(value['seq']) || !counter(value['time'])) return false
  const data = value['data']
  if (value['type'] === 'simulation/generation-input') {
    if (!exact(data, ['jobId', 'scope', 'audience', 'message', 'provider', 'model', 'modelVersion', 'promptVersion', 'policyVersion'])
      || !['jobId', 'scope', 'message', 'provider', 'model', 'modelVersion', 'promptVersion', 'policyVersion'].every(key => text(data[key]))
      || !Array.isArray(data['audience']) || data['audience'].length === 0 || !data['audience'].every(text)
      || new Set(data['audience']).size !== data['audience'].length) return false
    let message: unknown
    try { message = JSON.parse(data['message'] as string) }
    catch { return false } // Malformed serialized request bytes cannot reconstruct a model input.
    return exact(message, ['id', 'role', 'source', 'content']) && message['id'] === `generation:${data['jobId'] as string}`
      && message['role'] === 'user' && exact(message['source'], ['kind', 'plugin'])
      && message['source']['kind'] === 'plugin' && message['source']['plugin'] === 'simulation-team'
      && Array.isArray(message['content']) && message['content'].length === 1
      && exact(message['content'][0], ['type', 'text']) && message['content'][0]['type'] === 'text'
      && typeof message['content'][0]['text'] === 'string'
  }
  if (value['type'] !== 'simulation/generation-output' || !record(data)
    || !exact(data, Object.hasOwn(data, 'usage') ? ['jobId', 'content', 'usage'] : ['jobId', 'content'])
    || !text(data['jobId']) || typeof data['content'] !== 'string') return false
  if (!Object.hasOwn(data, 'usage')) return true
  const usage = data['usage']
  return record(usage) && Object.hasOwn(usage, 'inputTokens') && Object.hasOwn(usage, 'outputTokens')
    && Object.keys(usage).every(key => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].includes(key))
    && Object.values(usage).every(counter)
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function counter(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
