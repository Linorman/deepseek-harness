import { SimulationContextIntegrityError } from './integrity.ts'
/** Exact decision wake identities and durable Session reconciliation. @module @clocky/clocky-simulation-team/input */
import { isDeepStrictEqual } from 'node:util'
import { freezeMessage, MessageId } from '@clocky/clocky-llm'
import type { UserMessage } from '@clocky/clocky-llm'
import type { Agent } from '@clocky/clocky-agent'
import type { SimulationContextViewEventData } from '@clocky/clocky-session'

/**
 * Build a control input without repeating the separately projected context content.
 * @param view - Frozen run-owned context.
 * @returns the same identified wake message on every retry.
 */
export function decisionInput(view: SimulationContextViewEventData): UserMessage {
  return freezeMessage({ id: MessageId(view.inputId), role: 'user',
    content: [{ type: 'text', text: `A new simulation decision is open: ${view.inputId}. `
      + 'Call simulation_observe to read this decision’s current context before choosing actions. '
      + 'Earlier tool results and submissions belong to earlier decisions; they do not complete this one. '
      + 'Finish this decision with simulation_submit. If no action is needed, stage an empty proposal list and submit it. '
      + 'A written summary alone does not submit a decision.' }],
    source: { kind: 'plugin', plugin: 'simulation-team' } })
}
/**
 * Reconcile one exact input with the live log and pending inbox.
 * @param agent - Canonical live actor.
 * @param input - Run-derived immutable control input.
 * @returns whether it has entered a step, remains queued, or needs admission.
 */
export function inputState(agent: Agent, input: UserMessage): 'consumed' | 'queued' | 'absent' {
  let consumed = false
  for (const event of agent.session.events) {
    const entered = event.type === 'user/message' && event.surfaceOp === 'append'
    const messages = entered ? [event.data]
      : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
    for (const message of messages) {
      if (message.id !== input.id) continue
      if (!isDeepStrictEqual(message, input)) throw new SimulationContextIntegrityError('Simulation input identity was reused with another payload')
      if (entered) {
        if (consumed) throw new SimulationContextIntegrityError('Simulation input was consumed more than once')
        consumed = true
      }
    }
  }
  const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter(message => message.id === input.id)
  if (pending.some(message => !isDeepStrictEqual(message, input)) || pending.length > 1 || consumed && pending.length > 0) {
    throw new SimulationContextIntegrityError('Simulation pending input conflicts with its consumption history')
  }
  return consumed ? 'consumed' : pending.length === 1 ? 'queued' : 'absent'
}
