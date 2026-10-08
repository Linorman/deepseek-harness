// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '../src/Modal.tsx'
import { Card, Section } from '../src/Card.tsx'
import { EmptyState } from '../src/EmptyState.tsx'
import { KeyValue } from '../src/KeyValue.tsx'
import { Skeleton } from '../src/Skeleton.tsx'

afterEach(cleanup)

describe('Modal backdrop', () => {
  it('allows an owner-supplied headless form surface without duplicating its heading', () => {
    render(<Modal open title="Owned form" headless size="form" onClose={vi.fn()}>
      <button type="button">Owner action</button>
    </Modal>)
    expect(screen.getByRole('dialog', { name: 'Owned form' }).getAttribute('data-workspace-form')).toBe('true')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByRole('button', { name: 'Owner action' })).toBeDefined()
  })
  it('dismisses native dialog backdrop coordinates while retaining interior presses', () => {
    const onClose = vi.fn()
    render(<Modal open title="Details" onClose={onClose}><span>Interior</span></Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Details' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 90, 30))
    fireEvent.click(screen.getByText('Interior'))
    fireEvent.click(dialog, { clientX: 15, clientY: 25 })
    expect(onClose).not.toHaveBeenCalled()
    for (const [clientX, clientY] of [[0, 25], [110, 25], [15, 10], [15, 55]]) {
      fireEvent.click(dialog, { clientX, clientY })
    }
    expect(onClose).toHaveBeenCalledTimes(4)
  })
})

describe('Card', () => {
  it('becomes a region named by its title and renders header actions', () => {
    render(<Card title="团队成员" actions={<button type="button">查看全部</button>}>body</Card>)
    expect(screen.getByRole('region', { name: '团队成员' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: '团队成员' })).toBeDefined()
    expect(screen.getByRole('button', { name: '查看全部' })).toBeDefined()
  })

  it('stays an unnamed section without a title', () => {
    render(<Card>plain</Card>)
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.getByText('plain')).toBeDefined()
  })
})

describe('Section', () => {
  it('renders nonempty body content without marking an empty state', () => {
    render(<Section title="Active tasks" actions={<button type="button">Inspect</button>}>Working</Section>)
    const region = screen.getByRole('region', { name: 'Active tasks' })
    expect(region.getAttribute('data-empty')).toBeNull()
    expect(screen.getByText('Working')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Inspect' })).toBeDefined()
  })
  it('replaces its body with one muted line when empty', () => {
    render(<Section title="任务执行" count={0} empty="还没有执行中的任务"><table /></Section>)
    const region = screen.getByRole('region', { name: '任务执行 0' })
    expect(region.getAttribute('data-empty')).toBe('true')
    expect(screen.getByText('还没有执行中的任务')).toBeDefined()
    expect(region.querySelector('table')).toBeNull()
  })

  it('toggles a collapsible body from the keyboard-reachable heading button', () => {
    render(<Section title="技术详情" collapsible defaultOpen={false}>details</Section>)
    const toggle = screen.getByRole('button', { name: '技术详情' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('details')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.textContent).toBe('details')
  })
})

describe('EmptyState', () => {
  it('allows a decorative illustration without offering an unavailable next action', () => {
    render(<EmptyState title="No permitted next action" icon={<svg data-testid="illustration" />} compact />)
    expect(screen.getByRole('status').textContent).toContain('No permitted next action')
    expect(screen.getByTestId('illustration').parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('shows one sentence and one action as a status region', () => {
    render(<EmptyState title="还没有团队任务" action={<button type="button">新建团队任务</button>} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('还没有团队任务')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('Skeleton', () => {
  it('announces one busy status with decorative bars', () => {
    const { container } = render(<Skeleton lines={3} label="正在加载成员" />)
    const status = screen.getByRole('status', { name: '正在加载成员' })
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
  })
})

describe('KeyValue', () => {
  it('renders facts as a description list in order', () => {
    const { container } = render(<KeyValue items={[
      { id: 'phase', label: '阶段', value: '已暂停' },
      { id: 'clock', label: '模拟时间', value: '1,240 分钟' },
    ]} />)
    expect([...container.querySelectorAll('dt')].map(node => node.textContent)).toEqual(['阶段', '模拟时间'])
    expect([...container.querySelectorAll('dd')].map(node => node.textContent)).toEqual(['已暂停', '1,240 分钟'])
  })
})
