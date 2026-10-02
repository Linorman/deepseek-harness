/** A trusted external-target fault persists the real Envelope before losing its first response. */
import type { Context } from '@clocky/cordis'
import type { ChannelId, EnvelopeId } from '@clocky/clocky-team'
import type { SimulationOperationId, SimulationDecisionId } from '@clocky/clocky-simulation'
import type {} from './simulation-administration/model.ts'

interface Probe {
  readonly calls: Array<{ operationId: SimulationOperationId; envelopeId: EnvelopeId }>
  target?: { operationId: SimulationOperationId
    decisionId: SimulationDecisionId
    channelId: ChannelId
    envelopeId: EnvelopeId } | undefined
  lost: boolean
  failCheckpointRead: boolean
}
declare module '@clocky/cordis' { interface Context { simulationRetryFaultProbe: Probe } }
export const inject = ['teams', 'simulationBrowserProbe', 'sessionPersistence']

/** Instrument only real target publication; no actor, operation result or replay fact is fabricated. */
export function apply(ctx: Context): void {
  const probe: Probe = { calls: [], lost: false, failCheckpointRead: false }
  ctx.provide('simulationRetryFaultProbe', probe)
  const read = ctx.sessionPersistence.readFrom.bind(ctx.sessionPersistence)
  ctx.effect(() => {
    ctx.sessionPersistence.readFrom = async (...args) => {
      const bound = Object.values(ctx.simulationBrowserProbe.run?.snapshot().entities ?? {})
        .some(entity => entity.binding?.sessionId === args[0])
      if (probe.failCheckpointRead && bound) throw new Error('PRIVATE_CHECKPOINT_STORAGE_ROOT/secret-read-error')
      return await read(...args)
    }
    return () => { ctx.sessionPersistence.readFrom = read }
  }, 'operation retry fixture: explicit canonical Session read failure')
  const original = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  ctx.effect(() => {
    ctx.teams.postChannelEnvelope = async (request) => {
      const operation = Object.values(ctx.simulationBrowserProbe.run?.snapshot().operations ?? {}).find(value =>
        value.action.kind === 'communication/post' && value.action.channelId === request.draft.channelId
        && value.outbox?.attempts.at(-1)?.outcome === 'in-flight' && value.result === undefined)
      const envelope = await original(request)
      if (operation !== undefined) {
        probe.calls.push({ operationId: operation.id, envelopeId: envelope.id })
        if (!probe.lost) {
          probe.lost = true
          probe.target = { operationId: operation.id, decisionId: operation.decisionId,
            channelId: envelope.channelId, envelopeId: envelope.id }
          throw new Error('Injected target response loss after real committed publication')
        }
      }
      return envelope
    }
    return () => { ctx.teams.postChannelEnvelope = original }
  }, 'operation retry fixture: exact target response loss')
}
