/** Model-facing proposal vocabulary; domain admission revalidates value constraints. @module @clocky/clocky-tool-simulation/schema */
import type { ParameterSchemaSpec, ValueSchemaSpec } from '@clocky/clocky-tools'
const string = { type: 'string', required: true } as const
const integer = { type: 'integer', required: true } as const
const strings = { type: 'array', items: { type: 'string' }, required: true } as const
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } as const
function object<const P extends ParameterSchemaSpec>(properties: P) { return { type: 'object', additionalProperties: false, properties } as const }
function tag<const T extends string>(value: T) { return { type: 'string', const: value, required: true } as const }
const transaction = object({ commitmentId: nullableString,
  reads: { type: 'array', required: true, items: object({ resourceId: string, revision: integer }) },
  transfers: { type: 'array', required: true, items: object({ from: string, to: string, quantity: string }) } })
const task = object({ subject: string, description: string, blockedBy: strings, requiredCapabilities: strings, priority: integer,
  readScopes: strings, writeScopes: strings, workspaceMode: { ...string, enum: ['shared', 'worktree', 'sandbox', 'remote'] },
  reviewPolicy: { required: true, oneOf: [object({ kind: tag('none') }), object({ kind: tag('participant'), reviewerId: string })] },
  budget: { type: 'object', additionalProperties: true, required: true }, maxAttempts: integer })
const evidence = { oneOf: [
  object({ kind: tag('entity'), id: string, revision: integer }),
  object({ kind: tag('resource'), id: string, revision: integer }),
  object({ kind: tag('world-definition'), id: string, revision: integer }),
  object({ kind: tag('world-input'), id: string, revision: integer, hash: string }),
  object({ kind: tag('external'), id: string, revision: integer }),
  object({ kind: tag('relation'), id: string, revision: integer, effectiveFrom: string, effectiveUntil: nullableString }),
  object({ kind: tag('relation-set'), relation: string, object: string, scope: string, hash: string }),
  object({ kind: tag('authority'), id: string, generation: integer }),
  object({ kind: tag('norm'), id: string, version: string }),
  object({ kind: tag('proposal'), id: string, hash: string }),
  object({ kind: tag('resolution'), id: string, hash: string }),
] } as const satisfies ValueSchemaSpec
const action = { oneOf: [
  object({ kind: tag('world/request'), domain: string, operation: string, version: string, businessKey: string,
    expectedTime: nullableString, evidence: { type: 'array', required: true, items: evidence },
    payload: { type: 'object', required: true, additionalProperties: true } }),
  object({ kind: tag('world/resolve'), requestId: string, supersedes: nullableString, resolution: { required: true, oneOf: [
    object({ kind: tag('awaiting-evidence'), missingFields: strings, deadline: string, maxAttempts: integer, rationale: string }),
    object({ kind: tag('apply'), payload: { type: 'object', required: true, additionalProperties: true }, rationale: string }),
    object({ kind: tag('reject'), reason: { ...string, enum: ['insufficient-information', 'unauthorized', 'capacity-full', 'unsupported', 'policy'] }, rationale: string }),
  ] } }),
  object({ kind: tag('world/evidence'), requestId: string, challengeId: string, expectedInputRevision: integer,
    answers: { type: 'array', required: true, items: object({ field: string, text: string,
      references: { type: 'array', required: true, items: { oneOf: [
        object({ kind: tag('run-event'), runId: string, sequence: integer }),
        object({ kind: tag('team-envelope'), teamId: string, channelId: string, envelopeId: string }),
      ] } } }) } }),
  object({ kind: tag('task/create'), task: { ...task, required: true }, deliverAt: string }),
  object({ kind: tag('communication/post'), recipient: { ...string,
    description: 'Simulation Entity ID from the recorded reply target; never a Team Participant ID.' }, channelId: string, text: string, deliverAt: string }),
  object({ kind: tag('interaction/request'), id: string, assignee: string, description: string,
    replyBy: nullableString, completeBy: nullableString, fulfillment: { required: true, oneOf: [
      object({ kind: tag('explicit') }), object({ kind: tag('task-completed') }), object({ kind: tag('transfer'), from: string, to: string, quantity: string }),
    ] } }),
  object({ kind: tag('interaction/accept'), id: string, expectedRevision: integer }),
  object({ kind: tag('interaction/reject'), id: string, expectedRevision: integer, reason: string }),
  object({ kind: tag('interaction/defer'), id: string, expectedRevision: integer, until: string, reason: string }),
  object({ kind: tag('interaction/cancel'), id: string, expectedRevision: integer, reason: string }),
  object({ kind: tag('interaction/confirm'), id: string, expectedRevision: integer }),
  object({ kind: tag('interaction/result'), id: string, expectedRevision: integer, evidence: strings }),
  object({ kind: tag('resource/reserve'), id: string, transaction: { ...transaction, required: true }, grants: strings, expiresAt: string }),
  object({ kind: tag('resource/commit-reservation'), id: string, expectedRevision: integer }),
  object({ kind: tag('resource/cancel-reservation'), id: string, expectedRevision: integer }),
  object({ kind: tag('resource/transfer'), transaction: { ...transaction, required: true }, grants: strings }),
  object({ kind: tag('resource/grant'), id: string, grantee: string, resources: strings, transaction: { ...transaction, required: true } }),
  object({ kind: tag('resource/revoke-grant'), id: string, expectedRevision: integer }),
] } as const satisfies ValueSchemaSpec

/** Complete replacement proposals; dependency indices refer only to earlier entries. */
export const stageParameters = { proposals: { type: 'array', required: true,
  description: 'The complete replacement proposal list. Times and quantities are non-negative decimal strings. Dependencies name earlier indices or accepted operation ids.',
  items: object({ after: { type: 'array', required: true, items: { oneOf: [{ type: 'integer' }, { type: 'string' }] } },
    action: { ...action, required: true } }),
} } as const satisfies ParameterSchemaSpec
