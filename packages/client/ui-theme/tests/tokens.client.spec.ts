/**
 * Role token contract, asserted against tokens.css on disk: every color role
 * and agent state exists in both themes, every scale named by the redesign is
 * declared, reduced motion collapses every movement duration while keeping
 * the opacity fade, and text roles keep their contrast floors over the
 * surfaces they sit on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarations of the first block whose selector list matches exactly. */
function block(selector: string, source = css): Map<string, string> {
  const start = source.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no block for ${selector}`)
  let depth = 0
  let end = start
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) { end = i; break }
  }
  const body = source.slice(source.indexOf('{', start) + 1, end)
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.replace(/\s+/g, ' ').trim()]))
}

const root = block(':root')
const light = block('body')
const dark = block('body[data-ds-dark-theme]')
const reduced = block(':root', css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)')))

const COLOR_ROLES = [
  'bg-canvas', 'bg-surface', 'bg-raised', 'bg-sunken', 'bg-overlay', 'bg-sidebar',
  'fg-primary', 'fg-secondary', 'fg-tertiary', 'fg-disabled', 'fg-on-accent',
  'border-subtle', 'border-default', 'border-strong', 'border-focus',
  'accent-fg', 'accent-bg', 'accent-bg-hover', 'accent-subtle',
]
const STATES = ['running', 'waiting', 'needs-you', 'blocked', 'done', 'failed', 'idle']

/** Resolve a value through palette references inside one theme. */
function resolve(theme: Map<string, string>, value: string): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (ref === null) return value
  const next = theme.get(ref[1]!) ?? light.get(ref[1]!)
  if (next === undefined) throw new Error(`unresolved ${ref[1]}`)
  return resolve(theme, next)
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(themeName: 'light' | 'dark', fg: string, bg: string): number {
  const theme = themeName === 'light' ? light : dark
  const value = (name: string) => resolve(theme, theme.get(name) ?? light.get(name)!)
  const [a, b] = [luminance(value(fg)), luminance(value(bg))].sort((x, y) => y - x)
  return (a! + 0.05) / (b! + 0.05)
}

describe('ui-theme role tokens', () => {
  it.each(COLOR_ROLES)('declares the %s color role in both themes', (role) => {
    expect(light.has(`--clocky-${role}`)).toBe(true)
    expect(dark.has(`--clocky-${role}`)).toBe(true)
  })

  it.each(STATES)('declares fg, bg, and border for the %s agent state in both themes', (state) => {
    for (const part of ['fg', 'bg', 'border']) {
      expect(light.has(`--clocky-status-${state}-${part}`)).toBe(true)
      expect(dark.has(`--clocky-status-${state}-${part}`)).toBe(true)
    }
  })

  it('declares every scale the redesign names', () => {
    for (const step of ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12']) expect(root.has(`--clocky-space-${step}`)).toBe(true)
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl', 'full']) expect(root.has(`--clocky-radius-${size}`)).toBe(true)
    for (const layer of ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'toast', 'tooltip']) expect(root.has(`--clocky-layer-${layer}`)).toBe(true)
    for (const level of ['0', '1', '2', '3', '4']) expect(light.has(`--clocky-elevation-${level}`)).toBe(true)
    for (const duration of ['instant', 'fast', 'base', 'slow', 'deliberate']) expect(root.has(`--clocky-duration-${duration}`)).toBe(true)
    for (const ease of ['standard', 'enter', 'exit', 'spring']) expect(root.has(`--clocky-ease-${ease}`)).toBe(true)
    expect(root.get('--clocky-ease-spring')).toMatch(/^linear\(/)
    for (const role of ['display', 'title', 'heading', 'body', 'body-reading', 'label', 'caption', 'micro', 'mono', 'mono-small']) {
      expect(light.has(`--clocky-type-${role}`)).toBe(true)
      for (const part of ['size', 'line-height', 'weight']) expect(root.has(`--clocky-type-${role}-${part}`)).toBe(true)
    }
  })

  it('keeps the layer scale ordered so overlays stack predictably', () => {
    const order = ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'popover', 'toast', 'tooltip']
      .map(layer => Number(root.get(`--clocky-layer-${layer}`)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('collapses every movement duration under reduced motion but keeps the opacity fade', () => {
    const durations = [...root.keys()].filter(name => name.startsWith('--clocky-duration-'))
    for (const name of durations) {
      if (name === '--clocky-duration-fade' || name === '--clocky-duration-dwell') expect(reduced.has(name)).toBe(false)
      else expect(reduced.get(name)).toBe('0.01ms')
    }
    expect(css).toMatch(/animation-iteration-count: 1 !important/)
  })

  it.each(['light', 'dark'] as const)('keeps text roles at or above 4.5:1 on every surface in %s', (theme) => {
    for (const fg of ['--clocky-fg-primary', '--clocky-fg-secondary', '--clocky-fg-tertiary', '--clocky-accent-fg']) {
      for (const bg of ['--clocky-bg-canvas', '--clocky-bg-surface', '--clocky-bg-raised', '--clocky-bg-sunken', '--clocky-bg-sidebar']) {
        expect(contrast(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const state of STATES) {
      expect(contrast(theme, `--clocky-status-${state}-fg`, `--clocky-status-${state}-bg`), state).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme, `--clocky-status-${state}-fg`, '--clocky-bg-surface'), state).toBeGreaterThanOrEqual(4.5)
    }
    for (const tint of ['teal', 'fuchsia', 'olive', 'slate']) {
      expect(contrast(theme, `--clocky-tint-${tint}-fg`, `--clocky-tint-${tint}-bg`), tint).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme, `--clocky-tint-${tint}-fg`, '--clocky-bg-surface'), tint).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['light', 'dark'] as const)('keeps control boundaries and focus at or above 3:1 in %s', (theme) => {
    for (const fg of ['--clocky-border-strong', '--clocky-border-focus']) {
      for (const bg of ['--clocky-bg-canvas', '--clocky-bg-surface']) {
        expect(contrast(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
    expect(contrast(theme, '--clocky-fg-on-accent', '--clocky-accent-bg')).toBeGreaterThanOrEqual(4.5)
  })

  it('declares the expressive token families in both themes', () => {
    for (const mode of ['team', 'simulation']) {
      for (const part of ['fg', 'bg', 'subtle', 'glow', 'gradient']) {
        expect(light.has(`--clocky-mode-${mode}-${part}`), `${mode}-${part}`).toBe(true)
        expect(dark.has(`--clocky-mode-${mode}-${part}`), `${mode}-${part}`).toBe(true)
      }
    }
    for (const state of ['running', 'needs-you', 'failed', 'done']) {
      expect(light.get(`--clocky-glow-${state}`)).toContain(`--clocky-status-${state}-`)
    }
    for (const name of ['surface-glass', 'blur-glass', 'viz-grid', 'viz-edge', 'viz-edge-active', 'viz-edge-ghost', 'viz-node-ring', 'viz-halo']) {
      expect(light.has(`--clocky-${name}`), name).toBe(true)
      expect(dark.has(`--clocky-${name}`), name).toBe(true)
    }
    for (const role of ['hero', 'metric']) {
      expect(light.has(`--clocky-type-${role}`)).toBe(true)
      for (const part of ['size', 'line-height', 'weight']) expect(root.has(`--clocky-type-${role}-${part}`)).toBe(true)
    }
    expect(light.get('--clocky-type-metric')).toContain('--ds-font-family-code')
    for (const motion of ['duration-orbit', 'duration-flow', 'duration-celebrate', 'ease-emphasized', 'stagger-step']) {
      expect(root.has(`--clocky-${motion}`), motion).toBe(true)
    }
    expect(reduced.get('--clocky-stagger-step')).toBe('0ms')
  })

  it.each(['light', 'dark'] as const)('keeps mode identity text at or above 4.5:1 in %s', (theme) => {
    for (const mode of ['team', 'simulation']) {
      for (const bg of ['--clocky-bg-canvas', '--clocky-bg-surface', '--clocky-bg-sidebar', `--clocky-mode-${mode}-bg`]) {
        expect(contrast(theme, `--clocky-mode-${mode}-fg`, bg), `${mode} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(['light', 'dark'] as const)('keeps the Simulation identity hue apart from the waiting state in %s', (theme) => {
    const table = theme === 'light' ? light : dark
    const value = (name: string) => resolve(table, table.get(name) ?? light.get(name)!)
    const distance = Math.abs(hue(value('--clocky-mode-simulation-fg')) - hue(value('--clocky-status-waiting-fg')))
    expect(Math.min(distance, 360 - distance)).toBeGreaterThanOrEqual(30)
    const team = Math.abs(hue(value('--clocky-mode-team-fg')) - hue(value('--clocky-mode-simulation-fg')))
    expect(Math.min(team, 360 - team)).toBeGreaterThanOrEqual(90)
  })
})

/** HSL hue in degrees of a #rrggbb color. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (delta === 0) return 0
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (raw * 60 + 360) % 360
}
