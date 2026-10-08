/** Tests for the Client feature CSS literal-value ratchet. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyDeclaration,
  collectObserved,
  collectUndefinedReferences,
  collectStructuralViolations,
  compareWithAllowlist,
  countRules,
  structuralViolations,
  scanStylesheet,
  stripVarCalls,
  undefinedReferences,
  type RuleCounts,
} from './verify-client-style-tokens.ts'

describe('client style token classification', () => {
  it.each([
    ['color', '#fff'],
    ['background', 'rgb(15 23 42 / 38%)'],
    ['border', '1px solid red'],
    ['--json-tree-string', '#c41a16'],
    ['box-shadow', '0 1px 2px rgba(0, 0, 0, 0.1)'],
  ])('rejects a literal color in %s: %s', (property, value) => {
    expect(classifyDeclaration(property, value)).toContain('color')
  })

  it.each([
    ['color', 'var(--clocky-fg-primary)'],
    ['background', 'transparent'],
    ['border-color', 'currentColor'],
    ['color', 'var(--clocky-fg-primary, #000)'],
    ['background', 'color-mix(in srgb, var(--a) 50%, transparent)'],
  ])('accepts a token or keyword color in %s: %s', (property, value) => {
    expect(classifyDeclaration(property, value)).not.toContain('color')
  })

  it('rejects literal font sizes, including the shorthand, but not token sizes', () => {
    expect(classifyDeclaration('font-size', '13px')).toEqual(['font-size'])
    expect(classifyDeclaration('font', '500 13px/20px var(--clocky-font-family)')).toEqual(['font-size'])
    expect(classifyDeclaration('font-size', 'var(--clocky-type-body-size)')).toEqual([])
    expect(classifyDeclaration('font', 'var(--clocky-type-label)')).toEqual([])
    expect(classifyDeclaration('font-size', 'inherit')).toEqual([])
  })

  it('rejects non-zero literal radii and z-indexes', () => {
    expect(classifyDeclaration('border-radius', '8px')).toEqual(['border-radius'])
    expect(classifyDeclaration('border-top-left-radius', '50%')).toEqual(['border-radius'])
    expect(classifyDeclaration('border-radius', '0')).toEqual([])
    expect(classifyDeclaration('border-radius', 'var(--clocky-radius-md)')).toEqual([])
    expect(classifyDeclaration('z-index', '1100')).toEqual(['z-index'])
    expect(classifyDeclaration('z-index', '0')).toEqual([])
    expect(classifyDeclaration('z-index', 'var(--clocky-layer-modal)')).toEqual([])
  })

  it('rejects non-zero literal durations in transitions and animations', () => {
    expect(classifyDeclaration('transition', 'opacity 100ms ease')).toEqual(['duration'])
    expect(classifyDeclaration('animation', 'spin 1.2s linear infinite')).toEqual(['duration'])
    expect(classifyDeclaration('transition-delay', '.5s')).toEqual(['duration'])
    expect(classifyDeclaration('transition', 'opacity var(--clocky-duration-fast) var(--clocky-ease-standard)')).toEqual([])
    expect(classifyDeclaration('animation-delay', '0s')).toEqual([])
  })

  it('strips nested var() calls so fallbacks inside them do not count', () => {
    expect(stripVarCalls('var(--a, var(--b, 4px)) 2px').trim()).toBe('2px')
  })
})

describe('client style token scanning', () => {
  it('reports declarations with lines and ignores comments and at-rule preludes', () => {
    const css = [
      '/* color: red; */',
      '.a { color: #fff; }',
      '@media (max-width: 600px) {',
      '  .b { font-size: 12px; }',
      '}',
    ].join('\n')

    expect(scanStylesheet(css)).toEqual([
      { rule: 'color', line: 2, declaration: 'color: #fff' },
      { rule: 'font-size', line: 4, declaration: 'font-size: 12px' },
    ])
  })

  it('counts violations per rule', () => {
    expect(countRules(scanStylesheet('.a { font-size: 12px; z-index: 3; font-size: 11px }')))
      .toEqual({ 'font-size': 2, 'z-index': 1 })
  })
})

describe('client style token ratchet', () => {
  it('fails when a deliberate literal is added to an allowlisted file', () => {
    const failures = compareWithAllowlist(
      { 'a.module.css': { color: 2 } },
      { 'a.module.css': { color: 1 } },
    )

    expect(failures).toEqual([{ file: 'a.module.css', rule: 'color', allowed: 1, actual: 2 }])
  })

  it('fails for a new file that is absent from the allowlist', () => {
    expect(compareWithAllowlist({ 'new.module.css': { 'z-index': 1 } }, {}))
      .toEqual([{ file: 'new.module.css', rule: 'z-index', allowed: 0, actual: 1 }])
  })

  it('fails when a count falls until the allowlist records the reduction', () => {
    expect(compareWithAllowlist({}, { 'a.module.css': { duration: 1 } }))
      .toEqual([{ file: 'a.module.css', rule: 'duration', allowed: 1, actual: 0 }])
  })

  it('matches the recorded allowlist for the current tree', () => {
    const allowlist = JSON.parse(readFileSync(
      resolve(import.meta.dirname, 'client-style-tokens.allowlist.json'), 'utf8')) as Record<string, RuleCounts>

    expect(compareWithAllowlist(collectObserved().counts, allowlist)).toEqual([])
  })
})

describe('client style token references', () => {
  it('reports a reference to a name that nothing defines', () => {
    const css = '.a { color: var(--clocky-alias-text-primary); background: var(--clocky-known); }'

    expect(undefinedReferences('a.module.css', css, new Set(['--clocky-known'])))
      .toEqual([{ file: 'a.module.css', line: 1, token: '--clocky-alias-text-primary' }])
  })

  it('finds no undefined references in the current tree', () => {
    expect(collectUndefinedReferences()).toEqual([])
  })
})

describe('client style structural motion and identity rules', () => {
  const draw = '@keyframes draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }\n.edge { animation: draw var(--clocky-duration-base); }'

  it('rejects a stroke-dashoffset keyframe animation outside ui-viz', () => {
    expect(structuralViolations('packages/client/ui-team/src/client/Graph.module.css', draw))
      .toEqual([expect.objectContaining({ rule: 'stroke-dashoffset' })])
  })

  it('rejects a stroke-dashoffset transition outside ui-viz', () => {
    const css = '.edge { transition: stroke-dashoffset var(--clocky-duration-base) var(--clocky-ease-standard); }'
    expect(structuralViolations('packages/client/ui-simulation/src/client/Timeline.module.css', css))
      .toEqual([expect.objectContaining({ rule: 'stroke-dashoffset', line: 1 })])
  })

  it('admits the stroke-dashoffset edge draw-in inside ui-viz only', () => {
    expect(structuralViolations('packages/client/ui-viz/src/GraphView.module.css', draw)).toEqual([])
  })

  it('rejects mode identity tokens on state-carrying selectors, including nested ones', () => {
    const css = '.node[data-status="running"] { box-shadow: var(--clocky-mode-team-glow); }\n'
      + '@media (min-width: 1px) { .phaseDone { color: var(--clocky-mode-simulation-fg); } }'
    expect(structuralViolations('packages/client/ui-team/src/client/A.module.css', css).map(v => v.rule))
      .toEqual(['mode-on-state', 'mode-on-state'])
  })

  it('accepts mode identity tokens on chrome selectors', () => {
    const css = '.backdrop[data-mode="team"] { background: var(--clocky-mode-team-gradient); }\n.switch { color: var(--clocky-mode-team-fg); }'
    expect(structuralViolations('packages/client/ui-layout/src/client/AppFrame.module.css', css)).toEqual([])
  })

  it('finds no structural violations in the current tree', () => {
    expect(collectStructuralViolations(resolve(import.meta.dirname, '..'))).toEqual([])
  })
})
