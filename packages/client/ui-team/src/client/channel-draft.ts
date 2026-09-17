// Pin the byte-only implementation; the package root also imports Node-oriented encoding helpers.
import { RawSha256 } from '@aws-crypto/sha256-js/build/module/RawSha256.js'
/** Browser-file encoding for ordered channel drafts; the Host owns durable attachment admission. */
import type { ParticipantId, TeamChannelInput } from '@clocky/clocky-client-runtime/client'

/** One editable draft row; its key never enters durable content. */
export type ChannelDraftPart = { readonly id: string; readonly content: TeamChannelInput['content'][number] }

/** Unsubmitted user content and retry identity, retained independently for each channel. */
export interface ChannelComposerDraft {
  readonly text: string
  readonly content: readonly ChannelDraftPart[]
  readonly selected: readonly ParticipantId[]
  readonly audienceMode: 'selected' | 'broadcast'
  readonly delivery: 'context' | 'turn' | 'steer'
  readonly retryKey: string
  readonly retryFingerprint: string | undefined
}

/** Fixed-size identity of an ordered channel request; encoded message bodies are not retained twice.
 * @param request - Canonical content, resolved audience and delivery fields sent to the Host.
 * @returns SHA-256 digest of their JSON representation, including content order and media bytes.
 */
export function channelDraftFingerprint(request: Pick<TeamChannelInput, 'content' | 'audience' | 'delivery'>): string {
  const hash = new RawSha256()
  const payload = JSON.stringify({ content: request.content, audience: request.audience, delivery: request.delivery })
  hash.update(new TextEncoder().encode(payload))
  return `sha256:${Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Reject oversized batches before allocating encoded image bodies.
 * @param files - Selected images in composer order.
 * @param draft - Existing content retained if import fails.
 * @param maxBytes - Resolved deployment limit for serialized draft bytes.
 * @param signal - Composer lifetime or replacement import cancellation.
 * @returns Encoded rows; no partial batch is published.
 */
export async function encodeChannelImages(files: readonly File[], draft: ChannelComposerDraft,
  maxBytes: number, signal: AbortSignal): Promise<ChannelDraftPart[]> {
  signal.throwIfAborted()
  const utf8 = new TextEncoder()
  let bytes = utf8.encode(JSON.stringify(draft)).byteLength
  const pending: { file: File; id: string }[] = []
  for (const file of files) {
    const row: ChannelDraftPart = { id: crypto.randomUUID(), content: {
      type: 'image', mediaType: imageMediaType(file), data: '', ...file.name === '' ? {} : { name: file.name },
    } }
    bytes += utf8.encode(JSON.stringify(row)).byteLength
      + 4 * Math.ceil(file.size / 3) + (draft.content.length + pending.length > 0 ? 1 : 0)
    if (bytes > maxBytes) throw new RangeError('Image import exceeds the configured draft byte limit')
    pending.push({ file, id: row.id })
  }
  const encoded: ChannelDraftPart[] = []
  for (const { file, id } of pending) encoded.push({ id, content: await encodeChannelImage(file, signal) })
  return encoded
}

function imageMediaType(file: File): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  const mediaType = file.type
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
    throw new TypeError(`Unsupported image media type: ${mediaType}`)
  }
  return mediaType
}

/** Encode one supported file with native cancellation and no object URL ownership.
 * @param file - User-selected local image.
 * @param signal - Draft lifetime or explicit import cancellation.
 * @returns Encoded image prompt content, without a durable attachment id.
 */
export async function encodeChannelImage(file: File, signal: AbortSignal): Promise<Extract<TeamChannelInput['content'][number], { type: 'image' }>> {
  signal.throwIfAborted()
  const mediaType = imageMediaType(file)
  const reader = new FileReader()
  const abort = () => { reader.abort() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const value = await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('Image file did not encode as text'))
      }
      reader.onerror = () => { reject(reader.error ?? new Error('Image file could not be read')) }
      reader.onabort = () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new DOMException('Image import cancelled', 'AbortError'))
      }
      reader.readAsDataURL(file)
    })
    signal.throwIfAborted()
    return { type: 'image', mediaType, data: value.slice(value.indexOf(',') + 1), ...file.name === '' ? {} : { name: file.name } }
  } finally {
    signal.removeEventListener('abort', abort)
    reader.onload = null; reader.onerror = null; reader.onabort = null
  }
}
