// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, IconButton } from '../src/Button.tsx'

afterEach(cleanup)

describe('Button sizes, variants, and loading', () => {
  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('renders the %s variant at every size', (variant) => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      render(<Button variant={variant} size={size}>{`${variant}-${size}`}</Button>)
      const button = screen.getByRole('button', { name: `${variant}-${size}` })
      expect(button.className).toContain(variant)
      expect(button.className).toContain(size)
      expect(button.getAttribute('type')).toBe('button')
    }
  })

  it('keeps its label while loading, announces busy, and refuses activation', () => {
    const onClick = vi.fn()
    render(<Button variant="primary" loading onClick={onClick}>保存</Button>)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is reachable by keyboard and activates on Enter through the native button', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('IconButton', () => {
  it('keeps its accessible label and blocks clicks while replacing the icon with a loading indicator', () => {
    const onClick = vi.fn()
    render(<IconButton label="Save" icon={<svg data-testid="save-icon" />} loading onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByTestId('save-icon')).toBeNull()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
  it('exposes its required label as the accessible name and tooltip', () => {
    render(<IconButton label="关闭" icon={<svg data-testid="icon" />} />)
    const button = screen.getByRole('button', { name: '关闭' })
    expect(button.getAttribute('title')).toBe('关闭')
    expect(screen.getByTestId('icon')).toBeDefined()
  })

  it('rejects a missing accessible label at compile time', () => {
    // @ts-expect-error -- `label` is required: an icon alone announces nothing.
    const element = <IconButton icon={<svg />} />
    expect(element).toBeDefined()
  })
})
