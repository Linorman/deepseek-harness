// @vitest-environment jsdom
/** Real visibility markers and modal attributes retire live motion without frame polling. */
import { useRef } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useAnimationActive } from '../src/motion/hooks.ts'
import { ConstellationGlyph, SwarmGlyph } from '../src/ModeTile.tsx'

afterEach(cleanup)

function Activity() {
  const ref = useRef<HTMLDivElement>(null)
  const active = useAnimationActive(ref)
  return <div ref={ref} data-testid="activity" data-active={active} />
}

it('pauses behind explicit foreground markers and native modals then resumes', async () => {
  const { container } = render(<Activity />)
  const probe = screen.getByTestId('activity')
  expect(probe.dataset.active).toBe('true')
  container.dataset.behindPane = 'true'
  await waitFor(() => { expect(probe.dataset.active).toBe('false') })
  delete container.dataset.behindPane
  await waitFor(() => { expect(probe.dataset.active).toBe('true') })
  container.hidden = true
  await waitFor(() => { expect(probe.dataset.active).toBe('false') })
  container.hidden = false
  await waitFor(() => { expect(probe.dataset.active).toBe('true') })
  const dialog = document.createElement('dialog')
  document.body.append(dialog)
  try {
    dialog.showModal()
    await waitFor(() => { expect(probe.dataset.active).toBe('false') })
    dialog.close()
    await waitFor(() => { expect(probe.dataset.active).toBe('true') })
  } finally { dialog.remove() }
})

it('never adds an orbit to an empty or settled ring and leaves directories static', () => {
  const { container, rerender } = render(<SwarmGlyph satellites={[]} label="Team" />)
  expect(container.querySelectorAll('g[class]')).toHaveLength(0)
  rerender(<SwarmGlyph satellites={[{ id: 'done', state: 'done' }]} label="Team" />)
  expect(container.querySelectorAll('g[class]')).toHaveLength(0)
  rerender(<SwarmGlyph satellites={[{ id: 'live', state: 'running' }]} label="Team" />)
  expect(container.querySelectorAll('g[class]')).toHaveLength(1)
  rerender(<ConstellationGlyph points={[{ id: 'run' }]} label="Simulation" />)
  expect(container.querySelectorAll('g[class]')).toHaveLength(0)
})
