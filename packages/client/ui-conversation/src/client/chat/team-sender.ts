/**
 * Display projection for Team-delivered user messages. The durable message
 * keeps its model-visible sender prefix; the transcript shows the sender as
 * an identity chip instead of protocol text.
 */

/** The sender of a Team envelope message, when the message is one. */
export interface TeamSender {
  /** Participant id recorded in the message source. */
  readonly senderId: string
}

/**
 * Read the Team sender from a message source.
 * @param source - the user message source as recorded in the session log.
 * @returns the sender, or undefined for any other source.
 */
export function teamSenderOf(source: unknown): TeamSender | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const candidate = source as { readonly kind?: unknown; readonly senderId?: unknown }
  if (candidate.kind !== 'team-envelope' || typeof candidate.senderId !== 'string') return undefined
  return { senderId: candidate.senderId }
}

/**
 * Remove the exact sender prefix Team delivery writes for the model, leaving
 * every other block untouched. A first block that does not start with the
 * exact prefix is returned unchanged, so ordinary text is never rewritten.
 * @param content - message content blocks.
 * @param sender - the recorded sender.
 * @returns content for display.
 */
export function withoutSenderPrefix(content: readonly unknown[], sender: TeamSender): readonly unknown[] {
  const [first, ...rest] = content
  if (typeof first !== 'object' || first === null) return content
  const block = first as { readonly type?: unknown; readonly text?: unknown }
  const prefix = `Direct message from ${sender.senderId}:\n`
  if (block.type !== 'text' || typeof block.text !== 'string' || !block.text.startsWith(prefix)) return content
  const remainder = block.text.slice(prefix.length)
  return remainder === '' ? rest : [{ ...block, text: remainder }, ...rest]
}
