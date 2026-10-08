// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Toast } from '../src/Toast.tsx'

afterEach(cleanup)

/** jsdom has no AnimationEvent; name the ended keyframes as a scoped CSS module would. */
function endAnimation(element: Element, animationName: string): void {
  const event = new Event('animationend', { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: animationName })
  element.dispatchEvent(event)
}

describe('Toast', () => {
  it('announces its text and reports done only when the exit fade ends', () => {
    const onDone = vi.fn()
    const view = render(<Toast text="最多添加 50 张图片" icon={<svg data-testid="icon" />} onDone={onDone} />)
    const banner = view.getByRole('alert')
    expect(banner.textContent).toContain('最多添加 50 张图片')
    expect(view.getByTestId('icon')).toBeTruthy()
    endAnimation(banner, '_clocky-toast-in_x1')
    expect(onDone).not.toHaveBeenCalled()
    endAnimation(banner, '_clocky-toast-fade_x1')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('centers over its anchor and re-measures on window resize', () => {
    vi.useFakeTimers()
    try {
      const anchor = document.createElement('div')
      document.body.appendChild(anchor)
      anchor.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      const view = render(<Toast text="anchored" anchor={anchor} onDone={vi.fn()} />)
      expect(view.getByRole('alert').style.left).toBe('300px')
      anchor.getBoundingClientRect = () => ({ left: 200, width: 400 }) as DOMRect
      fireEvent(window, new Event('resize'))
      expect(view.getByRole('alert').style.left).toBe('400px')
      anchor.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders without an icon', () => {
    const view = render(<Toast text="plain" onDone={vi.fn()} />)
    expect(view.getByRole('alert').querySelector('[aria-hidden]')).toBeNull()
  })
})
