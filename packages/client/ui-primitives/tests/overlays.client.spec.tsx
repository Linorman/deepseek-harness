// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Avatar, avatarInitials, avatarTone } from '../src/Avatar.tsx'
import { Kbd } from '../src/Kbd.tsx'
import { Popover } from '../src/Popover.tsx'
import { Modal } from '../src/Modal.tsx'
import { Sheet } from '../src/Sheet.tsx'
import { SplitPane, clampPaneSize } from '../src/SplitPane.tsx'
import { useDismissOnOutsidePointer } from '../src/useDismissOnOutsidePointer.ts'

afterEach(cleanup)

it('keeps an owned portaled surface open for pointer input and dismisses only outside both regions', () => {
  function Harness() {
    const root = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    useDismissOnOutsidePointer(root, open, setOpen, surface)
    return <><div ref={root}><button onClick={() => { setOpen(true) }}>Open surface</button></div>
      {open && createPortal(<div ref={surface}><button>Surface action</button></div>, document.body)}
      <button>Outside</button></>
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open surface' }))
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Surface action' }))
  expect(screen.getByRole('button', { name: 'Surface action' })).toBeTruthy()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.queryByRole('button', { name: 'Surface action' })).toBeNull()
})

describe('Avatar', () => {
  it('preserves graphemes in word initials and keeps separator-only names empty', () => {
    expect(avatarInitials('_')).toBe('')
    expect(avatarInitials('e\u0301mile analyst')).toBe('E\u0301A')
    expect(avatarTone('')).toBe('slate')
    expect(avatarTone('😀')).toBe(avatarTone('😀'))
  })
  it('derives initials for CJK and Latin names', () => {
    expect(avatarInitials('协调者')).toBe('协')
    expect(avatarInitials('worker one')).toBe('WO')
    expect(avatarInitials('coordinator')).toBe('CO')
    expect(avatarInitials('  ')).toBe('?')
  })

  it('tints known roles fixedly and unknown roles stably', () => {
    expect(avatarTone('coordinator')).toBe('fuchsia')
    expect(avatarTone('research')).toBe(avatarTone('research'))
    expect(avatarTone(undefined)).toBe('slate')
  })

  it('is a named image unless decorative', () => {
    const { rerender } = render(<Avatar name="worker-1" role="worker" />)
    expect(screen.getByRole('img', { name: 'worker-1' }).getAttribute('data-tone')).toBe(avatarTone('worker'))
    rerender(<Avatar name="worker-1" role="worker" decorative />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('Kbd', () => {
  it('nests one key cap per key', () => {
    const { container } = render(<Kbd keys={['⌘', 'K']} />)
    expect([...container.querySelectorAll('kbd kbd')].map(node => node.textContent)).toEqual(['⌘', 'K'])
  })
})

function PopoverHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchor} type="button" onClick={() => { setOpen(true) }}>状态</button>
      <button type="button">外部</button>
      <Popover open={open} anchorRef={anchor} label="状态详情" onClose={() => { onClose?.(); setOpen(false) }}>
        <button type="button">复制详情</button>
      </Popover>
    </>
  )
}

describe('Popover', () => {
  it('keeps its portal and Escape inside the owning native modal', () => {
    const closeParent = vi.fn()
    render(<Modal open title="Parent" onClose={closeParent}><PopoverHarness /></Modal>)
    const parent = screen.getByRole('dialog', { name: 'Parent' })
    const trigger = screen.getByRole('button', { name: '状态' })
    fireEvent.click(trigger)
    const panel = screen.getByRole('dialog', { name: '状态详情' })
    expect(panel.closest('dialog[open]')).toBe(parent)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('dialog', { name: '状态详情' })).toBeNull()
    expect(closeParent).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })
  it('ignores pointer targets from an unrelated DOM realm', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const foreign = frame.contentDocument!.createElement('button')
    document.body.append(foreign)
    const onClose = vi.fn()
    render(<PopoverHarness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '状态' }))
    fireEvent.pointerDown(foreign)
    expect(onClose).not.toHaveBeenCalled()
    foreign.remove()
    frame.remove()
  })
  it('keeps composition Escape inside the panel and restores no removed anchor', () => {
    const onClose = vi.fn()
    const anchor = document.createElement('button')
    document.body.append(anchor)
    const view = render(<Popover open anchorRef={{ current: anchor }} label="Context" onClose={onClose}>Information</Popover>)
    const dialog = screen.getByRole('dialog', { name: 'Context' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    anchor.remove()
    view.unmount()
    expect(document.activeElement).toBe(document.body)
  })
  it('moves focus inside on open and returns it to the trigger on Escape', () => {
    render(<PopoverHarness />)
    const trigger = screen.getByRole('button', { name: '状态' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '状态详情' })).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '复制详情' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on an outside press but not on a press inside', () => {
    const onClose = vi.fn()
    render(<PopoverHarness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '状态' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '复制详情' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Sheet', () => {
  it('opens as a labeled modal dialog with a close control and footer', () => {
    const onClose = vi.fn()
    render(<Sheet open title="与协调者沟通" closeLabel="关闭" onClose={onClose} footer={<button type="button">发送</button>}>chat</Sheet>)
    const dialog = screen.getByRole('dialog', { name: '与协调者沟通' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '发送' })).toBeDefined()
  })

  it('routes Escape (the dialog cancel event) to onClose', () => {
    const onClose = vi.fn()
    render(<Sheet open title="Sheet" closeLabel="Close" onClose={onClose}>body</Sheet>)
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while closed', () => {
    render(<Sheet open={false} title="Sheet" closeLabel="Close" onClose={() => {}}>body</Sheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

function SplitHarness() {
  const [size, setSize] = useState(400)
  return <SplitPane size={size} onResize={setSize} minSize={320} maxSize={720} handleLabel="调整对话面板宽度" primary="team" secondary="chat" />
}

describe('SplitPane', () => {
  it('ignores uncaptured pointer movement and releases a stationary captured drag', () => {
    render(<SplitHarness />)
    const handle = screen.getByRole('separator')
    let captured = false
    handle.setPointerCapture = () => { captured = true }
    handle.releasePointerCapture = () => { captured = false }
    handle.hasPointerCapture = () => captured
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 50, pointerId: 1 })
    fireEvent.keyDown(handle, { key: 'Tab' })
    expect(handle.getAttribute('aria-valuenow')).toBe('400')
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 })
    expect(captured).toBe(false)
    expect(handle.getAttribute('aria-valuenow')).toBe('400')
  })
  it('clamps sizes to the bounds', () => {
    expect(clampPaneSize(100, 320, 720)).toBe(320)
    expect(clampPaneSize(900, 320, 720)).toBe(720)
    expect(clampPaneSize(500, 320, 720)).toBe(500)
  })

  it('resizes from the keyboard and respects minimum and maximum', () => {
    render(<SplitHarness />)
    const handle = screen.getByRole('separator', { name: '调整对话面板宽度' })
    expect(handle.getAttribute('aria-valuenow')).toBe('400')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle.getAttribute('aria-valuenow')).toBe('416')
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(handle.getAttribute('aria-valuenow')).toBe('352')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle.getAttribute('aria-valuenow')).toBe('320')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handle.getAttribute('aria-valuenow')).toBe('720')
  })

  it('resizes by pointer drag against the drag-start origin', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1 })
    render(<SplitHarness />)
    const handle = screen.getByRole('separator')
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    let captured = false
    handle.hasPointerCapture = () => captured
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 600, pointerId: 1 })
      captured = true
      fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 })
    })
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    act(() => { fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 }) })
    expect(handle.getAttribute('aria-valuenow')).toBe('700')
  })
})
