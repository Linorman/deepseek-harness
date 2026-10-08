/** Layout functions are pure, deterministic, and stable under incremental input. */
import { describe, expect, it } from 'vitest'
import {
  countCrossings, decimalTimeScale, decimalToFixed, hitTest, layoutLanes, layoutLayered, layoutRadialSwarm,
  longestChain, nextSpatialFocus, readingOrder,
} from '../src/index.ts'

const serialize = (map: ReadonlyMap<string, unknown>) => JSON.stringify([...map.entries()])

describe('layoutLayered', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f']
  const edges = [{ from: 'a', to: 'd' }, { from: 'b', to: 'e' }, { from: 'c', to: 'f' }, { from: 'a', to: 'f' }, { from: 'c', to: 'd' }]

  it('produces byte-identical coordinates for identical input', () => {
    expect(serialize(layoutLayered(nodes, edges).positions)).toBe(serialize(layoutLayered([...nodes], [...edges]).positions))
  })

  it('places every node one layer below its deepest prerequisite', () => {
    const layout = layoutLayered(['x', 'y', 'z', 'w'], [{ from: 'x', to: 'y' }, { from: 'y', to: 'z' }, { from: 'x', to: 'z' }, { from: 'w', to: 'z' }])
    expect(layout.positions.get('x')?.layer).toBe(0)
    expect(layout.positions.get('y')?.layer).toBe(1)
    expect(layout.positions.get('z')?.layer).toBe(2)
    expect(layout.positions.get('w')?.layer).toBe(0)
  })

  it('reduces crossings below the input order', () => {
    // Input order crosses every edge pair between the two layers.
    const crossed = layoutLayered(['a', 'b', 'c', 'x', 'y', 'z'], [{ from: 'a', to: 'z' }, { from: 'b', to: 'y' }, { from: 'c', to: 'x' }], { sweeps: 0 })
    const reduced = layoutLayered(['a', 'b', 'c', 'x', 'y', 'z'], [{ from: 'a', to: 'z' }, { from: 'b', to: 'y' }, { from: 'c', to: 'x' }])
    expect(countCrossings(crossed)).toBe(3)
    expect(countCrossings(reduced)).toBe(0)
  })

  it('breaks cycles into reported back edges instead of looping', () => {
    const layout = layoutLayered(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }])
    expect(layout.backEdges).toEqual([{ from: 'c', to: 'a' }])
    expect(layout.positions.size).toBe(3)
  })

  it('ignores edges to unknown or identical ids', () => {
    const layout = layoutLayered(['a'], [{ from: 'a', to: 'ghost' }, { from: 'a', to: 'a' }])
    expect(layout.edges).toEqual([])
  })

  it('finds the heaviest chain as the critical path', () => {
    expect(longestChain(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }])).toEqual(['a', 'b', 'd'])
  })
})

describe('layoutRadialSwarm', () => {
  const nodes = [
    { id: 'coordinator', ring: 0 },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `worker-${String(index)}`, ring: 1 })),
    { id: 'reviewer', ring: 2 },
    { id: 'child-a', ring: 3, cluster: 'team-child' },
    { id: 'child-b', ring: 3, cluster: 'team-child' },
  ]
  const links = nodes.slice(1).map(node => ({ source: 'coordinator', target: node.id }))

  it('is deterministic for a seed and different across seeds', () => {
    const first = layoutRadialSwarm({ nodes, links, seed: 'team-1' })
    expect(serialize(layoutRadialSwarm({ nodes, links, seed: 'team-1' }).positions)).toBe(serialize(first.positions))
    expect(serialize(layoutRadialSwarm({ nodes, links, seed: 'team-2' }).positions)).not.toBe(serialize(first.positions))
  })

  it('keeps the center node at the origin and stops once settled', () => {
    const layout = layoutRadialSwarm({ nodes, links, seed: 'team-1', maxTicks: 1000 })
    expect(layout.positions.get('coordinator')).toEqual({ x: 0, y: 0 })
    expect(layout.ticks).toBeLessThan(1000)
    expect(layout.clusters.get('team-child')?.radius).toBeGreaterThan(0)
  })

  it('does not move settled nodes when a new node joins', () => {
    const before = layoutRadialSwarm({ nodes, links, seed: 'team-1' })
    const after = layoutRadialSwarm({ nodes: [...nodes, { id: 'worker-new', ring: 1 }], links, seed: 'team-1', previous: before.positions })
    let maxShift = 0
    for (const [id, point] of before.positions) {
      const moved = after.positions.get(id)!
      maxShift = Math.max(maxShift, Math.hypot(moved.x - point.x, moved.y - point.y))
    }
    expect(maxShift).toBeLessThanOrEqual(0.5)
    expect(after.positions.has('worker-new')).toBe(true)
  })
})

describe('layoutLanes', () => {
  it('stacks overlapping items into rows inside one lane', () => {
    const layout = layoutLanes({
      lanes: [{ id: 'a' }, { id: 'b' }],
      items: [
        { id: '1', lane: 'a', start: 0, end: 50 },
        { id: '2', lane: 'a', start: 20, end: 60 },
        { id: '3', lane: 'a', start: 70, end: 90 },
        { id: '4', lane: 'b', start: 0 },
        { id: 'lost', lane: 'missing', start: 0 },
      ],
      position: value => value,
    })
    expect(layout.items.get('1')?.row).toBe(0)
    expect(layout.items.get('2')?.row).toBe(1)
    expect(layout.items.get('3')?.row).toBe(0)
    expect(layout.lanes.get('a')?.rows).toBe(2)
    expect(layout.items.get('4')?.y).toBeGreaterThan(layout.items.get('2')!.y)
    expect(layout.items.has('lost')).toBe(false)
  })

  it('positions decimal times beyond 2^53 exactly', () => {
    const origin = '9007199254740993'
    const scale = decimalTimeScale(origin, '9007199254741993', 1000)
    // Number('9007199254740993') rounds to ...992, which would misplace both points.
    expect(scale('9007199254740994')).toBe(1)
    expect(scale('9007199254741493.5')).toBe(500.5)
    expect(decimalToFixed('12.5')).toBe(12_500_000n)
    expect(() => decimalToFixed('1e3')).toThrow(RangeError)
  })
})

describe('spatial interaction', () => {
  const grid = [
    { id: 'tl', x: 0, y: 0 }, { id: 'tr', x: 100, y: 0 },
    { id: 'bl', x: 0, y: 100 }, { id: 'br', x: 100, y: 100 },
  ]

  it('moves along rows and columns', () => {
    expect(nextSpatialFocus(grid, 'tl', 'right')).toBe('tr')
    expect(nextSpatialFocus(grid, 'tl', 'down')).toBe('bl')
    expect(nextSpatialFocus(grid, 'br', 'up')).toBe('tr')
    expect(nextSpatialFocus(grid, 'tl', 'left')).toBeUndefined()
  })

  it('orders marks for reading and hits the closest covering mark', () => {
    expect(readingOrder(grid)).toEqual(['tl', 'tr', 'bl', 'br'])
    expect(hitTest(grid, { x: 104, y: 98 })).toBe('br')
    expect(hitTest(grid, { x: 50, y: 50 })).toBeUndefined()
  })
})
