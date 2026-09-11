/**
 * Validate the Phase 0 inventory of legacy Session entry points and
 * model-visible orchestration controls.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INVENTORY_PATH = '.agents/inventory/direct-session-entrypoints.json'

type Check = {
  readonly path: string
  readonly symbol: string
}

type InventoryEntry = {
  readonly id: string
  readonly checks: readonly Check[]
}

type Inventory = {
  readonly version: number
  readonly sessionEntrypoints: readonly InventoryEntry[]
  readonly modelVisibleOrchestration: readonly InventoryEntry[]
}

/** Return a plain record, or throw an inventory-specific validation error. */
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${INVENTORY_PATH}: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Return a required non-empty string field. */
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${INVENTORY_PATH}: ${label} must be a non-empty string`)
  }
  return value
}

/** Decode one path-and-symbol assertion. */
function decodeCheck(value: unknown, label: string): Check {
  const source = record(value, label)
  return {
    path: requiredString(source.path, `${label}.path`),
    symbol: requiredString(source.symbol, `${label}.symbol`),
  }
}

/** Decode one inventory item and require at least one assertion. */
function decodeEntry(value: unknown, label: string): InventoryEntry {
  const entry = record(value, label)
  const checksValue = entry.checks
  if (!Array.isArray(checksValue) || checksValue.length === 0) {
    throw new Error(`${INVENTORY_PATH}: ${label}.checks must be a non-empty array`)
  }
  return {
    id: requiredString(entry.id, `${label}.id`),
    checks: checksValue.map((check, index) => decodeCheck(check, `${label}.checks[${index}]`)),
  }
}

/** Decode a non-empty inventory section. */
function decodeSection(value: unknown, label: string): InventoryEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${INVENTORY_PATH}: ${label} must be a non-empty array`)
  }
  return value.map((entry, index) => decodeEntry(entry, `${label}[${index}]`))
}

/** Decode the checked-in inventory before reading its referenced sources. */
function decodeInventory(value: unknown): Inventory {
  const inventory = record(value, 'root')
  if (inventory.version !== 1) {
    throw new Error(`${INVENTORY_PATH}: version must be 1`)
  }
  return {
    version: inventory.version,
    sessionEntrypoints: decodeSection(inventory.sessionEntrypoints, 'sessionEntrypoints'),
    modelVisibleOrchestration: decodeSection(inventory.modelVisibleOrchestration, 'modelVisibleOrchestration'),
  }
}

/** Reject a path that escapes the repository root or names an absolute file. */
function sourcePath(path: string): string {
  const absolute = resolve(ROOT, path)
  const fromRoot = relative(ROOT, absolute)
  if (isAbsolute(path) || fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${INVENTORY_PATH}: source path ${JSON.stringify(path)} escapes the repository root`)
  }
  return absolute
}

/** Validate unique item ids and every source assertion. */
function validate(inventory: Inventory): void {
  const ids = new Set<string>()
  for (const entry of [...inventory.sessionEntrypoints, ...inventory.modelVisibleOrchestration]) {
    if (ids.has(entry.id)) throw new Error(`${INVENTORY_PATH}: duplicate entry id ${JSON.stringify(entry.id)}`)
    ids.add(entry.id)
    for (const check of entry.checks) {
      const absolute = sourcePath(check.path)
      if (!existsSync(absolute)) {
        throw new Error(`${INVENTORY_PATH}: ${entry.id} references missing file ${check.path}`)
      }
      const source = readFileSync(absolute, 'utf8')
      if (!source.includes(check.symbol)) {
        throw new Error(
          `${INVENTORY_PATH}: ${entry.id} references missing symbol ${JSON.stringify(check.symbol)} in ${check.path}`,
        )
      }
    }
  }
}

/** Load and validate the inventory; exported for direct test invocation. */
export function main(): void {
  const source = readFileSync(resolve(ROOT, INVENTORY_PATH), 'utf8')
  validate(decodeInventory(JSON.parse(source) as unknown))
}

if (import.meta.main) {
  try {
    main()
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
