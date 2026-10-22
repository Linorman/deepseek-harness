/** Strict public management fixture for wire correlation and rejection paths; it grants no Native authority. */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { simulationProductWorldManagementDraftSchema, simulationProductWorldManagementPreviewSchema,
  simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementSubmitInputSchema } from '../src/world-management-schema.ts'
const parsedDraft = simulationProductWorldManagementDraftSchema.parse({ runId: 'run', action: 'transfer', targetId: 'person',
  expectedRevision: 1, values: { assignmentId: 'assignment', position: 'position', effective: 'boundary', reason: 'Original user reason' } })
if (parsedDraft.action !== 'transfer') throw new Error('Transfer wire fixture lost its exact original action')
export const managementDraft = parsedDraft
export const managementPreview = simulationProductWorldManagementPreviewSchema.parse({ apiVersion: 'clocky.world-management/v1',
  input: managementDraft, runId: 'run', revision: 1, snapshotRevision: 3, previewHash: `sha256:${'a'.repeat(64)}`,
  sourceFingerprint: `sha256:${'b'.repeat(64)}`, admission: 'allowed', blockers: [], settlementRequirements: [],
  impact: { kind: 'transfer', personId: 'person', organizationEntityId: 'organization', assignmentId: 'assignment', assignmentRevision: 1,
    previousPositionId: 'previous-position', targetPositionId: 'position', requestedEffectiveAt: null, authorityRelationIds: [] },
  hiringFee: null, impacts: [], obligations: [], coverage: { scope: 'person/obligations', loaded: 0, total: 0, complete: true, revision: 3, at: '2' } })
export const managementFields = simulationProductWorldManagementFieldsSchema.parse({ apiVersion: 'clocky.world-management/v1',
  runId: 'run', action: 'transfer', targetId: 'person', snapshotRevision: 3, targetRevision: 1, status: 'available', fields: [
    { id: 'assignmentId', kind: 'choice', required: true, options: [{ id: 'assignment', label: 'Original assignment' }] },
    { id: 'position', kind: 'choice', required: true, options: [{ id: 'position', label: 'Target position' }] },
    { id: 'effective', kind: 'choice', required: true, options: [{ id: 'boundary', label: 'Boundary' }] },
    { id: 'at', kind: 'time', required: false },
    { id: 'reason', kind: 'text', required: true, maxBytes: 512 },
  ] })
export const managementSubmit = simulationProductWorldManagementSubmitInputSchema.parse({ runId: 'run', commandId: 'original-user',
  draft: managementDraft, previewRevision: 3, previewHash: managementPreview.previewHash })

/** Native lengths count UTF-16 code units rather than Unicode code points or UTF-8 bytes. */
export const managementCommandBoundaries = [
  { label: 'ascii256', commandId: 'a'.repeat(256), allowed: true },
  { label: 'ascii257', commandId: 'a'.repeat(257), allowed: false },
  { label: 'astral128', commandId: '😀'.repeat(128), allowed: true },
  { label: 'astral129', commandId: '😀'.repeat(129), allowed: false },
  { label: 'mixed256', commandId: 'a'.repeat(254) + '😀', allowed: true },
  { label: 'mixed257', commandId: 'a'.repeat(255) + '😀', allowed: false },
  { label: 'empty', commandId: '', allowed: false },
  { label: 'lone-high1', commandId: '\ud800', allowed: true },
  { label: 'lone-high256', commandId: '\ud800'.repeat(256), allowed: true },
  { label: 'lone-high257', commandId: '\ud800'.repeat(257), allowed: false },
  { label: 'lone-low1', commandId: '\udfff', allowed: true },
  { label: 'lone-low256', commandId: '\udfff'.repeat(256), allowed: true },
  { label: 'lone-low257', commandId: '\udfff'.repeat(257), allowed: false },
  { label: 'lone-mixed256', commandId: 'a' + '\ud800'.repeat(255), allowed: true },
  { label: 'lone-mixed257', commandId: 'a' + '\ud800'.repeat(256), allowed: false },
] as const

/** Shared TS/Python corpus preserves Unicode and the original description, rather than normalizing its contents. */
export const managementReasonBoundaries = z.array(z.strictObject({ label: z.string(), text: z.string(),
  repeat: z.number().int().positive().optional(), suffix: z.string().optional(), allowed: z.boolean(),
})).parse(JSON.parse(readFileSync('python/sdk/tests/fixtures/world-management-reasons.json', 'utf8')))
  .map(value => ({ label: value.label, reason: value.text.repeat(value.repeat ?? 1) + (value.suffix ?? ''), allowed: value.allowed }))
