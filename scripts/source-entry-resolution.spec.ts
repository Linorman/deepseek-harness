/** Source-mode tests must not execute emitted JavaScript beside workspace TypeScript entries. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import tsconfigPaths from 'vite-tsconfig-paths'
import { createViteServer } from 'vitest/node'
import { expect, it } from 'vitest'

it('loads workspace TypeScript entries even when stale JavaScript and declarations exist beside them', async () => {
  const repository = join(import.meta.dirname, '..')
  const parent = join(repository, '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'source-entry-resolution-'))
  try {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.base.json', await readFile(join(repository, 'tsconfig.base.json'), 'utf8'))
    expect(parsed.error).toBeUndefined()
    const config = parsed.config as { compilerOptions: { paths: Record<string, string[]> } }
    const tsconfig = join(root, 'tsconfig.json')
    await writeFile(tsconfig, JSON.stringify({ compilerOptions: { paths: config.compilerOptions.paths }, include: ['**/*.ts'] }))
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
    const entries = [
      ['@clocky/clocky-subprocess-local', 'packages/subprocess/subprocess-local/src'],
      ['@clocky/clocky-host-webserver', 'packages/host/webserver/src'],
      ['@clocky/clocky-client-ui-tool/client', 'packages/client/ui-tool/src/client'],
    ] as const
    for (const [specifier, directory] of entries) {
      const source = join(root, directory)
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'index.ts'), `export const value: string = ${JSON.stringify(specifier)}\n`)
      await writeFile(join(source, 'index.js'), 'throw new Error("executed stale workspace artifact")\nexport const value = "stale"\n')
      await writeFile(join(source, 'index.d.ts'), 'export declare const value: number\n')
    }
    const entry = join(root, 'entry.ts')
    await writeFile(entry, entries.map(([specifier], index) => `import { value as v${index} } from ${JSON.stringify(specifier)}`).join('\n')
      + '\nexport const values = [v0, v1, v2]\n')
    const server = await createViteServer({ configFile: false, root, logLevel: 'silent',
      plugins: [tsconfigPaths({ projects: [tsconfig] })], server: { middlewareMode: true, watch: null, ws: false } })
    try {
      const loaded = await server.ssrLoadModule('/entry.ts') as { values: string[] }
      expect(loaded.values).toEqual(entries.map(([specifier]) => specifier))
    } finally { await server.close() }
  } finally { await rm(root, { recursive: true, force: true }) }
})
