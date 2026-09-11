import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const verifierSource = fileURLToPath(new URL('./verify-direct-session-entrypoints.ts', import.meta.url))
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function entry(id: string, path: string, symbol: string): Record<string, unknown> {
  return { id, checks: [{ path, symbol }] }
}

function validInventory(): Record<string, unknown> {
  return {
    version: 1,
    sessionEntrypoints: [entry('session-entrypoint', 'source/entry.ts', 'createSession')],
    modelVisibleOrchestration: [entry('model-visible-orchestration', 'source/model.ts', 'createGoal')],
  }
}

function write(root: string, relative: string, source: string): void {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

function fixture(inventory: unknown): string {
  const temporaryRoot = join(repositoryRoot, '.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  const root = mkdtempSync(join(temporaryRoot, 'verify-direct-session-entrypoints-'))
  roots.push(root)
  const verifier = join(root, 'scripts/verify-direct-session-entrypoints.ts')
  mkdirSync(dirname(verifier), { recursive: true })
  copyFileSync(verifierSource, verifier)
  write(root, '.agents/inventory/direct-session-entrypoints.json', `${JSON.stringify(inventory, null, 2)}\n`)
  write(root, 'source/entry.ts', 'export const createSession = true\n')
  write(root, 'source/model.ts', 'export const createGoal = true\n')
  return root
}

function verify(root: string) {
  return spawnSync(process.execPath, [tsxCli, join(root, 'scripts/verify-direct-session-entrypoints.ts')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('direct Session entrypoint inventory verifier', () => {
  it('accepts a valid inventory with checks in both required sections', () => {
    const result = verify(fixture(validInventory()))

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })

  it.each([
    ['a non-object root', [], 'root must be an object'],
    ['an unsupported version', { ...validInventory(), version: 2 }, 'version must be 1'],
    ['a missing session entrypoint section', {
      version: 1,
      modelVisibleOrchestration: validInventory().modelVisibleOrchestration,
    }, 'sessionEntrypoints must be a non-empty array'],
    ['an empty model-visible orchestration section', {
      ...validInventory(),
      modelVisibleOrchestration: [],
    }, 'modelVisibleOrchestration must be a non-empty array'],
  ])('rejects %s', (_label, inventory, message) => {
    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it.each([
    ['a non-array checks field', { ...validInventory(), sessionEntrypoints: [{ id: 'entry', checks: {} }] },
      'sessionEntrypoints[0].checks must be a non-empty array'],
    ['an empty checks field', { ...validInventory(), sessionEntrypoints: [{ id: 'entry', checks: [] }] },
      'sessionEntrypoints[0].checks must be a non-empty array'],
    ['a check without a path', { ...validInventory(), sessionEntrypoints: [{ id: 'entry', checks: [{ symbol: 'probe' }] }] },
      'sessionEntrypoints[0].checks[0].path must be a non-empty string'],
    ['a check without a symbol', { ...validInventory(), sessionEntrypoints: [{ id: 'entry', checks: [{ path: 'source/entry.ts' }] }] },
      'sessionEntrypoints[0].checks[0].symbol must be a non-empty string'],
  ])('rejects %s', (_label, inventory, message) => {
    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('rejects an id reused across the two inventory sections', () => {
    const inventory = validInventory()
    inventory.modelVisibleOrchestration = [entry('session-entrypoint', 'source/model.ts', 'createGoal')]

    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('duplicate entry id "session-entrypoint"')
  })

  it.each(['../outside.ts', process.cwd()])('rejects a source path that escapes the fixture root: %s', (path) => {
    const inventory = validInventory()
    inventory.sessionEntrypoints = [entry('entry', path, 'createSession')]

    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('source path')
    expect(result.stderr).toContain('escapes the repository root')
  })

  it('rejects a source assertion whose file does not exist', () => {
    const inventory = validInventory()
    inventory.sessionEntrypoints = [entry('entry', 'source/missing.ts', 'createSession')]

    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('entry references missing file source/missing.ts')
  })

  it('rejects a source assertion whose symbol is absent', () => {
    const inventory = validInventory()
    inventory.sessionEntrypoints = [entry('entry', 'source/entry.ts', 'missingSymbol')]

    const result = verify(fixture(inventory))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('entry references missing symbol "missingSymbol" in source/entry.ts')
  })
})
