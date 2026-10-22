/** Shared keyless cognition reads only actual recorded model inputs, for all three author definitions. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { hireApprovalBody, simulationHireApprovalTargetSchema, simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

export const name = 'complete-world-scripted'
export const inject = ['llm']
export const requests: Array<{ actor: string; purpose: string; contextKey: string; tool: string; args: unknown; messages: GenerateOptions['messages'] }> = []
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary prose cannot supply authoritative identities or plans. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = record(value)
  return [item, ...Object.values(item).flatMap(objects)]
}
function operation(input: Record<string, unknown>, name: string) {
  const found = (input['operations'] as unknown[]).map(record).find(value => record(value['pin'])['operation'] === name)
  assert.ok(found, `Recorded context does not authorize ${name}`)
  return found
}
function request(input: Record<string, unknown>, name: string, businessKey: string, payload: unknown) {
  const pin = record(operation(input, name)['pin'])
  return { kind: 'world/request', domain: pin['domain'], operation: pin['operation'], version: pin['version'],
    businessKey, expectedTime: null, evidence: [], payload }
}

/** The fixture receives routes only from current Native material or an actually received original Channel introduction. */
function handoffGoal(input: Record<string, unknown>, tag: string, marker: Record<string, unknown>,
  current: GenerateOptions['messages'], business: Record<string, unknown> | undefined, time: unknown, details?: unknown): object[] {
  if (tag === 'create-handoff') {
    const material = record(operation(input, 'depart')['material']), person = record((material['opportunities'] as unknown[])[0])
    const introduction = current.findLast(value => value.source?.kind === 'team-envelope' && objects(value.content)
      .some(item => item['kind'] === 'handoff-worker-introduction' && item['entityId'] === person['personId']))
    assert.ok(introduction?.source?.kind === 'team-envelope')
    const channelId = introduction.source.channelId, id = 'handoff-original'
    return [{ kind: 'interaction/request', id, assignee: person['personId'],
      description: 'Original responsibility: receive and maintain this handoff document until it is explicitly withdrawn.',
      replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } },
    { kind: 'communication/post', recipient: person['personId'], channelId, deliverAt: time,
      text: JSON.stringify({ kind: 'handoff-request', interactionId: id, handoff: 'original', assigneeEntityId: person['personId'] }) }]
  }
  assert.equal(tag, 'perform-handoff'); assert.ok(business)
  const original = (business['interactions'] as unknown[]).map(record).find(value => value['id'] === 'handoff-original')
  assert.ok(original && original['requester'] === marker['entityId'] && original['reply'] === 'accepted')
  const actual = (business['commitments'] as unknown[]).map(record).find(value => value['interactionId'] === original['id'])
  assert.ok(actual && actual['phase'] === 'open' && actual['debtor'] === original['assignee'])
  const successor = record(details)['successorId']
  assert.equal(typeof successor, 'string')
  assert.notEqual(successor, original['assignee']); assert.notEqual(successor, marker['entityId'])
  const route = (business['routes'] as unknown[]).map(record).find(value => (value['members'] as unknown[]).includes(successor))
  assert.ok(route)
  const id = 'handoff-replacement'
  return [{ kind: 'interaction/cancel', id: original['id'], expectedRevision: original['revision'],
    reason: 'The original requester explicitly withdraws the original work; no assignee or commitment is rewritten.' },
  { kind: 'interaction/request', id, assignee: successor,
    description: 'Replacement responsibility: independently accept and acknowledge receipt of the handoff document.',
    replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } },
  { kind: 'communication/post', recipient: successor, channelId: route['channelId'], deliverAt: time,
    text: JSON.stringify({ kind: 'handoff-request', interactionId: id, handoff: 'replacement', assigneeEntityId: successor }) }]
}
function goal(input: Record<string, unknown>, text: string, key: string): object | undefined {
  text = text.split(':')[0]!.trim()
  if (text === 'inspect-association') return undefined
  if (text === 'propose-policy') {
    const target = record((operation(input, 'propose-norm')['targets'] as unknown[])[0])
    const material = record(operation(input, 'propose-norm')['material'])
    const policy = record((material['committees'] as unknown[]).find(value => record(value)['committeeId'] === target['targetEntityId']))
    return request(input, 'propose-norm', 'policy-proposal', { committeeId: target['targetEntityId'], scopeId: target['scopeEntityId'],
      body: 'Each new appointment requires the original independent committee approval for the declared position.',
      target: { kind: 'norm', norm: { id: 'hiring-policy', version: '1' } }, policyRef: 'clocky.governance/1',
      rule: policy['rule'], quorum: policy['quorum'], deadline: '100' })
  }
  if (text === 'vote-policy' || text === 'vote-hire-approval') {
    const kind = text === 'vote-policy' ? 'norm' : 'hire-approval'
    const proposal = (input['governance'] as unknown[]).map(record).find(value => record(value['target'])['kind'] === kind)
    assert.ok(proposal)
    return request(input, 'vote', key, { proposalId: proposal['proposalId'], proposalRevision: proposal['proposalRevision'],
      bodyHash: proposal['bodyHash'], choice: 'yes' })
  }
  if (text === 'enact-policy') {
    const material = record(operation(input, 'enact-norm')['material']), actual = record((material['opportunities'] as unknown[])[0])
    return request(input, 'enact-norm', 'policy-enactment', { norm: actual['norm'], prior: actual['prior'], proposal: actual['proposal'],
      resolution: actual['resolution'], scope: actual['scope'], body: actual['body'], effectiveFrom: actual['currentTime'],
      effectiveUntil: null, availableAt: actual['currentTime'], audience: { kind: 'public' }, impact: 'future-admissions',
      enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1', params: {
        committeeId: actual['committeeId'], positionIds: actual['positionIds'], maxHires: 1 } } })
  }
  if (text === 'request-hire' || text === 'request-hire-existing') {
    const name = text === 'request-hire' ? 'generate-and-hire' : 'hire-existing', installed = operation(input, name)
    const material = record(installed['material'])
    if (name === 'hire-existing') {
      const opportunity = record((material['opportunities'] as unknown[])[0])
      return request(input, name, 'original-appointment', { organizationEntityId: opportunity['organizationEntityId'],
        positionEntityId: opportunity['positionEntityId'], personId: opportunity['personId'], description: 'Appoint the original eligible volunteer.' })
    }
    const target = record((installed['targets'] as unknown[])[0])
    return request(input, name, 'original-appointment', { organizationEntityId: target['scopeEntityId'],
      positionEntityId: target['targetEntityId'], description: 'Appoint one colleague with the original declared fee and independent approval.' })
  }
  if (text === 'propose-hire-approval') {
    const material = record(operation(input, 'propose-hire-approval')['material']), actual = record((material['opportunities'] as unknown[])[0])
    const target = simulationHireApprovalTargetSchema.parse(actual['target'])
    const policy = record((material['committees'] as unknown[]).find(value => record(value)['committeeId'] === actual['committeeId']))
    return request(input, 'propose-hire-approval', 'original-hire-approval', { committeeId: actual['committeeId'], scopeId: actual['scopeId'],
      body: hireApprovalBody(target), target: { kind: 'hire-approval', approval: target }, policyRef: 'clocky.governance/1',
      rule: policy['rule'], quorum: policy['quorum'], deadline: '100' })
  }
  if (text === 'contact-supplier' || text === 'association-stock') {
    const target = record((operation(input, 'interact')['targets'] as unknown[])[0]), failure = text === 'association-stock'
    return request(input, 'interact', key, { scope: target['scopeEntityId'], subjectRef: target['targetEntityId'],
      externalKey: 'original-supplier', sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
      input: { kind: 'adjudicate', question: failure ? 'Report the unavailable undeclared library stock.' : 'Prepare the original independent representative.',
        ...failure ? {} : { contactUnit: 'widget' } }, responseScope: { allowed: [failure ? 'failure' : 'representative-preparation-plan'],
        disclosure: { kind: 'requester' } } })
  }
  if (text === 'transfer-colleague' || text === 'depart-colleague') {
    const name = text === 'transfer-colleague' ? 'transfer' : 'depart'
    const material = record(operation(input, name)['material']), actual = record((material['opportunities'] as unknown[])[0])
    return request(input, name, 'original-'+name, { organizationEntityId: actual['organizationEntityId'], personId: actual['personId'],
      assignmentId: actual['assignmentId'], assignmentRevision: actual['assignmentRevision'], requestedEffectiveAt: null,
      ...name === 'transfer' ? { targetPositionId: actual['targetPositionId'] } : { retire: false },
      description: 'Preserve the original person and settle its actual responsibilities before changing the assignment.' })
  }
  throw new Error(`Unknown recorded goal ${text}`)
}

/** Install only external cognition: no Native, Team, storage or scenario objects reach this adapter. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const current = options.messages.filter(value => value.role === 'user' && !value.content.some(block => block.type === 'tool-result'))
      const values = objects(current), marker = values.findLast(value => value['kind'] === 'world-driver')
      assert.ok(marker && typeof marker['entityId'] === 'string' && typeof marker['contextKey'] === 'string' && typeof marker['purpose'] === 'string')
      const key = `${marker['entityId']}/${marker['contextKey']}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      const input = values.findLast(value => value['kind'] === 'world-context')
      const view = current.findLast(value => value.source?.kind === 'simulation-context-view')
      const business = objects(view?.content).find(value => value['kind'] === 'simulation-business-context')
      const observed = objects(options.messages).findLast(value => value['status'] === 'observed')
      let action: object | undefined
      let bundle: object[] | undefined
      if (marker['purpose'] === 'goal') {
        assert.ok(input)
        const wake = values.findLast(value => value['kind'] === 'world-goal')
        assert.ok(wake && typeof wake['goal'] === 'string')
        const tag = wake['goal'].split(':')[0]!.trim()
        if (tag === 'create-handoff' || tag === 'perform-handoff') {
          const details: unknown = tag === 'perform-handoff' ? JSON.parse(wake['goal'].slice(wake['goal'].indexOf(':') + 1)) : undefined
          bundle = handoffGoal(input, tag, marker, current, business, observed?.['time'], details)
        }
        else action = goal(input, wake['goal'], marker['contextKey'])
      } else if (marker['purpose'] === 'resolve') {
        assert.ok(input)
        let payload: unknown = { kind: 'acknowledge' }
        if (input['enactment'] !== undefined) payload = input['enactment']
        else if (input['personnel'] !== undefined) payload = input['personnel']
        else if (input['existingHire'] !== undefined) payload = input['existingHire']
        else if (input['application'] !== undefined) {
          const template = simulationWorldTemplateSchema.parse((input['templates'] as unknown[])[0])
          payload = { templateId: template.id, templateVersion: template.version,
            persona: { name: template.names.at(-1), skills: template.skills, traits: template.traits, goals: template.goals } }
        } else if (input['externalMediated'] !== undefined) {
          const actual = record(input['externalMediated']), allowed = record(actual['responseScope'])['allowed'] as unknown[]
          const common = { subjectRef: actual['subjectRef'], sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
            attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
          if (allowed.includes('failure')) payload = { kind: 'adjudicate', outcome: { ...common, kind: 'failure',
            code: 'unavailable', description: 'Undeclared inventory remains unknown; no available stock is invented.' } }
          else {
            const template = simulationWorldTemplateSchema.parse((input['templates'] as unknown[])[0])
            payload = { kind: 'adjudicate', outcome: { ...common, kind: 'representative-preparation-plan',
              preparation: { templateId: template.id, templateVersion: template.version,
                persona: { name: template.names[0], skills: template.skills, traits: template.traits, goals: template.goals } },
              contactUnit: record(actual['input'])['contactUnit'] } }
          }
        }
        const original = record(input['request'])
        action = { kind: 'world/resolve', requestId: original['id'], supersedes: original['priorPlan'] === null ? null : record(original['priorPlan'])['id'],
          resolution: { kind: 'apply', payload, rationale: 'The original private director decision preserves the observed selection.' } }
      } else if (marker['purpose'] === 'result') {
        assert.ok(input)
        action = record(record(input['authority'])['notification'])
      } else if (marker['purpose'] === 'first-action') {
        assert.ok(input)
        const route = record(input['communication']), result = record(input['result']), body = record(result['payload'])
        const external = body['outcome'] === undefined ? undefined : record(record(body['outcome'])['actual'])
        action = { kind: 'communication/post', recipient: route['recipient'], channelId: route['channelId'], deliverAt: result['time'],
          text: external === undefined ? JSON.stringify({ kind: 'handoff-worker-introduction', entityId: marker['entityId'],
            text: 'I acknowledge my original recorded assignment and its responsibilities.' }) : JSON.stringify({
            kind: 'complete-world-contact', representativeEntityId: external['entityId'], requesterEntityId: marker['entityId'], unit: external['contactUnit'] }) }
      } else {
        assert.equal(marker['purpose'], 'message')
        const received = current.findLast(value => value.source?.kind === 'team-envelope')
        if (received !== undefined && received.source?.kind === 'team-envelope') {
          const contact = objects(received.content).find(value => value['kind'] === 'complete-world-contact'
            && value['representativeEntityId'] === marker['entityId'])
          if (step > 0) assert.equal(typeof observed?.['time'], 'string', 'A reply uses its actual recorded observation time')
          const offered = objects(received.content).find(value => value['kind'] === 'handoff-request')
          const accepted = objects(received.content).find(value => value['kind'] === 'handoff-accepted')
          if (offered !== undefined && business !== undefined) {
            const original = (business['interactions'] as unknown[]).map(record).find(value => value['id'] === offered['interactionId'])
            if (original?.['assignee'] === marker['entityId'] && original['reply'] === 'pending' && original['execution'] === 'pending') {
              bundle = [{ kind: 'interaction/accept', id: original['id'], expectedRevision: original['revision'] },
                { kind: 'communication/post', recipient: original['requester'], channelId: received.source.channelId,
                  deliverAt: observed?.['time'], text: JSON.stringify({ kind: 'handoff-accepted', interactionId: original['id'],
                    assigneeEntityId: marker['entityId'], handoff: offered['handoff'],
                    text: 'I have received the original document and independently accept this exact responsibility.' }) }]
            }
          } else if (accepted?.['handoff'] === 'replacement' && business !== undefined) {
            const original = (business['interactions'] as unknown[]).map(record).find(value => value['id'] === accepted['interactionId'])
            assert.ok(original && original['requester'] === marker['entityId'] && original['reply'] === 'accepted')
            action = { kind: 'interaction/confirm', id: original['id'], expectedRevision: original['revision'] }
          } else if (contact !== undefined) action = { kind: 'communication/post', recipient: contact['requesterEntityId'],
            channelId: received.source.channelId, deliverAt: observed?.['time'],
            text: 'The original independent representative received your inquiry and replies through this private Channel.' }
        }
      }
      const actions = bundle ?? (action === undefined ? [] : [action])
      const proposals = actions.map((value, index) => ({ after: index === 0 ? [] : [index - 1], action: value }))
      const args = step === 1 ? { proposals } : {}
      requests.push({ actor: marker['entityId'], purpose: marker['purpose'], contextKey: marker['contextKey'], tool, args, messages: options.messages })
      const id = CallId(`${key}:${step}`), serialized = JSON.stringify(args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: serialized }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: serialized } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['complete-world-scripted'], new Model()))
}
