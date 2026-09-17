/** Reject emitted artifacts in source trees and compiler outputs routed back into them. */
import { existsSync, globSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const sourcePatterns = ['packages/*/*/src/**/*', 'apps/*/src/**/*', 'vendor/*/src/**/*', 'native/*/packages/*/src/**/*']
const declarations = new Set([
  'packages/client/ui-renderer/src/client/use-sync-external-store.d.ts',
  'packages/fs/tool-fs-search/src/ripgrep.d.ts',
  'packages/web/tool-web/src/turndown-plugin-gfm.d.ts',
  'packages/extensions/ui-cordis/src/css-modules.d.ts',
  'packages/session-query/session-log-export/src/css-modules.d.ts',
])

/** Locate source pollution without deleting files or assuming which historical command wrote them.
 * @param directory - Repository or test-fixture root.
 * @returns diagnostic paths and current owning compiler output configuration.
 */
export function sourceOutputViolations(directory: string): string[] {
  directory = resolve(directory)
  const failures: string[] = []
  const owners = new Map<string, string>()
  for (const pattern of sourcePatterns) for (const file of globSync(pattern, { cwd: directory })) {
    const path = file.split(sep).join('/')
    if (!/\.(?:[cm]?js(?:\.map)?|d\.[cm]?ts(?:\.map)?)$/.test(path)) continue
    const info = lstatSync(resolve(directory, file))
    if (!info.isFile() && !info.isSymbolicLink()) continue
    const handwritten = declarations.has(path) || /^packages\/client\/[^/]+\/src\/css-modules\.d\.ts$/.test(path)
    const stem = path.replace(/\.d\.ts$/, '')
    if (handwritten && !existsSync(resolve(directory, `${stem}.ts`)) && !existsSync(resolve(directory, `${stem}.tsx`))) continue
    let owner = dirname(resolve(directory, file))
    while (owner !== directory && !existsSync(resolve(owner, 'tsconfig.json'))) {
      const parent = dirname(owner)
      if (parent === owner) break
      owner = parent
    }
    let description = owners.get(owner)
    if (description === undefined) {
      const config = resolve(owner, 'tsconfig.json')
      if (existsSync(config)) {
        const parsed = parseConfig(config)
        description = `${relative(directory, config).split(sep).join('/')} -> ${parsed.options.outDir === undefined
          ? 'no outDir' : relative(directory, parsed.options.outDir).split(sep).join('/')}`
      } else description = 'no owning tsconfig'
      owners.set(owner, description)
    }
    failures.push(`${path}: emitted output in a source tree (current owner: ${description}; historical writer is not inferred)`)
  }
  for (const pattern of ['packages/*/*/tsconfig*.json', 'apps/*/tsconfig*.json', 'native/*/packages/*/tsconfig*.json']) {
    for (const file of globSync(pattern, { cwd: directory })) {
      const config = resolve(directory, file)
      const parsed = parseConfig(config)
      if (parsed.options.noEmit || parsed.fileNames.length === 0) continue
      const output = parsed.options.outDir
      const ownedOutput = output === undefined ? undefined : relative(dirname(config), output)
      if (ownedOutput === undefined || isAbsolute(ownedOutput) || ownedOutput === '..' || ownedOutput.startsWith(`..${sep}`)) {
        failures.push(`${file}: emitting project must declare its own output directory`)
      }
      for (const target of [output, parsed.options.declarationDir]) {
        if (target === undefined) continue
        const path = relative(directory, target).split(sep).join('/')
        if (/^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+|native\/[^/]+\/packages\/[^/]+)\/src(?:\/|$)/.test(path)) {
          failures.push(`${file}: compiler output points into source: ${path}`)
        }
      }
    }
  }
  return failures.sort()
}

/** Resolve inherited compiler options using TypeScript's actual project parser. */
function parseConfig(path: string): ts.ParsedCommandLine {
  const read = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), undefined, path)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const failures = sourceOutputViolations(root)
  for (const failure of failures) process.stderr.write(`${failure}\n`)
  process.stdout.write(`verify-source-outputs: ${failures.length} violation(s); no files changed.\n`)
  process.exitCode = failures.length === 0 ? 0 : 1
}
