import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { expect, it } from 'vitest'
import { catalog } from './fixtures.ts'

it('bundles and evaluates its complete dependency graph for browsers without Node imports', async () => {
  const bundles = await build({ config: false, entry: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    platform: 'browser', format: 'esm', write: false, dts: false, report: false, logLevel: 'silent',
    outDir: fileURLToPath(new URL('../../../../.local/world-director-mvp/tmp/browser-compiler/', import.meta.url)),
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
  })
  try {
    const chunks = bundles.flatMap(bundle => bundle.chunks).filter(chunk => chunk.type === 'chunk')
    expect(chunks).toHaveLength(1)
    const chunk = chunks[0]!
    expect(chunk.imports).toEqual([])
    expect(chunk.dynamicImports).toEqual([])
    expect(chunk.code).not.toMatch(/\bnode:(?:fs|crypto|path|worker_threads|child_process)|__vite-browser-external/)
    const url = `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
    const browser = await import(url) as typeof import('../src/index.ts')
    const definition = await readFile(new URL('../../../../examples/simulation-company/scenarios/world-company.json', import.meta.url), 'utf8')
    const result = await browser.compileWorldScenario(definition, catalog())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.preview).toMatchObject({ actorCount: 3, directorEntityId: 'director' })
  } finally {
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  }
})
