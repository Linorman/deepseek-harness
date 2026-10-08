// @vitest-environment jsdom
/** Renderer parity, list-view contract, keyboard traversal, and live-only motion. */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  describeVisualization, GraphView, LaneView, layoutLanes, Odometer, RadialProgress, Sparkline, useLiveTransition,
  ViewSwitch, VizListView, type GraphNodeView, type VizItem,
} from '../src/index.ts'

beforeAll(() => {
  // jsdom has no canvas backend; the renderer must tolerate a missing context.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})
afterEach(cleanup)

const nodes: GraphNodeView[] = [
  { id: 'c', x: 0, y: 0, label: '协调者', state: 'running', stateLabel: '运行中', initials: 'C' },
  { id: 'w1', x: 120, y: 0, label: '工人一', state: 'idle', stateLabel: '空闲' },
  { id: 'w2', x: 0, y: 120, label: '工人二', state: 'failed', stateLabel: '失败' },
  { id: 'ghost', x: 120, y: 120, label: '页外成员', state: 'idle', stateLabel: '未加载', ghost: true },
]
const edges = [{ id: 'c-w1', from: 'c', to: 'w1', variant: 'solid' as const }, { id: 'c-w2', from: 'c', to: 'w2', variant: 'dashed' as const }]
const controls = { zoomIn: '放大', zoomOut: '缩小', fit: '适配' }

describe('GraphView', () => {
  it.each(['svg', 'canvas'] as const)('gives every node one focus proxy with its state in the %s renderer', (renderer) => {
    render(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} renderer={renderer} controls={controls} />)
    for (const node of nodes) expect(screen.getByRole('button', { name: new RegExp(`^${node.label} · ${node.stateLabel}`) })).toBeTruthy()
    expect(screen.getByRole('group', { name: '蜂群' }).dataset.renderer).toBe(renderer)
  })

  it('switches to canvas above the mark threshold', () => {
    render(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} markThreshold={3} controls={controls} />)
    expect(screen.getByRole('group', { name: '蜂群' }).dataset.renderer).toBe('canvas')
  })

  it.each(['svg', 'canvas'] as const)('hits the same node a pointer lands on in the %s renderer', (renderer) => {
    const onSelect = vi.fn()
    render(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} renderer={renderer} controls={controls} onSelect={onSelect} />)
    const frame = screen.getByRole('group', { name: '蜂群' })
    const proxy = screen.getByRole('button', { name: /^工人二/ })
    const at = { clientX: Number.parseFloat(proxy.style.left), clientY: Number.parseFloat(proxy.style.top), button: 0 }
    fireEvent.pointerDown(frame, at)
    fireEvent.pointerUp(frame, at)
    expect(onSelect).toHaveBeenCalledWith('w2')
  })

  it('moves focus spatially with arrow keys and activates with Enter', () => {
    const onActivate = vi.fn()
    render(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} controls={controls} onActivate={onActivate} />)
    const start = screen.getByRole('button', { name: /^协调者/ })
    expect(start.tabIndex).toBe(0)
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^工人一/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^页外成员/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith('ghost')
  })

  it('marks ghosts and stale nodes as separate encodings', () => {
    const { container } = render(<GraphView label="蜂群" description="摘要" nodes={[...nodes, { id: 's', x: 240, y: 0, label: '陈旧', state: 'running', stateLabel: '运行中', stale: true }]}
      edges={edges} controls={controls} />)
    expect(container.querySelector('[data-node-id="ghost"]')?.getAttribute('data-ghost')).toBe('true')
    expect(container.querySelector('[data-node-id="s"]')?.getAttribute('data-stale')).toBe('true')
    expect(container.querySelector('[data-node-id="s"]')?.getAttribute('data-state')).toBe('running')
  })

  it('plays no assemble choreography unless the owner asks for it', () => {
    const { container, rerender } = render(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} controls={controls} />)
    expect(container.querySelectorAll('[data-entering], [data-draw-in]')).toHaveLength(0)
    rerender(<GraphView label="蜂群" description="摘要" nodes={nodes} edges={edges} controls={controls} assemble />)
    expect(container.querySelectorAll('[data-entering]')).toHaveLength(nodes.length)
    expect(screen.getByRole('group', { name: '蜂群' }).dataset.motionTier).toBe('L3')
  })
})

describe('VizListView', () => {
  const items: VizItem[] = nodes.map(node => ({
    id: node.id, label: node.label, state: node.state, stateLabel: node.stateLabel, ghost: node.ghost,
  }))
  const words = { loaded: (loaded: number, total: number | undefined) => `已加载 ${String(loaded)}/${String(total)}`, ghost: '未加载', stale: '陈旧' }

  it('lists the same items as the visualization with the loaded count', () => {
    render(<VizListView label="成员" items={items} count={{ loaded: 3, total: 4 }} words={words} />)
    expect(screen.getByText('已加载 3/4')).toBeTruthy()
    const list = screen.getByRole('list', { name: '成员' })
    expect(list.querySelectorAll('button')).toHaveLength(items.length)
    expect(screen.getByRole('button', { name: /页外成员.*未加载/ })).toBeTruthy()
  })

  it('traverses with arrow keys and selects with click', () => {
    const onSelect = vi.fn()
    render(<VizListView label="成员" items={items} count={{ loaded: 3 }} words={words} onSelect={onSelect} />)
    const first = screen.getByRole('button', { name: /协调者/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /页外成员/ }))
    fireEvent.click(document.activeElement!)
    expect(onSelect).toHaveBeenCalledWith('ghost')
  })

  it('summarizes states, ghosts, and stale items in one sentence', () => {
    const text = describeVisualization('蜂群', [...items, { id: 'x', label: 'x', state: 'running', stateLabel: '运行中', stale: true }], { loaded: 4, total: 6 }, {
      loaded: (loaded, total) => `${String(loaded)}/${String(total)}`, state: (count, label) => `${String(count)} ${label}`,
      ghosts: count => `${String(count)} 未加载`, stale: count => `${String(count)} 陈旧`,
    })
    expect(text).toBe('蜂群 · 4/6 · 2 运行中 · 1 空闲 · 1 失败 · 1 未加载 · 1 陈旧')
  })
})

describe('LaneView', () => {
  it('draws lanes with a proxy per item and moves between lanes with arrow keys', () => {
    const layout = layoutLanes({ lanes: [{ id: 'a' }, { id: 'b' }], items: [
      { id: 'a1', lane: 'a', start: 0, end: 80 }, { id: 'b1', lane: 'b', start: 10, end: 60 },
    ], position: value => value })
    render(<LaneView label="泳道" description="两条" layout={layout} width={200}
      lanes={[{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }]}
      items={[{ id: 'a1', label: '任务一', state: 'done', stateLabel: '完成' }, { id: 'b1', label: '任务二', state: 'running', stateLabel: '运行中' }]} />)
    const first = screen.getByRole('button', { name: '任务一 · 完成' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '任务二 · 运行中' }))
  })
})

describe('metric primitives', () => {
  it('rolls odometer digits only for a live change', () => {
    const { container, rerender } = render(<Odometer text="1,234" label="1234 tokens" />)
    const odometer = screen.getByRole('img', { name: '1234 tokens' })
    expect(odometer.dataset.live).toBeUndefined()
    rerender(<Odometer text="1,240" label="1240 tokens" live />)
    expect(screen.getByRole('img', { name: '1240 tokens' }).dataset.motionTier).toBe('L2')
    rerender(<Odometer text="42" />)
    expect(container.textContent).toBe('42')
  })

  it('renders an unavailable sparkline as an empty slot, not a flat line', () => {
    const { container } = render(<Sparkline values={undefined} label="吞吐不可用" />)
    expect(screen.getByRole('img', { name: '吞吐不可用' }).tagName).toBe('SPAN')
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('draws one ring segment per state share', () => {
    const { container } = render(<RadialProgress label="进度" total={10} segments={[
      { state: 'done', value: 5, label: '完成' }, { state: 'running', value: 2, label: '运行中' },
    ]} />)
    expect(container.querySelectorAll('circle[data-state]')).toHaveLength(2)
  })
})

describe('ViewSwitch', () => {
  it('selects options with arrow keys as a radio group', () => {
    const onChange = vi.fn()
    render(<ViewSwitch label="视图" value="graph" onChange={onChange} options={[{ id: 'graph', label: '拓扑' }, { id: 'list', label: '列表' }]} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: '拓扑' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('list')
  })
})

describe('useLiveTransition', () => {
  it('treats hydration and identity changes as settled and cursor advances as live', () => {
    const { result, rerender } = renderHook(({ id, cursor, value }) => useLiveTransition(id, cursor, value),
      { initialProps: { id: 'team-1', cursor: 3, value: 'active' } })
    expect(result.current.live).toBe(false)
    rerender({ id: 'team-1', cursor: 4, value: 'completed' })
    expect(result.current).toMatchObject({ live: true, previous: 'active', generation: 1 })
    rerender({ id: 'team-1', cursor: 4, value: 'completed' })
    expect(result.current.live).toBe(true)
    rerender({ id: 'team-2', cursor: 9, value: 'completed' })
    expect(result.current).toMatchObject({ live: false, generation: 0 })
    act(() => { rerender({ id: 'team-2', cursor: 8, value: 'failed' }) })
    expect(result.current.live).toBe(false)
  })
})
