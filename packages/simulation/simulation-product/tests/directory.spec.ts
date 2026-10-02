/** Immutable registration identity and bounded public parsers protect retained metadata. */
import { expect, it } from 'vitest'
import { foldDirectoryEntry, sameImport, simulationProductImportSchema } from '../src/directory.ts'
import { simulationProductRunInspectionSchema, simulationProductListInputSchema, simulationProductInspectInputSchema } from '../src/schema.ts'
import { DirectoryCursorCodec } from '../src/cursor.ts'
import { registration, call } from './fixtures.ts'

it('rejects repeated product identities and provider/run ownership keys while preserving the prior fold', () => {
  const input = { ...registration(), spec: { ...registration().spec } }
  const row = { kind: 'run/registered', record: { ...input, registeredAt: 123 } }
  const first = foldDirectoryEntry(new Map(), row)
  const record = first.get(input.id)!
  expect(sameImport(record, input)).toBe(true)
  expect(sameImport(record, { ...input, name: 'Changed' })).toBe(false)
  expect(Object.isFrozen(record)).toBe(true)
  input.spec.tickUnit = 'changed'
  expect(record.spec.tickUnit).toBe('minute')
  expect(() => foldDirectoryEntry(first, row)).toThrow(/registration identity/)
  expect(() => foldDirectoryEntry(first, { ...row, record: { ...row.record, id: 'other' } })).toThrow(/ownership key/)
  expect(first.size).toBe(1)
  for (const value of [{ ...row, extra: true }, { ...row, kind: 'run/changed' },
    { ...row, record: { ...row.record, registeredAt: -1 } }, { ...row, record: { ...row.record, secret: 'hidden' } }]) {
    expect(() => foldDirectoryEntry(new Map(), value)).toThrow()
  }
})

it('binds encrypted pages to every authenticated query fact and service lifetime', () => {
  const codec = new DirectoryCursorCodec()
  const reader = call()
  const query = { scope: 'directory', revision: 1, search: 'needle', limit: 1, offset: 2 }
  const value = codec.encode(reader, query)
  expect(codec.decode(value, reader, query)).toBe(2)
  expect(value).not.toContain('reader')
  expect(codec.encode(reader, query)).not.toBe(value)
  for (const changed of [{ ...reader, principal: { ...reader.principal, id: 'other' as never } },
    { ...reader, principal: { ...reader.principal, issuer: 'other' } },
    { ...reader, principal: { ...reader.principal, subject: 'other' } }, { ...reader, credentialGeneration: 2 }]) {
    expect(() => codec.decode(value, changed, query)).toThrow(/expired/)
  }
  for (const changed of [{ ...query, scope: 'other' }, { ...query, revision: 2 }, { ...query, search: '' }, { ...query, limit: 2 }]) {
    expect(() => codec.decode(value, reader, changed)).toThrow(/expired/)
  }
  for (const bad of ['', 'AA', value + '=', value.slice(0, -5) + 'xxxxx']) {
    expect(() => codec.decode(bad as never, reader, query)).toThrow(/expired/)
  }
  expect(() => new DirectoryCursorCodec().decode(value, reader, query)).toThrow(/expired/)
})

it('rejects browser-supplied authority, paths and inconsistent or imprecise observations', () => {
  expect(() => simulationProductImportSchema.parse({ ...registration(), secret: 'credential' })).toThrow()
  for (const bad of [{ limit: 0 }, { limit: 1.2 }, { provider: 'local' }, { principalId: 'reader' }]) {
    expect(() => simulationProductListInputSchema.parse(bad)).toThrow()
  }
  expect(() => simulationProductInspectInputSchema.parse({ runId: '', path: '/private' })).toThrow()
  const run = { id: 'public-run', name: { text: 'Name', truncated: false }, registeredAt: 0, observation: 'not-observed' }
  const world = { revision: 0, phase: 'running', time: '9007199254740993', tickUnit: { text: 'tick', truncated: false },
    owner: 'other-owner', entityCount: 0, decisionCount: 0, operationCount: 0, observedAt: 0 }
  expect(simulationProductRunInspectionSchema.parse({ run, status: 'observed', world }).world?.time).toBe('9007199254740993')
  for (const bad of [{ run, status: 'observed' }, { run, status: 'missing', world },
    { run, status: 'observed', world: { ...world, time: 9007199254740993 } },
    { run, status: 'observed', world: { ...world, time: '01' } },
    { run, status: 'observed', world: { ...world, privateKnowledge: [] } }]) {
    expect(() => simulationProductRunInspectionSchema.parse(bad)).toThrow()
  }
})
