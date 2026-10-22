// @vitest-environment jsdom
/** Ambient field: deterministic terrain, stage-scoped scene and pulse signals, and every stillness gate. */
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AmbientBackdrop, AMBIENT_SIGNAL, signalAmbient, terrainContours, useAmbientMotion } from '../src/index.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

function stage(mode: 'team' | 'simulation' = 'simulation') {
  const view = render(<div data-stage><AmbientBackdrop mode={mode} /><main /></div>)
  const field = view.container.querySelector<HTMLElement>('[data-motion-tier="L0"]')!
  const workspace = view.container.querySelector('main')!
  const ring = field.querySelector<HTMLElement>('span:last-child')!
  return { view, field, workspace, ring }
}

describe('terrainContours', () => {
  it('returns the same closed contours for the same seed and different ones for another seed', () => {
    const first = terrainContours('run-a'), again = terrainContours('run-a'), other = terrainContours('run-b')
    expect(first).toEqual(again)
    expect(first).toHaveLength(18)
    expect(first.every(path => path.startsWith('M') && path.endsWith('Z'))).toBe(true)
    expect(other).not.toEqual(first)
  })

  it('honours the requested density', () => {
    expect(terrainContours('seed', { summits: 2, rings: 3 })).toHaveLength(6)
  })
})

describe('AmbientBackdrop', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }))
  beforeEach(() => { animate.mockClear(); Element.prototype.animate = animate as never })

  it('shows the neutral star map until a workspace on its stage publishes a run scene', () => {
    const { field, workspace } = stage()
    expect(field.querySelector('svg')?.dataset.variant).toBe('stars')
    act(() => { signalAmbient(workspace, { kind: 'scene', seed: 'run-1', tone: 'full' }) })
    expect(field.querySelector('svg')?.dataset.variant).toBe('terrain')
    expect(field.querySelectorAll('svg path')).toHaveLength(terrainContours('run-1').length)
    expect(field.dataset.tone).toBe('full')
    act(() => { signalAmbient(workspace, { kind: 'scene', seed: undefined, tone: 'muted' }) })
    expect(field.querySelector('svg')?.dataset.variant).toBe('stars')
    expect(field.dataset.tone).toBe('muted')
  })

  it('ignores signals from outside its own stage and never draws terrain for Team', () => {
    const { field } = stage()
    act(() => { document.body.dispatchEvent(new CustomEvent(AMBIENT_SIGNAL, { bubbles: true, detail: { kind: 'scene', seed: 'x', tone: 'full' } })) })
    expect(field.querySelector('svg')?.dataset.variant).toBe('stars')
    cleanup()
    const team = stage('team')
    act(() => { signalAmbient(team.workspace, { kind: 'scene', seed: 'x', tone: 'full' }) })
    expect(team.field.querySelector('svg')).toBeNull()
  })

  it('answers a live pulse with one ring and merges pulses that arrive within the merge window', () => {
    const { workspace, ring } = stage()
    act(() => { signalAmbient(workspace, { kind: 'pulse', x: 40, y: 30 }) })
    act(() => { signalAmbient(workspace, { kind: 'pulse', x: 50, y: 30 }) })
    expect(animate).toHaveBeenCalledTimes(1)
    expect(ring.style.left).toBe('40px')
  })

  it('holds still and drops pulses when the viewer turns ambient motion off', () => {
    const { field, workspace } = stage()
    const { result } = renderHook(() => useAmbientMotion())
    act(() => { result.current[1]('off') })
    expect(field.dataset.still).toBe('true')
    expect(localStorage.getItem('clocky:ambient-motion')).toBe('off')
    act(() => { signalAmbient(workspace, { kind: 'pulse', x: 1, y: 1 }) })
    expect(animate).not.toHaveBeenCalled()
    act(() => { result.current[1]('on') })
    expect(field.dataset.still).toBeUndefined()
  })

  it('freezes after a minute without input and wakes on the next input', () => {
    vi.useFakeTimers()
    const { field } = stage()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(field.dataset.still).toBe('true')
    act(() => { vi.setSystemTime(Date.now() + 2000); window.dispatchEvent(new Event('pointermove')) })
    expect(field.dataset.still).toBeUndefined()
  })
})
