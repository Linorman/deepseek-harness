/** Shared authorized candidates for materialization and Loader recovery. */
import { simulationContextRequestSchema } from '@clocky/clocky-simulation'

export function contextRequest(maxBytes = 65536) {
  return simulationContextRequestSchema.parse({ maxBytes, teamCursor: 4, personaVersion: 'persona-1', modelVersion: 'model-1', sources: [],
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true, blocks: [{ type: 'text', text: kind }] })),
  })
}
