/** Fixed Company context reused by runtime rendering and allocation-free preflight. */
import type { SimulationContextRequest } from '@clocky/clocky-simulation'

/**
 * Render the known required identity/authority subset without allocating a runtime actor.
 * @param entityId - Exact declared Native actor identity from the resolved topology.
 * @param taskScenario - Whether this role uses the installed report-workflow driver.
 * @returns exact mandatory runtime blocks; decision inputs, goals, commitments and provider envelope remain additional.
 */
export function requiredCompanyContext(entityId: string, taskScenario = false): SimulationContextRequest['sections'] {
  return [{ kind: 'identity', required: true, blocks: [{ type: 'text', text: `You are ${entityId}.` }] },
    { kind: 'authority', required: true, blocks: [{ type: 'text', text: taskScenario
      ? 'Use only Simulation observe, stage and submit.'
      : 'Use only Simulation observe, stage and submit. Effects follow their dependencies.' }] }]
}
