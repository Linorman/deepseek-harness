import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Schema from '@clocky/schemastery'
import { SettingsSchemaService } from '@clocky/clocky-client-ui-settings/src/client/schema.ts'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { modelDrafts, validateModels } from '../src/client/model-utils.ts'
import { createSettingsSchemaOperations } from '../src/client/schema-operations.ts'

describe('models editor pure helpers', () => {
  it('normalizes arbitrary serialized model rows without dropping object fields', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, [], 'not a row', { id: 'kept', extra: true }])).toEqual([
      {}, {}, {}, { id: 'kept', extra: true },
    ])
  })

  it('reports each model validation failure at the first offending row', () => {
    expect(validateModels(undefined)).toBeUndefined()
    expect(validateModels([])).toBeUndefined()
    expect(validateModels([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModels([{ id: '  ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModels([{ id: 'same' }, { id: 'same' }])).toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateModels([{ id: 'named', name: 42 }])).toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModels([{ id: 'named', name: '' }])).toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModels([{ id: 'sized', contextWindow: 'large' }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'sized', contextWindow: 1.5 }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'sized', contextWindow: 0 }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'capped', maxTokens: 'many' }])).toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModels([{ id: 'capped', maxTokens: 1.5 }])).toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModels([{ id: 'capped', maxTokens: 0 }])).toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModels([{ id: 'valid', name: 'Valid', contextWindow: 1, maxTokens: 1 }])).toBeUndefined()
  })

  it('treats matching quote wrappers as pasted key syntax', () => {
    expect(apiKeyFailure('"sk-live"')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure("'sk-live'")).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('`sk-live`')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('"unfinished')).toBeUndefined()
  })
})

describe('settings schema operation facade', () => {
  it('forwards every operation to the settings-owned service', () => {
    const service = new SettingsSchemaService(new Context())
    const operations = createSettingsSchemaOperations(service)
    const serialized = Schema.object({
      provider: Schema.object({ id: Schema.string() }),
    }).toJSON()
    const root = operations.rehydrate(serialized)

    expect(operations.validate(root, { provider: { id: 'test' } })).toBeUndefined()
    expect(operations.validate(root, { provider: { id: 1 } })).toEqual(expect.any(String))
    expect(operations.nodeAtPath(root, ['provider', 'id'])).toBeDefined()
    expect(operations.getPath({ provider: { id: 'test' } }, ['provider', 'id'])).toBe('test')
    expect(operations.hasPath({ provider: { id: undefined } }, ['provider', 'id'])).toBe(true)
    expect(operations.setPath({}, ['provider', 'id'], 'next')).toEqual({ provider: { id: 'next' } })
    expect(operations.deletePath({ provider: { id: 'next' } }, ['provider', 'id'])).toEqual({ provider: {} })
  })
})
