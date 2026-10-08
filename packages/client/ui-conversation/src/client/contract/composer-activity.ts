/**
 * What the running turn is doing right now, for the composer's status row.
 * Inputs are primitives read from the Session snapshot so the selectors stay
 * referentially stable.
 */

/** The current turn activity; `undefined` when the Session is idle. */
export type ComposerActivity =
  | { readonly kind: 'tool'; readonly name: string; readonly step: number }
  | { readonly kind: 'thinking' | 'replying'; readonly step: number }
  | { readonly kind: 'working' }

/**
 * Derive the activity from the running flag, the newest running tool call, and
 * the streaming assistant's last block.
 * @param input.running - whether a turn runs.
 * @param input.tool - newest running tool call name, if any.
 * @param input.toolStep - that call's step.
 * @param input.partialStep - the streaming assistant's step, if any.
 * @param input.partialBlock - kind of the streaming assistant's last block, if any.
 * @returns the activity, or `undefined` when nothing runs.
 */
export function composerActivity(input: {
  running: boolean
  tool?: string | undefined
  toolStep?: number | undefined
  partialStep?: number | undefined
  partialBlock?: string | undefined
}): ComposerActivity | undefined {
  if (!input.running) return undefined
  if (input.tool !== undefined && input.toolStep !== undefined) return { kind: 'tool', name: input.tool, step: input.toolStep }
  if (input.partialStep !== undefined) {
    return { kind: input.partialBlock === 'reasoning' ? 'thinking' : 'replying', step: input.partialStep }
  }
  return { kind: 'working' }
}
