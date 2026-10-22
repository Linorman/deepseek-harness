/** Pure scenario checks and configuration assembly; never opens a run or calls a model. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { compileWorldScenarioV1, decodeScenarioInput } from '@clocky/clocky-simulation-scenario'

const here = new URL('./', import.meta.url)
const root = fileURLToPath(new URL('../../../../', here))
const output = resolve(root, '.local/scenarios/community-repair')
const json = await readFile(new URL('scenario.json', here), 'utf8')
const yaml = await readFile(new URL('scenario.yaml', here), 'utf8')
const definition = JSON.parse(json)
const catalog = JSON.parse(await readFile(new URL('deployment.example.json', here), 'utf8'))
const disabled = await compileWorldScenarioV1(json, catalog)
assert.equal(disabled.ok, false, 'The example must not advertise an unconfigured live route as ready')
assert.ok(disabled.diagnostics.some(item => item.code === 'model-unavailable'))
const structuralCatalog = structuredClone(catalog)
for (const profile of structuralCatalog.runtimeProfiles) profile.model.available = true
const results = await Promise.all([
  compileWorldScenarioV1(json, structuralCatalog, 'json'),
  compileWorldScenarioV1(yaml, structuralCatalog, 'yaml'),
])
for (const result of results) assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
assert.deepEqual(results[0].resolved, results[1].resolved)
const unknown = await compileWorldScenarioV1({ ...definition, arbitraryCode: 'forbidden' }, structuralCatalog)
assert.equal(unknown.ok, false)
assert.equal(decodeScenarioInput('apiVersion: clocky.world/v1\napiVersion: clocky.world/v1\n', 'yaml').ok, false)
assert.equal(definition.externalWorld.mode, 'simulated-only')
assert.equal(definition.governance.committees[0].members.length, 2)
assert.equal(definition.governance.committees[0].rule.kind, 'unanimity')
assert.equal(definition.governance.norms[0].enforcement.kind, 'validated')
assert.equal(definition.governance.norms[0].enforcement.params.maxHires, 1)
assert.equal(definition.resources[0].quantity, '10')
assert.equal(definition.organization.hiringFees[0].quantity, '3')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'world-options.json'), JSON.stringify({ provider: 'local', catalog,
  checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
  authoringTemplates: [{ id: 'community-repair', version: '1', name: definition.metadata.name, definition }],
}, null, 2) + '\n')
const report = { scenario: definition.metadata.name, structuralValidation: 'passed', jsonYamlEquivalent: true,
  definitionHash: results[0].resolved.definitionHash, deploymentReady: false,
  deploymentDiagnostics: disabled.diagnostics, modelCalls: 0, executionVerified: false,
  negativeChecks: ['unknown fields refused', 'duplicate YAML keys refused'],
  output: resolve(output, 'world-options.json') }
await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
