/** Static declarations for log streams opened through `ctx.storage.log`. @module @clocky/clocky-storage-log/src/spec */

import type { LogStreamDescriptor } from '@clocky/clocky-storage'

/**
 * Declare and validate a stream identity at its owning module's load time.
 * @param descriptor - Literal stream name and format version.
 * @returns the unchanged descriptor with its literal type preserved.
 */
export function defineLogStream<S extends LogStreamDescriptor>(descriptor: S): S {
  if (descriptor.name.length === 0) {
    throw new Error('log stream name must be non-empty')
  }
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 0) {
    throw new Error(`log stream '${descriptor.name}' version must be a non-negative safe integer`)
  }
  return descriptor
}
