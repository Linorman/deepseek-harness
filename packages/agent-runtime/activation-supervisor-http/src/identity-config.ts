/** Exact shared supervisor deployment identity validation; transport limits remain with each adapter. */
import z from '@clocky/schemastery'

/** Shared identity fields used by the client and endpoint Config validators. */
export const supervisorIdentityConfig = {
  name: z.string().min(1).required(),
  version: z.number().step(1).min(1).required(),
  hostId: z.string().min(1).required(),
  endpointId: z.string().min(1).required(),
}
