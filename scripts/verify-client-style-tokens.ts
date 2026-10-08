/**
 * Ratchet literal presentation values out of Client feature CSS Modules.
 *
 * Feature `*.module.css` files consume role tokens from `ui-theme`; literal
 * colors, font sizes, radii, z-indexes, and durations bypass the shared
 * scales. Existing violations are recorded per file and rule in
 * `client-style-tokens.allowlist.json`. A count above its allowance, or a
 * violation in an unlisted file, fails. A count below its allowance also
 * fails until the allowlist is rewritten, so the list can only shrink.
 *
 * Run directly:
 *   pnpm run verify-client-style-tokens           # check
 *   pnpm run verify-client-style-tokens -- --write  # record lower counts
 * @see ../.agents/notes/proposed/feature/2026-10-02-web-ui-redesign.md
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ALLOWLIST_PATH = join(root, 'scripts/client-style-tokens.allowlist.json')

/** Repository-relative globs that hold feature CSS Modules. */
const SCOPE = ['packages/client/*/src/**/*.module.css', 'packages/*/*/src/client/**/*.module.css']

/**
 * Files whose literals are owned outside the token system. The boot page
 * renders before `ui-theme` mounts its sheets, so it carries its own values.
 */
const EXEMPT = new Set(['packages/client/web/src/boot-page.module.css'])

/** Rule identifiers, in report order. */
export const STYLE_RULES = ['color', 'font-size', 'border-radius', 'z-index', 'duration'] as const

/** One rule that a literal value can break. */
export type StyleRule = typeof STYLE_RULES[number]

/** Per-rule violation counts for one file; absent rules count zero. */
export type RuleCounts = Partial<Record<StyleRule, number>>

/** One literal found in a declaration. */
export interface StyleViolation {
  rule: StyleRule
  /** 1-based line of the declaration. */
  line: number
  /** The declaration as written, trimmed. */
  declaration: string
}

/** CSS named colors other than the keywords `transparent` and `currentcolor`. */
const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
])

const BORDER_SIDE = '(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?'
/** Properties whose values may carry a color. Custom properties are checked too. */
const COLOR_PROPERTY = new RegExp(`^(?:${[
  '--.*',
  'color',
  'background(?:-color|-image)?',
  `border${BORDER_SIDE}(?:-color)?`,
  'outline(?:-color)?',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'caret-color',
  'accent-color',
  'text-decoration(?:-color)?',
  'column-rule(?:-color)?',
  'filter',
  'mask',
  'mask-image',
  'stop-color',
].join('|')})$`)

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const HEX_COLOR = /#[0-9a-f]{3,8}\b/i
const TIME_LITERAL = /(?<![\w.-])(?:\d+\.?\d*|\.\d+)m?s\b/
const ZERO_TIME = /^(?:0+\.?0*|\.0+)m?s$/

/** Remove `var(...)` calls, including nested parentheses, so only literal text remains. */
export function stripVarCalls(value: string): string {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value.startsWith('var(', i)) {
      let depth = 0
      let j = i + 3
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++
        else if (value[j] === ')') {
          depth--
          if (depth === 0) break
        }
      }
      out += ' '
      i = j + 1
      continue
    }
    out += value.charAt(i)
    i++
  }
  return out
}

function hasNumber(literal: string): boolean {
  return /\d/.test(literal)
}

/**
 * Classify one declaration against every rule.
 * @param property - Lower-case property name.
 * @param value - Declared value without the trailing semicolon.
 * @returns Rules broken by literal text outside `var()` calls.
 */
export function classifyDeclaration(property: string, value: string): StyleRule[] {
  const literal = stripVarCalls(value).replace(/!important/i, '').trim()
  const rules: StyleRule[] = []
  if (COLOR_PROPERTY.test(property)) {
    const words = literal.toLowerCase().match(/[a-z]+/g) ?? []
    if (
      HEX_COLOR.test(literal)
      || COLOR_FUNCTION.test(literal)
      || words.some(word => NAMED_COLORS.has(word))
    ) rules.push('color')
  }
  if ((property === 'font-size' || property === 'font') && hasNumber(literal)) rules.push('font-size')
  if (/^border(?:-[a-z]+)*-radius$/.test(property) && /[1-9]/.test(literal)) rules.push('border-radius')
  if (property === 'z-index' && /[1-9]/.test(literal)) rules.push('z-index')
  if (/^(?:transition|animation)(?:-duration|-delay)?$/.test(property)) {
    const times = literal.match(new RegExp(TIME_LITERAL.source, 'g')) ?? []
    if (times.some(time => !ZERO_TIME.test(time))) rules.push('duration')
  }
  return rules
}

/**
 * Scan one stylesheet for literal presentation values.
 * @param css - Stylesheet source.
 * @returns Violations in source order.
 */
export function scanStylesheet(css: string): StyleViolation[] {
  // Blank out comments while keeping line numbers stable.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  const violations: StyleViolation[] = []
  const declaration = /([-a-zA-Z]+)\s*:\s*([^;{}]+?)\s*(?=;|})/g
  for (const match of source.matchAll(declaration)) {
    const [, rawProperty = '', value = ''] = match
    const property = rawProperty.toLowerCase()
    // Selector pseudo-classes (`a:hover {`) never reach here because the
    // lookahead requires `;` or `}`, but `@media (x: y)` would; skip at-rule preludes.
    const before = source.slice(0, match.index)
    const lineStart = before.lastIndexOf('\n') + 1
    if (source.slice(lineStart, match.index).trimStart().startsWith('@')) continue
    const line = before.split('\n').length
    for (const rule of classifyDeclaration(property, value)) {
      violations.push({ rule, line, declaration: `${property}: ${value.trim()}` })
    }
  }
  return violations
}

/** Count violations per rule. */
export function countRules(violations: readonly StyleViolation[]): RuleCounts {
  const counts: RuleCounts = {}
  for (const { rule } of violations) counts[rule] = (counts[rule] ?? 0) + 1
  return counts
}

/** One ratchet failure for a file and rule. */
export interface RatchetFailure {
  file: string
  rule: StyleRule
  allowed: number
  actual: number
}

/**
 * Compare observed counts with the allowlist.
 * @param observed - Counts per repository-relative file.
 * @param allowlist - Recorded allowance per file.
 * @returns Every file/rule whose count differs from its allowance.
 */
export function compareWithAllowlist(
  observed: Readonly<Record<string, RuleCounts>>,
  allowlist: Readonly<Record<string, RuleCounts>>,
): RatchetFailure[] {
  const failures: RatchetFailure[] = []
  const files = new Set([...Object.keys(observed), ...Object.keys(allowlist)])
  for (const file of [...files].sort()) {
    for (const rule of STYLE_RULES) {
      const actual = observed[file]?.[rule] ?? 0
      const allowed = allowlist[file]?.[rule] ?? 0
      if (actual !== allowed) failures.push({ file, rule, allowed, actual })
    }
  }
  return failures
}

/** Collect observed counts for every in-scope file with at least one violation. */
export function collectObserved(repoRoot: string = root): {
  counts: Record<string, RuleCounts>
  details: Record<string, StyleViolation[]>
} {
  const counts: Record<string, RuleCounts> = {}
  const details: Record<string, StyleViolation[]> = {}
  for (const pattern of SCOPE) {
    for (const rel of globSync(pattern, { cwd: repoRoot }).map(p => p.split(sep).join('/')).sort()) {
      if (EXEMPT.has(rel) || counts[rel] !== undefined) continue
      const violations = scanStylesheet(readFileSync(join(repoRoot, rel), 'utf8'))
      if (violations.length === 0) continue
      counts[rel] = countRules(violations)
      details[rel] = violations
    }
  }
  return { counts, details }
}

/**
 * The one package allowed to animate SVG `stroke-dashoffset`: edge draw-in in
 * the shared visualization renderer. Every other package animates only
 * `transform` and `opacity` (docs/web-styling.md).
 */
const DASHOFFSET_OWNER = 'packages/client/ui-viz/'

/** Selector fragments that mark a rule as encoding a domain state. */
const STATE_SELECTOR = /\[data-(?:status|phase|state|stale|slot|stage|driver[\w-]*|node-state)\b|[.:][\w-]*(?:status|phase|state)/i

/** One structural motion or identity-token misuse that no allowlist can admit. */
export interface StructuralViolation {
  file: string
  line: number
  rule: 'stroke-dashoffset' | 'mode-on-state'
  detail: string
}

/** One flat rule: its selector prelude, body text, enclosing at-rule, and starting line. */
interface CssRule { selector: string; body: string; atRule: string | undefined; line: number }

/** Walk a stylesheet into leaf rules, remembering the innermost at-rule prelude. */
function cssRules(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  const rules: CssRule[] = []
  const stack: string[] = []
  let preludeStart = 0
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '{') {
      const prelude = source.slice(preludeStart, i).trim()
      const close = source.indexOf('}', i)
      const nextOpen = source.indexOf('{', i + 1)
      if (prelude.startsWith('@') || (nextOpen !== -1 && nextOpen < close)) {
        stack.push(prelude)
        preludeStart = i + 1
        continue
      }
      const line = source.slice(0, i).split('\n').length
      rules.push({ selector: prelude, body: source.slice(i + 1, close), atRule: stack.at(-1), line })
      i = close
      preludeStart = close + 1
    } else if (char === '}') {
      stack.pop()
      preludeStart = i + 1
    } else if (char === ';' && stack.length === 0) {
      preludeStart = i + 1
    }
  }
  return rules
}

/**
 * Find motion and identity-token misuse in one stylesheet.
 * @param file - Repository-relative path; decides the `stroke-dashoffset` exception.
 * @param css - Stylesheet source.
 * @returns `stroke-dashoffset` animations outside ui-viz and mode identity
 * tokens referenced from state-carrying selectors.
 */
export function structuralViolations(file: string, css: string): StructuralViolation[] {
  const out: StructuralViolation[] = []
  const dashOwner = file.startsWith(DASHOFFSET_OWNER)
  const reportedKeyframes = new Set<string>()
  for (const rule of cssRules(css)) {
    const inKeyframes = rule.atRule?.startsWith('@keyframes') === true
    if (inKeyframes && reportedKeyframes.has(rule.atRule as string)) continue
    if (!dashOwner) {
      const transitions = [...rule.body.matchAll(/(?:^|;)\s*transition(?:-property)?\s*:\s*([^;]+)/g)]
      if (transitions.some(([, value = '']) => value.includes('stroke-dashoffset'))
        || inKeyframes && /stroke-dashoffset\s*:/.test(rule.body)) {
        if (inKeyframes) reportedKeyframes.add(rule.atRule as string)
        out.push({ file, line: rule.line, rule: 'stroke-dashoffset', detail: inKeyframes ? rule.atRule as string : rule.selector })
      }
    }
    if (!inKeyframes && STATE_SELECTOR.test(rule.selector) && /--clocky-mode-/.test(rule.body)) {
      out.push({ file, line: rule.line, rule: 'mode-on-state', detail: rule.selector })
    }
  }
  return out
}

/** Every structural violation across Client CSS sources. */
export function collectStructuralViolations(repoRoot: string = root): StructuralViolation[] {
  const files = [...new Set([
    ...globSync('packages/client/*/src/**/*.css', { cwd: repoRoot }),
    ...globSync('packages/*/*/src/client/**/*.css', { cwd: repoRoot }),
  ].map(p => p.split(sep).join('/')))].sort()
  return files.filter(rel => !rel.startsWith('packages/client/ui-theme/'))
    .flatMap(rel => structuralViolations(rel, readFileSync(join(repoRoot, rel), 'utf8')))
}

/** One `var(--clocky-*)` reference whose name no Client source defines. */
export interface UndefinedTokenReference {
  file: string
  line: number
  token: string
}

/**
 * Names defined by a source file: CSS declarations (`--clocky-x:`) and
 * string keys or `setProperty` arguments in TypeScript.
 */
export function definedTokens(source: string): Set<string> {
  const names = new Set<string>()
  for (const [, name = ''] of source.matchAll(/(--clocky-[a-z0-9-]+)\s*:/g)) names.add(name)
  for (const [, name = ''] of source.matchAll(/['"`](--clocky-[a-z0-9-]+)['"`]/g)) names.add(name)
  return names
}

/**
 * Find `var(--clocky-*)` references to names absent from `defined`.
 * @param file - Repository-relative path for reporting.
 * @param source - File contents.
 * @param defined - Every name defined across Client sources.
 */
export function undefinedReferences(
  file: string, source: string, defined: ReadonlySet<string>,
): UndefinedTokenReference[] {
  const out: UndefinedTokenReference[] = []
  const lines = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n')
  lines.forEach((text, index) => {
    for (const [, token = ''] of text.matchAll(/var\((--clocky-[a-z0-9-]+)/g)) {
      if (!defined.has(token)) out.push({ file, line: index + 1, token })
    }
  })
  return out
}

/** Every reference across Client CSS and TypeScript sources whose name is never defined. */
export function collectUndefinedReferences(repoRoot: string = root): UndefinedTokenReference[] {
  const files = [...new Set([
    ...globSync('packages/client/*/src/**/*.{css,ts,tsx}', { cwd: repoRoot }),
    ...globSync('packages/*/*/src/client/**/*.{css,ts,tsx}', { cwd: repoRoot }),
  ].map(p => p.split(sep).join('/')))].sort()
  const sources = new Map(files.map(rel => [rel, readFileSync(join(repoRoot, rel), 'utf8')]))
  const defined = new Set<string>()
  for (const source of sources.values()) for (const name of definedTokens(source)) defined.add(name)
  return [...sources].flatMap(([rel, source]) => undefinedReferences(rel, source, defined))
}

function readAllowlist(): Record<string, RuleCounts> {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Record<string, RuleCounts>
}

function sortedCounts(counts: Record<string, RuleCounts>): Record<string, RuleCounts> {
  const out: Record<string, RuleCounts> = {}
  for (const file of Object.keys(counts).sort()) {
    const entry: RuleCounts = {}
    for (const rule of STYLE_RULES) {
      const n = counts[file]?.[rule]
      if (n !== undefined && n > 0) entry[rule] = n
    }
    out[file] = entry
  }
  return out
}

function main(argv: readonly string[]): number {
  const write = argv.includes('--write')
  const { counts, details } = collectObserved()
  const allowlist = readAllowlist()
  const failures = compareWithAllowlist(counts, allowlist)
  const increases = failures.filter(f => f.actual > f.allowed)
  if (write) {
    // An empty allowlist is the one bootstrap point; afterwards --write only lowers.
    if (increases.length > 0 && Object.keys(allowlist).length > 0) {
      console.error('verify-client-style-tokens: --write refuses to raise allowances:')
      for (const f of increases) console.error(`  ${f.file} ${f.rule}: ${f.allowed} -> ${f.actual}`)
      return 1
    }
    writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(sortedCounts(counts), null, 2)}\n`)
    console.log(`verify-client-style-tokens: recorded ${Object.keys(counts).length} file(s)`)
    return 0
  }
  const undefinedRefs = collectUndefinedReferences()
  for (const ref of undefinedRefs) {
    console.error(`${ref.file}:${ref.line}: ${ref.token} is not defined by ui-theme or the component; use an existing role token`)
  }
  const structural = collectStructuralViolations()
  for (const violation of structural) {
    console.error(violation.rule === 'stroke-dashoffset'
      ? `${violation.file}:${violation.line}: ${violation.detail} animates stroke-dashoffset; only ui-viz edges may (docs/web-styling.md)`
      : `${violation.file}:${violation.line}: ${violation.detail} carries a domain state but reads a --clocky-mode-* identity token`)
  }
  if (failures.length === 0 && undefinedRefs.length === 0 && structural.length === 0) {
    const total = Object.values(counts).reduce(
      (sum, c) => sum + Object.values(c).reduce((a, b) => a + b, 0), 0)
    console.log(`verify-client-style-tokens: ok (${total} allowlisted literal(s) in ${Object.keys(counts).length} file(s))`)
    return 0
  }
  for (const f of failures) {
    if (f.actual > f.allowed) {
      console.error(`${f.file}: ${f.rule} literals rose from ${f.allowed} to ${f.actual}; use role tokens from ui-theme`)
      for (const v of details[f.file]?.filter(d => d.rule === f.rule) ?? []) {
        console.error(`  ${f.file}:${v.line}  ${v.declaration}`)
      }
    } else {
      console.error(`${f.file}: ${f.rule} literals fell from ${f.allowed} to ${f.actual}; run \`pnpm run verify-client-style-tokens -- --write\` to lock in the reduction`)
    }
  }
  return 1
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) process.exitCode = main(process.argv.slice(2))
