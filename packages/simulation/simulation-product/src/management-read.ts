/** Exact original native management selection treats opaque IDs as own dictionary keys. */
import type { SimulationSnapshot, SimulationManagementOperation, SimulationManagementId } from '@clocky/clocky-simulation'

/**
 * Read one retained management fact without interpreting an inherited JavaScript property as a request.
 * @param state - Authoritative live or read-only native observation.
 * @param id - Exact native management identity selected by the caller.
 * @returns the original operation, or absence when no own record exists.
 */
export function managementAt(state: SimulationSnapshot | undefined, id: SimulationManagementId): SimulationManagementOperation | undefined {
  const records = state?.management
  return records !== undefined && Object.hasOwn(records, id) ? records[id] : undefined
}
