/** Fixed validator-field factories remain statically enumerable without evaluating plugin code. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigCatalog } from './gen-config-catalog.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(fields: string, configField = 'shared: string'): string {
  const root = mkdtempSync(join(tmpdir(), 'config-field-catalog-'))
  roots.push(root)
  const write = (name: string, source: string) => {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, source)
  }
  write('packages/team/fields/package.json', JSON.stringify({ name: '@clocky/fields' }))
  write('packages/team/fields/src/index.ts', "export { fields } from './fields.ts'\n")
  write('packages/team/fields/src/fields.ts', `import z from '@clocky/schemastery'
throw new Error('The generator must never evaluate this module')
${fields}
`)
  write('packages/team/demo/package.json', JSON.stringify({ name: '@clocky/demo' }))
  write('packages/team/demo/src/index.ts', `import z from '@clocky/schemastery'
import { fields } from '@clocky/fields'
/** Plugin options. */
export interface Config {
  /** Shared configuration. */
  ${configField}
}
export const Config = z.object({ ...fields(7) })
export function apply(_ctx: unknown, _config: Config): void {}
`)
  return root
}

const scalarFields = `interface Fields { shared: z<string> }
export function fields(_default: number): Fields { return { shared: z.string() } }`

describe('static schema field factories', () => {
  it('follows a workspace re-export and enumerates typed fields without executing the factory', () => {
    const entries = collectConfigCatalog(fixture(scalarFields))
    expect(entries.find(entry => entry.pkg === '@clocky/demo')?.schemaKeys).toEqual(['shared'])
  })

  it('walks nested object and array paths in the returned validators', () => {
    const fields = `interface Fields { shared: z<{ child: string }[]> }
export function fields(_default: number): Fields { return { shared: z.array(z.object({ child: z.string() })) } }`
    const config = 'shared: {\n    /** Child name. */\n    child: string\n  }[]'
    const entries = collectConfigCatalog(fixture(fields, config))
    expect(entries.find(entry => entry.pkg === '@clocky/demo')?.schemaKeys).toEqual(['shared', 'shared[].child'])
  })

  it('rejects a fixed nested validator path absent from the config declaration', () => {
    const fields = `interface Fields { shared: z<{ hidden: string }> }
export function fields(_default: number): Fields { return { shared: z.object({ hidden: z.string() }) } }`
    expect(() => collectConfigCatalog(fixture(fields, 'shared: {\n    /** Public name. */\n    child: string\n  }')))
      .toThrow("schema validates key 'shared.hidden'")
  })

  it.each([
    ['unknown return', 'unknown', 'shared: z.string()'],
    ['untyped validator', '{ shared: unknown }', 'shared: z.string()'],
    ['index signature', '{ [key: string]: z<string> }', 'shared: z.string()'],
    ['computed return key', '{ shared: z<string> }', "['shared']: z.string()"],
    ['computed type key', "{ ['shared']: z<string> }", 'shared: z.string()'],
    ['mismatched return key', '{ shared: z<string> }', 'hidden: z.string()'],
    ['optional field', '{ shared?: z<string> }', 'shared: z.string()'],
  ])('rejects %s rather than thinning the schema inventory', (_case, returnType, body) => {
    const fields = `export function fields(_default: number): ${returnType} { return { ${body} } }`
    expect(() => collectConfigCatalog(fixture(fields))).toThrow('not a fixed typed validator-field factory')
  })

  it('rejects a dynamic return even when its annotation declares fixed validators', () => {
    const fields = `interface Fields { shared: z<string> }
export function fields(_default: number): Fields { return Object.fromEntries([]) as unknown as Fields }`
    expect(() => collectConfigCatalog(fixture(fields))).toThrow('not a fixed typed validator-field factory')
  })

  it('rejects recursive validator-field factory composition', () => {
    const fields = `interface Fields { shared: z<{ child: string }> }
export function fields(_default: number): Fields { return { shared: z.object({ ...fields(1) }) } }`
    expect(() => collectConfigCatalog(fixture(fields, 'shared: unknown'))).toThrow('composition is recursive')
  })

  it.each(['sandbox', 'shared'])('keeps the actual local workspace %s provider fields visible', (provider) => {
    const entries = collectConfigCatalog()
    const entry = entries.find(item => item.pkg === `@clocky/clocky-team-workspace-${provider}`)
    expect(entry?.schemaKeys).toEqual(expect.arrayContaining([
      'providerName', 'artifactProvider', 'maxArtifactBytes', 'integrationRoot', 'integrationEnabled', 'maxIntegrationBytes',
      provider === 'sandbox' ? 'allocationParent' : 'root',
    ]))
  })
})
