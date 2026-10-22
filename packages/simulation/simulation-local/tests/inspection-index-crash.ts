/** Separate-process publication boundary probe; no world writer is opened. */
import { buildInspectionIndex, publishInspectionIndex } from '../src/inspection-index.ts'
const directory = process.argv[2]
if (directory === undefined) throw new Error('Missing existing index directory')
const index = buildInspectionIndex([{ sequence: 0, value: { kind: 'run/created' } }], 999)
await publishInspectionIndex(directory, index, () => {
  if (process.argv[3] === 'before-rename') process.exit(71)
})
process.exit(72)
