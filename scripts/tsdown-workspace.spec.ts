/** Real workspace bundles consume TSC output through the repository build config. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { build } from 'tsdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repository = resolve(import.meta.dirname, '..')
let temporary: string
let configPath: string

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function compile(rootNames: string[], rootDir: string, outDir: string, types: string[] = []): void {
  const program = ts.createProgram(rootNames, {
    rootDir,
    outDir,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    rewriteRelativeImportExtensions: true,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
    types,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
  expect(program.emit().emitSkipped).toBe(false)
}

beforeAll(() => {
  mkdirSync(join(repository, '.tmp'), { recursive: true })
  temporary = mkdtempSync(join(repository, '.tmp/tsdown-workspace-'))
  const configuration = join(temporary, 'configuration')
  configPath = join(configuration, 'tsdown.config.ts')
  write(configPath, readFileSync(join(repository, 'tsdown.config.ts'), 'utf8'))
  write(join(configuration, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  symlinkSync(join(repository, 'node_modules'), join(configuration, 'node_modules'), 'junction')

  // Root config imports the TSC-emitted plugin. Compile its real source graph
  // inside this fixture so the test also runs before any repository build.
  const generator = join(repository, 'packages/typert/generator')
  const stagedGenerator = join(configuration, 'packages/typert/generator')
  compile([join(generator, 'src/tsdown-plugin.ts')], join(generator, 'src'), join(stagedGenerator, 'lib/types'), ['node'])
  symlinkSync(join(generator, 'node_modules'), join(stagedGenerator, 'node_modules'), 'junction')
}, 30_000)

afterAll(() => {
  rmSync(temporary, { recursive: true, force: true })
})

function workspace(face: string): string {
  const root = join(temporary, face)
  write(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  write(join(root, 'aggregate.ts'), 'export {}\n')
  write(join(root, 'tsconfig.host.json'), JSON.stringify({ files: ['aggregate.ts'], references: [] }))
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction')
  return root
}

function packageFixture(root: string, directory: string, entries: readonly string[], main = 'index'): void {
  const packageRoot = join(root, directory)
  write(join(packageRoot, 'package.json'), JSON.stringify({
    name: directory === '.' ? '@clocky-test/root' : `@clocky-test/${directory.replaceAll('/', '-')}`,
    private: true,
    type: 'module',
    main: `./lib/${main}.js`,
  }))
  const files = entries.map((entry) => {
    const file = join(packageRoot, 'src', `${entry}.ts`)
    write(file, `export const value: string = ${JSON.stringify(`${directory}:${entry}`)}\n`)
    return file
  })
  compile(files, join(packageRoot, 'src'), join(packageRoot, 'lib/types'))
}

function importedValue(path: string): string {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import { value } from ${JSON.stringify(pathToFileURL(path).href)}; process.stdout.write(value)`,
  ], { cwd: temporary, encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

describe('repository tsdown workspace build', () => {
  it('bundles default Host entries and package overrides without bundling the private root', async () => {
    const root = workspace('host')
    packageFixture(root, '.', ['index'])
    packageFixture(root, 'vendor/index-only', ['index'])
    packageFixture(root, 'packages/example/companion', ['index', 'invariant'])
    packageFixture(root, 'packages/example/startup', ['index', 'startup'])
    packageFixture(root, 'apps/cli', ['index', 'custom'], 'custom')
    const orphan = join(root, 'packages/example/orphan')
    write(join(orphan, 'src/index.ts'), 'export const value: string = \'orphan\'\n')
    compile([join(orphan, 'src/index.ts')], join(orphan, 'src'), join(orphan, 'lib/types'))
    write(join(root, 'apps/cli/tsdown.config.mjs'), "export default { entry: { custom: 'lib/types/custom.js' } }\n")
    expect(existsSync(join(root, 'vendor/index-only/lib/index.js'))).toBe(false)
    const resolvedPackages: string[] = []

    await build({
      cwd: root,
      config: configPath,
      env: { CLOCKY_BUILD_FACE: 'host' },
      logLevel: 'silent',
      hooks: { 'build:prepare': ({ options }) => { resolvedPackages.push(relative(root, options.cwd).replaceAll('\\', '/')) } },
    })

    expect(resolvedPackages.sort()).toEqual([
      'apps/cli', 'packages/example/companion', 'packages/example/startup', 'vendor/index-only',
    ])
    for (const [directory, entries] of [
      ['vendor/index-only', ['index']],
      ['packages/example/companion', ['index', 'invariant']],
      ['packages/example/startup', ['index', 'startup']],
      ['apps/cli', ['custom']],
    ] as const) {
      for (const entry of entries) {
        expect(importedValue(join(root, directory, 'lib', `${entry}.js`))).toBe(`${directory}:${entry}`)
      }
    }
    expect(existsSync(join(root, 'lib/index.js'))).toBe(false)
    expect(existsSync(join(orphan, 'lib/index.js'))).toBe(false)
    expect(existsSync(join(root, 'apps/cli/lib/index.js'))).toBe(false)
    expect(existsSync(join(root, 'vendor/index-only/lib/invariant.js'))).toBe(false)
    expect(existsSync(join(root, 'vendor/index-only/lib/startup.js'))).toBe(false)
  }, 30_000)

  it('leaves Client entries to package configs', async () => {
    const root = workspace('client')
    packageFixture(root, 'vendor/host-only', ['index'])
    packageFixture(root, 'packages/example/client', ['index', 'client'], 'client')
    write(join(root, 'packages/example/client/tsdown.config.mjs'), "export default { entry: { client: 'lib/types/client.js' } }\n")
    const resolvedPackages: string[] = []

    await build({
      cwd: root,
      config: configPath,
      env: { CLOCKY_BUILD_FACE: 'client' },
      logLevel: 'silent',
      hooks: { 'build:prepare': ({ options }) => { resolvedPackages.push(relative(root, options.cwd).replaceAll('\\', '/')) } },
    })

    expect(resolvedPackages).toEqual(['packages/example/client'])
    expect(importedValue(join(root, 'packages/example/client/lib/client.js'))).toBe('packages/example/client:client')
    expect(existsSync(join(root, 'vendor/host-only/lib/index.js'))).toBe(false)
    expect(existsSync(join(root, 'packages/example/client/lib/index.js'))).toBe(false)
  }, 30_000)
})
