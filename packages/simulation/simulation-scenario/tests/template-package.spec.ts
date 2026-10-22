/** Portable packages remain inert and refuse dependency substitutions before creation. */
import { expect, it } from 'vitest'
import { parseWorldTemplatePackage, verifyTemplateDependencies } from '../src/template-package.ts'
import { serializeScenarioDefinition } from '../src/input.ts'
import { sample, deployment } from './v1-fixtures.ts'

const packageValue = () => ({ apiVersion: 'clocky.world-template/v1', definition: structuredClone(sample),
  manifest: { id: 'company', version: '1', license: { identifier: 'LicenseRef-Private', notice: 'Internal use only' },
    attribution: ['Original author'], dependencies: { domains: deployment.domains.map(entry => entry.pin),
      runtimeProfiles: sample.runtimeProfiles.allowed, templates: sample.runtimeProfiles.templates,
      policyVersion: deployment.policyVersion, normPolicies: [] } } })

it('preserves explicit distribution metadata and verifies every exact installed implementation', () => {
  const input = packageValue()
  const result = parseWorldTemplatePackage(JSON.stringify(input))
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value).toEqual(input)
  expect(parseWorldTemplatePackage(serializeScenarioDefinition(input, 'yaml'), 'yaml')).toMatchObject({ ok: true, value: input })
  expect(verifyTemplateDependencies(result.value.definition, result.value.manifest, deployment)).toEqual([])
  const changed = structuredClone(deployment)
  changed.domains[0]!.pin.generation++
  expect(verifyTemplateDependencies(result.value.definition, result.value.manifest, changed)).toMatchObject([{ code: 'domain-unavailable' }])
  changed.policyVersion = 'another-policy'
  expect(verifyTemplateDependencies(result.value.definition, result.value.manifest, changed)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'policy-unavailable' })]))
})
it('rejects missing dependencies, executable metadata and unsafe YAML without unwrapping a partial definition', () => {
  const missing = packageValue(); missing.manifest.dependencies.templates = []
  expect(parseWorldTemplatePackage(missing).ok).toBe(false)
  expect(parseWorldTemplatePackage({ ...packageValue(), install: 'run arbitrary code' }).ok).toBe(false)
  expect(parseWorldTemplatePackage('!!js/function >\n  function() { return 1; }', 'yaml').ok).toBe(false)
  const duplicate = packageValue(); duplicate.manifest.dependencies.domains.push(duplicate.manifest.dependencies.domains[0]!)
  expect(parseWorldTemplatePackage(duplicate).ok).toBe(false)
})
