/** Browser-file encoding for ordered channel drafts; the Host owns durable attachment admission. */
import type { TeamChannelInput } from '@clocky/clocky-client-runtime/client'

/** One editable draft row; its key never enters durable content. */
export type ChannelDraftPart = { readonly id: string; readonly content: TeamChannelInput['content'][number] }

/** Encode one supported file with native cancellation and no object URL ownership.
 * @param file - User-selected local image.
 * @param signal - Draft lifetime or explicit import cancellation.
 * @returns Encoded image prompt content, without a durable attachment id.
 */
export async function encodeChannelImage(file: File, signal: AbortSignal): Promise<Extract<TeamChannelInput['content'][number], { type: 'image' }>> {
  signal.throwIfAborted()
  const mediaType = file.type
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
    throw new TypeError(`Unsupported image media type: ${mediaType}`)
  }
  const reader = new FileReader()
  const abort = () => { reader.abort() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const value = await new Promise<string>((resolve, reject) => {
      reader.onload = () => { typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image file did not encode as text')) }
      reader.onerror = () => { reject(reader.error ?? new Error('Image file could not be read')) }
      reader.onabort = () => { reject(signal.reason ?? new DOMException('Image import cancelled', 'AbortError')) }
      reader.readAsDataURL(file)
    })
    signal.throwIfAborted()
    return { type: 'image', mediaType, data: value.slice(value.indexOf(',') + 1), ...file.name === '' ? {} : { name: file.name } }
  } finally {
    signal.removeEventListener('abort', abort)
    reader.onload = null; reader.onerror = null; reader.onabort = null
  }
}
