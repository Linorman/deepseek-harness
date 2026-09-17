/** Compiler output ownership and retained source pollution are independently observable. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'
import { sourceOutputViolations } from './verify-source-outputs.ts'

const repository = resolve(import.meta.dirname, '..')
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture(): string {
  mkdirSync(join(repository, '.tmp'), { recursive: true })
  const directory = mkdtempSync(join(repository, '.tmp/source-output-'))
  directories.push(directory)
  return directory
}

it.each([
  ['tsconfig.base.json', 'src/index.js'],
  ['native/landlock-run/tsconfig.base.json', 'src/index.js'],
])('routes an emitting compiler derived from %s into quarantine', (config, output) => {
  const directory = fixture()
  const base = ts.parseConfigFileTextToJson(config, readFileSync(join(repository, config), 'utf8')).config as {
    compilerOptions: Record<string, unknown>
  }
  writeFileSync(join(directory, 'tsconfig.base.json'), JSON.stringify(base))
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ extends: './tsconfig.base.json',
    compilerOptions: { types: [], rootDir: '.' }, files: ['src/index.ts'], include: [] }))
  mkdirSync(join(directory, 'src'))
  writeFileSync(join(directory, 'src/index.ts'), 'export const value: number = 42\n')
  const result = spawnSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')],
    { cwd: directory, encoding: 'utf8' })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(existsSync(join(directory, 'src/index.js'))).toBe(false)
  expect(existsSync(join(directory, 'src/index.d.ts'))).toBe(false)
  expect(readFileSync(join(directory, '.tmp/tsc-unscoped', output), 'utf8')).toContain('value = 42')
  delete base.compilerOptions.outDir
  writeFileSync(join(directory, 'tsconfig.base.json'), JSON.stringify(base))
  const unsafe = spawnSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')],
    { cwd: directory, encoding: 'utf8' })
  expect(unsafe.status, unsafe.stdout + unsafe.stderr).toBe(0)
  expect(existsSync(join(directory, 'src/index.js'))).toBe(true)
})

it('reports generated neighbors and unsafe output configuration without removing them', () => {
  const directory = fixture()
  const pkg = join(directory, 'packages/test/example')
  mkdirSync(join(pkg, 'src'), { recursive: true })
  writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ compilerOptions: { outDir: 'src/generated' }, files: ['src/index.ts'] }))
  for (const name of ['index.ts', 'index.js', 'index.js.map', 'index.d.ts', 'index.d.ts.map']) {
    writeFileSync(join(pkg, 'src', name), name === 'index.ts' ? 'export {}\n' : '{}\n')
  }
  const errors = sourceOutputViolations(directory)
  expect(errors.filter(value => value.includes('emitted output'))).toHaveLength(4)
  expect(errors).toContain('packages/test/example/tsconfig.json: compiler output points into source: packages/test/example/src/generated')
  expect(errors.some(value => value.includes('current owner: packages/test/example/tsconfig.json'))).toBe(true)
  expect(existsSync(join(pkg, 'src/index.js'))).toBe(true)
})

it('permits named handwritten declarations while rejecting an emitting package without its own output', () => {
  const directory = fixture()
  const pkg = join(directory, 'packages/client/example')
  mkdirSync(join(pkg, 'src'), { recursive: true })
  writeFileSync(join(pkg, 'src/css-modules.d.ts'), 'declare module "*.css"\n')
  writeFileSync(join(pkg, 'src/index.ts'), 'export {}\n')
  writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ files: ['src/index.ts'] }))
  expect(sourceOutputViolations(directory)).toEqual(['packages/client/example/tsconfig.json: emitting project must declare its own output directory'])
  writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ compilerOptions: { outDir: '..' }, files: ['src/index.ts'] }))
  expect(sourceOutputViolations(directory)).toEqual(['packages/client/example/tsconfig.json: emitting project must declare its own output directory'])
  writeFileSync(join(pkg, 'src/css-modules.ts'), 'export {}\n')
  expect(sourceOutputViolations(directory).some(value => value.startsWith('packages/client/example/src/css-modules.d.ts:'))).toBe(true)
})
