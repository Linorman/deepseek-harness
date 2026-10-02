/** Creation journal folds retain original command ownership and immutable terminal outcomes. */
import { expect, it } from 'vitest'
import { simulationCompanyTemplateSchema } from '../src/creation-schema.ts'
import { simulationCreationEntrySchema, foldCreationEntry } from '../src/creation-book.ts'
import { simulationProductPrepareInputSchema } from '../src/administration-schema.ts'
import { registration } from './fixtures.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { accepted } from './creation-fixture.ts'

it('retains the original allocation and rejects command, run and owner substitution', () => {
  const start = accepted()
  const empty = { commands: new Map(), creations: new Map() }
  const state = foldCreationEntry(empty, start)
  expect(state.commands.size).toBe(1)
  expect(state.creations.size).toBe(1)
  expect(empty.commands.size).toBe(0)
  expect(() => foldCreationEntry(state, start)).toThrow('repeats')
  if (start.kind !== 'command/accepted' || start.command.kind !== 'create') throw new Error('fixture requires creation')
  const clone = structuredClone(start)
  if (clone.kind !== 'command/accepted' || clone.command.kind !== 'create') throw new Error('fixture requires creation')
  const next = simulationCreationEntrySchema.parse({ ...clone, command: { ...clone.command,
    input: { ...clone.command.input, commandId: 'another' },
    creation: { ...clone.command.creation, request: { ...clone.command.input, commandId: 'another' },
      preparation: { ...clone.command.creation.preparation, checkpoint: { ...clone.command.creation.preparation.checkpoint,
        id: 'product-initial/another' } } }, receipt: { ...clone.command.receipt, commandId: 'another' } } })
  expect(() => foldCreationEntry(state, next)).toThrow('run ownership')
  const other = accepted()
  const different = { ...other.command, input: { ...other.command.input, commandId: 'distinct' },
    creation: { ...other.command.creation, request: { ...other.command.input, commandId: 'distinct' },
      record: { ...other.command.creation.record, id: 'distinct', spec: { ...other.command.creation.record.spec, runId: 'distinct' } },
      preparation: { ...other.command.creation.preparation, ownerName: 'simulation-product/distinct',
        checkpoint: { ...other.command.creation.preparation.checkpoint, id: 'product-initial/distinct' } } },
    receipt: { ...other.command.receipt, commandId: 'distinct', runId: 'distinct' } }
  expect(foldCreationEntry(state, { kind: 'command/accepted', command: different }).creations.size).toBe(2)
  const input = simulationProductPrepareInputSchema.parse({ runId: start.command.receipt.runId, commandId: 'prepare' })
  const prepare = { kind: 'command/accepted', command: { kind: 'prepare', input, ownerPrincipalId: start.command.ownerPrincipalId,
    receipt: { ...start.command.receipt, kind: 'prepare', commandId: input.commandId } } }
  const prepared = foldCreationEntry(state, prepare)
  expect(prepared.commands.size).toBe(2)
  expect(() => foldCreationEntry(empty, prepare)).toThrow('no owned original')
  expect(() => foldCreationEntry(state, { ...prepare, command: { ...prepare.command, ownerPrincipalId: 'other' } }))
    .toThrow('no owned original')
})

it('rejects terminal rewrites and pending/terminal receipt mismatches', () => {
  const initial = accepted()
  const state = foldCreationEntry({ commands: new Map(), creations: new Map() }, initial)
  const failed = foldCreationEntry(state, { kind: 'command/failed', commandId: 'create', failure: 'preparation-required' })
  expect(failed.commands.get('create')?.receipt).toMatchObject({ status: 'failed', failure: 'preparation-required' })
  expect(() => foldCreationEntry(failed, { kind: 'command/completed', commandId: 'create' })).toThrow('no pending')
  const complete = foldCreationEntry(state, { kind: 'command/completed', commandId: 'create' })
  expect(complete.commands.get('create')?.receipt.status).toBe('completed')
  if (initial.kind !== 'command/accepted') throw new Error('fixture requires accepted')
  expect(() => foldCreationEntry({ commands: new Map(), creations: new Map() }, { ...initial,
    command: { ...initial.command, receipt: { ...initial.command.receipt, status: 'completed' } } })).toThrow('accepted state')
})

it('accepts only strict template configuration with a complete installed driver and supported native policy', () => {
  const { runId: _runId, ...spec } = registration().spec
  const template = { id: 'company', version: '1', name: 'Company', provider: 'local', spec,
    preset: 'simulation', objective: 'One unit', driver: companyConfig, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }
  expect(simulationCompanyTemplateSchema.parse(template).id).toBe('company')
  for (const invalid of [{ ...template, spec: { ...spec, runId: 'foreign' } }, { ...template, spec: { ...spec, maxEntities: 1 } },
    { ...template, spec: { ...spec, maxTime: 'invalid' } }, { ...template, driver: undefined }, { ...template, path: '/arbitrary' }]) {
    expect(simulationCompanyTemplateSchema.safeParse(invalid).success).toBe(false)
  }
})
