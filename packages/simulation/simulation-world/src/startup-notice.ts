/** Deterministic delivery of authored time-zero institutions; this does not assert model understanding. */
import { simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import type { SimulationDeterministicPolicy } from '@clocky/clocky-simulation'

/** Exact policy identity retained on the original notice decision. */
export const STARTUP_NOTICE_POLICY = simulationPolicyRefSchema.parse({ id: 'clocky.world.startup-notice', version: '1' })

/** The driver selects only Native-authored initial notice wakes; the policy cannot propose world effects. */
export const startupNoticePolicy: SimulationDeterministicPolicy = {
  ...STARTUP_NOTICE_POLICY,
  decide(view) {
    if (view.time !== '0' || !view.content.some(section => section.kind === 'input' && section.blocks.some(block =>
      block.type === 'text' && block.text.includes('simulation-norm-announcement:'))))
      throw new Error('Startup notification policy requires its recorded initial institution notice')
    return []
  },
}
