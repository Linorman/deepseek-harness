// @vitest-environment jsdom
// ThemePresenter behavior account: root color-scheme and the palette attribute
// follow active.colorScheme only, token variables replace the previous apply's
// set, theme-color metadata follows the rendered body background, and dispose
// retracts everything the presenter wrote.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeSnapshot } from '@clocky/clocky-client-ui-theme/client'
import { DARK_ATTRIBUTE, SWITCHING_ATTRIBUTE, ThemePresenter } from '@clocky/clocky-client-ui-layout/src/client/theme-presenter.ts'

const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

function snapshot(colorScheme: 'light' | 'dark', tokens: Record<string, string> = {}): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return { preference: colorScheme, active, themes: [active], revision: 1 }
}

function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute('style')
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(clearThemePresentation)

describe('ThemePresenter', () => {
  it('suspends transitions until the frame after a snapshot lands, and dispose lifts a pending suspension', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.splice(handle - 1, 1, () => {}) })
    try {
      const presenter = new ThemePresenter()
      presenter.apply(snapshot('dark'))
      expect(document.documentElement.hasAttribute(SWITCHING_ATTRIBUTE)).toBe(true)
      frames.shift()?.(0)
      expect(document.documentElement.hasAttribute(SWITCHING_ATTRIBUTE)).toBe(false)
      presenter.apply(snapshot('light'))
      expect(document.documentElement.hasAttribute(SWITCHING_ATTRIBUTE)).toBe(true)
      presenter.dispose()
      expect(document.documentElement.hasAttribute(SWITCHING_ATTRIBUTE)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--clocky-bg-canvas': '#111', '--clocky-fg-primary': '#eee' }))
    expect(document.body.style.getPropertyValue('--clocky-bg-canvas')).toBe('#111')
    expect(document.body.style.getPropertyValue('--clocky-fg-primary')).toBe('#eee')
    presenter.apply(snapshot('light', { '--clocky-bg-canvas': '#fff' }))
    expect(document.body.style.getPropertyValue('--clocky-bg-canvas')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--clocky-fg-primary')).toBe('')
  })

  it('dispose removes color-scheme, the attribute, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--clocky-bg-canvas': '#111' }))
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--clocky-bg-canvas')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })
})
