// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_STATUSES, StatusBadge, StatusGlyph, type AgentStatus } from '../src/Status.tsx'

afterEach(cleanup)

describe('StatusGlyph and StatusBadge', () => {
  it('rejects an unsupported public status rather than reusing a misleading known glyph', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<StatusGlyph status={'future-state' as AgentStatus} />))
        .toThrow('unknown agent status future-state')
    } finally { error.mockRestore() }
  })
  it.each(AGENT_STATUSES)('draws a distinct shape for %s', (status) => {
    const { container } = render(<StatusGlyph status={status} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-status')).toBe(status)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.innerHTML.length).toBeGreaterThan(0)
  })

  it('gives every state a different shape so color is never the only signal', () => {
    const shapes = AGENT_STATUSES.map((status) => {
      const { container, unmount } = render(<StatusGlyph status={status} />)
      const markup = container.querySelector('svg')!.innerHTML.replace(/class="[^"]*"/g, '')
      unmount()
      return markup
    })
    expect(new Set(shapes).size).toBe(AGENT_STATUSES.length)
  })

  it('names a standalone glyph for assistive technology', () => {
    render(<StatusGlyph status="failed" label="失败" />)
    expect(screen.getByRole('img', { name: '失败' })).toBeDefined()
  })

  it('pairs glyph and words in the badge and keeps protocol detail in the title', () => {
    render(<StatusBadge status="needs-you" title="awaiting-approval">需要你处理</StatusBadge>)
    const badge = screen.getByText('需要你处理').parentElement!
    expect(badge.getAttribute('data-status')).toBe('needs-you')
    expect(badge.getAttribute('title')).toBe('awaiting-approval')
    expect(badge.querySelector('svg[data-status="needs-you"]')).not.toBeNull()
  })

  it('rotates the running arc only through the spin token, which reduced motion stops', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/Status.module.css'), 'utf8')
    expect(css).toMatch(/animation: status-spin var\(--clocky-duration-spin\)/)
    const tokens = readFileSync(resolve(import.meta.dirname, '../../ui-theme/src/styles/tokens.css'), 'utf8')
    const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/--clocky-duration-spin: 0\.01ms/)
    expect(reduced).toMatch(/animation-iteration-count: 1 !important/)
  })
})
