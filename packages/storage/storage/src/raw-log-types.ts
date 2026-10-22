/** Storage-only preservation keeps original domain versions and payload bytes without domain interpretation. */
export interface RawLogArchive {
  readonly version: number
  readonly firstSequence: number
  readonly tailSequence: number
  readonly entryCount: number
  readonly representation: 'json-document-bytes' | 'sqlite-logical-frames'
  readonly sourceHash: string
  /** Complete JSON archive text; embedded payloads are base64 of their original stored bytes. */
  readonly text: string
}
