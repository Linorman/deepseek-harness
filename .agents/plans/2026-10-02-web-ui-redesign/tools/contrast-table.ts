// Print the token contrast table for the web UI redesign evidence: run from the repo root with `pnpm exec tsx .agents/plans/2026-10-02-web-ui-redesign/tools/contrast-table.ts`.
import { readFileSync } from 'node:fs'
const css = readFileSync('packages/client/ui-theme/src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`); let depth = 0; let end = start
  for (let i = css.indexOf('{', start); i < css.length; i++) { if (css[i] === '{') depth++; if (css[i] === '}' && --depth === 0) { end = i; break } }
  const body = css.slice(css.indexOf('{', start) + 1, end)
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]))
}
const light = block('body'), dark = block('body[data-ds-dark-theme]')
const resolve = (t: Map<string, string>, v: string): string => { const r = /^var\((--[\w-]+)\)$/.exec(v); return r === null ? v : resolve(t, t.get(r[1]!) ?? light.get(r[1]!)!) }
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! }
const ratio = (t: Map<string, string>, fg: string, bg: string) => { const v = (n: string) => resolve(t, t.get(n) ?? light.get(n)!); const [a, b] = [lum(v(fg)), lum(v(bg))].sort((x, y) => y - x); return ((a! + 0.05) / (b! + 0.05)).toFixed(2) }
const rows: [string, string, string][] = []
for (const fg of ['fg-primary', 'fg-secondary', 'fg-tertiary', 'accent-fg']) for (const bg of ['bg-canvas', 'bg-surface', 'bg-sunken', 'bg-sidebar']) rows.push([fg, bg, '4.5'])
for (const s of ['running', 'waiting', 'needs-you', 'blocked', 'done', 'failed', 'idle']) rows.push([`status-${s}-fg`, `status-${s}-bg`, '4.5'])
for (const h of ['teal', 'fuchsia', 'olive', 'slate']) rows.push([`tint-${h}-fg`, `tint-${h}-bg`, '4.5'])
rows.push(['fg-on-accent', 'accent-bg', '4.5'], ['border-strong', 'bg-surface', '3'], ['border-focus', 'bg-surface', '3'])
console.log('| Foreground | Background | Floor | Light | Dark |\n|---|---|---|---|---|')
for (const [fg, bg, floor] of rows) console.log(`| \`${fg}\` | \`${bg}\` | ${floor}:1 | ${ratio(light, `--clocky-${fg}`, `--clocky-${bg}`)} | ${ratio(dark, `--clocky-${fg}`, `--clocky-${bg}`)} |`)
