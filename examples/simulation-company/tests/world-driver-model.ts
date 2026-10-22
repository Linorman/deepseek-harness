/** Keyless model proposals are derived only from the real recorded World view and tool responses. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

export const name = 'world-driver-scripted-model'
export const inject = ['llm']
export const requests: Array<{ purpose: string; entityId: string; tool: string }> = []
export const modelInputs: string[] = []

declare module '@clocky/cordis' {
  interface Context {
    /** Test-only read observation of the actually loaded adapter, independent of module-loader cache identity. */
    worldDriverProbe: { readonly requests: readonly { readonly purpose: string; readonly entityId: string; readonly tool: string }[]
      readonly modelInputs: readonly string[]
      /** Occupy a real downstream stream until the fixture explicitly ends it. */
      holdNextRequest(): { readonly entered: Promise<void>; readonly finish: () => void }
      /** Pause one otherwise successful stream before its finish chunk, preserving its real tool and usage. */
      holdNextCompletion(): { readonly entered: Promise<void>; readonly finish: () => void } }
  }
}

function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Non-JSON model prose has no structured World input. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const record = value as Record<string, unknown>
  return [record, ...Object.values(record).flatMap(objects)]
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

/** Register scripted external cognition; it cannot inspect Native, Team or driver objects. */
export function apply(ctx: Context): void {
  let hold: { readonly entered: () => void; readonly finished: Promise<void> } | undefined
  let completionHold: { readonly entered: () => void; readonly finished: Promise<void> } | undefined
  ctx.provide('worldDriverProbe', { requests, modelInputs, holdNextRequest() {
    assert.equal(hold, undefined)
    const entered = Promise.withResolvers<undefined>(), finished = Promise.withResolvers<undefined>()
    hold = { entered: () => { entered.resolve(undefined) }, finished: finished.promise }
    return { entered: entered.promise, finish: () => { finished.resolve(undefined) } }
  }, holdNextCompletion() {
    assert.equal(completionHold, undefined)
    const entered = Promise.withResolvers<undefined>(), finished = Promise.withResolvers<undefined>()
    completionHold = { entered: () => { entered.resolve(undefined) }, finished: finished.promise }
    return { entered: entered.promise, finish: () => { finished.resolve(undefined) } }
  } })
  const calls = new Map<string, number>()
  class ScriptedModel extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      // The replaced current view is a user projection; historical observe tool replies retain old views.
      const values = objects(options.messages.filter(message => message.role === 'user'
        && !message.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker)
      assert.equal(typeof marker.contextKey, 'string')
      assert.ok(typeof marker.entityId === 'string')
      assert.ok(typeof marker.purpose === 'string')
      const occupied = hold
      if (occupied !== undefined) {
        hold = undefined
        occupied.entered()
        await occupied.finished
        throw new Error('Fixture ends the occupied real provider stream without proposing a business effect')
      }
      const key = `${marker.entityId}/${marker.contextKey}`
      const index = calls.get(key) ?? 0
      calls.set(key, index + 1)
      const repair = process.env.WORLD_DRIVER_SCHEMA_REPAIR === 'true' && marker.purpose === 'resolve'
      const tool = (repair
        ? ['simulation_observe', 'simulation_stage', 'simulation_submit', 'simulation_stage', 'simulation_submit']
        : ['simulation_observe', 'simulation_stage', 'simulation_submit'])[index]
      assert.ok(tool, JSON.stringify({ marker, index, roles: options.messages.map(message => ({ role: message.role,
        blocks: message.content.map(block => block.type) })) }))
      requests.push({ purpose: marker.purpose, entityId: marker.entityId, tool })
      modelInputs.push(JSON.stringify(options.messages))
      let action: object | undefined
      if (marker.purpose === 'message' && (process.env.WORLD_MESSAGE_BYTES === 'director' || process.env.WORLD_OUTBOX_RETRY === 'director')) {
        const input = values.findLast(value => value.kind === 'envelope-byte-probe')
        if (input !== undefined) action = { kind: 'communication/post', recipient: input.recipient,
          channelId: input.channelId, deliverAt: input.deliverAt, text: process.env.WORLD_OUTBOX_RETRY === 'director' ? 'Original bounded retry message' : '长'.repeat(3000) }
      }
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        const authority = record(input.authority)
        if (marker.purpose === 'request' && input.receipt !== undefined) {
          assert.equal(authority.kind, 'request')
          action = record(record(input.receipt).proposal)
        } else if (process.env.WORLD_DOMAIN_BOOKING === 'true' && marker.purpose === 'goal') {
          const installed = record((input.operations as unknown[])[0]), target = record((installed.targets as unknown[])[0])
          const terms = marker.bookingRequest === undefined ? { businessKey: 'booking-1', from: '10', until: '20' }
            : record(marker.bookingRequest)
          action = { kind: 'world/request', domain: 'meeting-room', operation: 'book', version: '1', businessKey: terms.businessKey,
            expectedTime: null, evidence: [], payload: { organizationEntityId: target.scopeEntityId,
              roomEntityId: target.targetEntityId, from: terms.from, until: terms.until, description: 'Reserve the meeting room.' } }
        } else if (process.env.WORLD_DOMAIN_BOOKING === 'true' && marker.purpose === 'resolve') {
          const proposed = record(input.booking), requested = record(input.request)
          action = { kind: 'world/resolve', requestId: requested.id, supersedes: null, resolution: { kind: 'apply',
            payload: { roomEntityId: proposed.roomEntityId, from: proposed.from, until: proposed.until }, rationale: 'Private appointment validation.' } }
        } else if (marker.purpose === 'request' || marker.purpose === 'goal') {
          const application = marker.purpose === 'request' ? record(input.application) : {
            applicationId: `goal-${marker.entityId}`, organizationEntityId: input.organizationEntityId,
            positionEntityId: record((input.positions as unknown[])[0]).entityId,
          }
          action = { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
            businessKey: application.applicationId, expectedTime: null, evidence: [], payload: {
              organizationEntityId: application.organizationEntityId, positionEntityId: application.positionEntityId,
              description: application.description ?? 'One additional colleague is needed for the authorized position.',
              ...application.priorRequestId === undefined ? {} : { priorRequestId: application.priorRequestId },
            } }
        }
        else if (marker.purpose === 'resolve') {
          const schema = record(values.findLast(value => value.kind === 'world-resolution-schema')?.planSchema), properties = record(schema.properties)
          assert.equal(record(properties.templateVersion).type, 'string')
          assert.ok((schema.required as string[]).includes('persona'))
          assert.equal(schema.additionalProperties, false)
          if (repair && index === 3) assert.ok(JSON.stringify(options.messages)
            .includes('templateVersion: Invalid input: expected string, received undefined'))
          assert.ok(Array.isArray(input.templates))
          const template = simulationWorldTemplateSchema.parse(input.templates[0])
          const selected = template.names.at(-1)
          assert.ok(selected)
          const request = record(input.request)
          const incomplete = process.env.WORLD_DRIVER_RESUBMIT === 'true' && record(input.application).priorRequestId === undefined
            || process.env.WORLD_DRIVER_REJECT_DESCRIPTION !== undefined
              && request.description === process.env.WORLD_DRIVER_REJECT_DESCRIPTION
          action = { kind: 'world/resolve', requestId: request.id,
            supersedes: request.priorPlan === null ? null : record(request.priorPlan).id,
            resolution: incomplete ? { kind: 'reject', reason: 'insufficient-information', rationale: 'Original request needs clarification.' }
              : { kind: 'apply', payload: { templateId: template.id, templateVersion: template.version, persona: { name: selected, skills: template.skills, traits: template.traits, goals: template.goals } }, rationale: 'Director-private rationale must never reach the newcomer.' } }
        } else if (marker.purpose === 'result') action = record(authority.notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), newcomer = record(input.newcomer), persona = record(newcomer.persona)
          const result = record(input.result)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId,
            text: process.env.WORLD_MESSAGE_BYTES === 'newcomer' ? '长'.repeat(3000)
              : `I am ${String(persona.name)}. I am ready to work with you.`, deliverAt: result.time }
        } else throw new Error('Unknown recorded World purpose')
        if (marker.purpose === 'request' && process.env.WORLD_SUBMISSION_LIMIT === 'request-bytes') {
          action = { ...action, description: '需'.repeat(1024) }
        }
        if (marker.purpose === 'resolve' && process.env.WORLD_SUBMISSION_LIMIT === 'plan-bytes') {
          const resolved = record(action), resolution = record(resolved.resolution)
          action = { ...resolved, resolution: { ...resolution, rationale: '必'.repeat(1024) } }
        }
        if (marker.purpose === 'resolve' && process.env.WORLD_SUBMISSION_LIMIT === 'authority') {
          action = { ...action, requestId: 'another-unconsumed-case' }
        }
      }
      if (repair && index === 1) {
        const resolved = record(action), resolution = record(resolved.resolution)
        const { templateVersion: _version, ...payload } = record(resolution.payload)
        action = { ...resolved, resolution: { ...resolution, payload } }
      }
      const args = JSON.stringify(index === 1 || repair && index === 3
        ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}-${index}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      const completing = completionHold
      if (completing !== undefined) {
        completionHold = undefined
        completing.entered()
        await completing.finished
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-driver-scripted'], new ScriptedModel()))
}
