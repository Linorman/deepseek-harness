/**
 * Layered DAG layout: longest-path layering with barycenter crossing
 * reduction. Bounded windows keep task graphs small, so an O(V·E) sweep is
 * cheaper than shipping a general layout engine.
 */
import { round2, type LayoutEdge, type Point } from './space.ts'

/** Placement of one node in a layered layout. */
export interface LayeredPosition extends Point {
  /** Zero-based layer; upstream nodes sit in lower layers. */
  readonly layer: number
  /** Zero-based order within the layer after crossing reduction. */
  readonly order: number
}

/** Result of {@link layoutLayered}. */
export interface LayeredLayout {
  readonly positions: ReadonlyMap<string, LayeredPosition>
  /** Node ids per layer, in display order. */
  readonly layers: readonly (readonly string[])[]
  /** Edges dropped to break cycles; the renderer may still draw them as back edges. */
  readonly backEdges: readonly LayoutEdge[]
  /** Edges whose endpoints are both laid out. */
  readonly edges: readonly LayoutEdge[]
  readonly width: number
  readonly height: number
}

/** Spacing and sweep settings for {@link layoutLayered}. */
export interface LayeredOptions {
  /** Distance between layers along the flow axis. */
  readonly layerGap?: number
  /** Distance between neighbours inside one layer. */
  readonly nodeGap?: number
  /** Up/down barycenter sweeps. */
  readonly sweeps?: number
  /** `horizontal` flows left to right; `vertical` flows top to bottom. */
  readonly direction?: 'horizontal' | 'vertical'
}

/** Index-based adjacency used internally; node `i` is `ids[i]`. */
interface Graph {
  readonly ids: readonly string[]
  readonly forward: readonly LayoutEdge[]
  readonly back: readonly LayoutEdge[]
  readonly valid: readonly LayoutEdge[]
  readonly predecessors: readonly number[][]
  readonly successors: readonly number[][]
  readonly layerOf: readonly number[]
}

/** Build adjacency, break cycles, and assign longest-path layers. */
function prepare(nodeIds: readonly string[], edges: readonly LayoutEdge[]): Graph {
  const ids = [...new Set(nodeIds)]
  const index = new Map(ids.map((id, position) => [id, position]))
  const valid = edges.filter(edge => index.has(edge.from) && index.has(edge.to) && edge.from !== edge.to)
  const outgoing: LayoutEdge[][] = ids.map(() => [])
  for (const edge of valid) outgoing[index.get(edge.from) ?? 0]?.push(edge)
  const { forward, back } = breakCycles(ids.length, outgoing, index)
  const predecessors: number[][] = ids.map(() => [])
  const successors: number[][] = ids.map(() => [])
  for (const edge of forward) {
    const from = index.get(edge.from) ?? 0, to = index.get(edge.to) ?? 0
    predecessors[to]?.push(from)
    successors[from]?.push(to)
  }
  // Longest path from any source: a node sits one layer below its deepest
  // prerequisite. Kahn order makes every predecessor final before its successors.
  const layerOf = ids.map(() => 0)
  const remaining = predecessors.map(list => list.length)
  const queue = remaining.flatMap((count, node) => count === 0 ? [node] : [])
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] ?? 0
    for (const next of successors[node] ?? []) {
      layerOf[next] = Math.max(layerOf[next] ?? 0, (layerOf[node] ?? 0) + 1)
      remaining[next] = (remaining[next] ?? 1) - 1
      if (remaining[next] === 0) queue.push(next)
    }
  }
  return { ids, forward, back, valid, predecessors, successors, layerOf }
}

/**
 * Lay out a directed graph in layers.
 * @param nodeIds - Nodes in a stable input order; ties keep this order.
 * @param edges - Upstream → downstream edges; edges to unknown ids are ignored.
 * @param options - Spacing, sweep count, and flow direction.
 * @returns positions, layers, the edges removed to break cycles, and the extent.
 */
export function layoutLayered(nodeIds: readonly string[], edges: readonly LayoutEdge[], options: LayeredOptions = {}): LayeredLayout {
  const { layerGap = 180, nodeGap = 72, sweeps = 4, direction = 'horizontal' } = options
  const graph = prepare(nodeIds, edges)
  const { ids, predecessors, successors, layerOf } = graph
  const layerCount = ids.length === 0 ? 0 : Math.max(...layerOf) + 1
  const layers: number[][] = Array.from({ length: layerCount }, () => [])
  ids.forEach((_, node) => { layers[layerOf[node] ?? 0]?.push(node) })

  const orderOf = ids.map(() => 0)
  const renumber = (layer: readonly number[]) => { layer.forEach((node, position) => { orderOf[node] = position }) }
  layers.forEach(renumber)
  const barycenter = (node: number, neighbours: readonly number[]): number => neighbours.length === 0
    ? orderOf[node] ?? 0
    : neighbours.reduce((sum, other) => sum + (orderOf[other] ?? 0), 0) / neighbours.length
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const down = sweep % 2 === 0
    const sequence = down ? layers.slice(1) : layers.slice(0, -1).reverse()
    for (const layer of sequence) {
      const keyed = layer.map(node => ({ node, key: barycenter(node, (down ? predecessors : successors)[node] ?? []) }))
      keyed.sort((a, b) => a.key - b.key || (orderOf[a.node] ?? 0) - (orderOf[b.node] ?? 0) || a.node - b.node)
      layer.splice(0, layer.length, ...keyed.map(entry => entry.node))
      renumber(layer)
    }
  }

  const widest = Math.max(0, ...layers.map(layer => layer.length))
  const positions = new Map<string, LayeredPosition>()
  layers.forEach((layer, layerIndex) => {
    // Center each layer against the widest one so short layers do not hug the edge.
    const offset = (widest - layer.length) * nodeGap / 2
    layer.forEach((node, order) => {
      const along = round2(layerIndex * layerGap)
      const across = round2(offset + order * nodeGap)
      positions.set(ids[node] ?? '', direction === 'horizontal'
        ? { x: along, y: across, layer: layerIndex, order }
        : { x: across, y: along, layer: layerIndex, order })
    })
  })
  const alongExtent = Math.max(0, layerCount - 1) * layerGap
  const acrossExtent = Math.max(0, widest - 1) * nodeGap
  return {
    positions, layers: layers.map(layer => layer.map(node => ids[node] ?? '')), backEdges: graph.back, edges: graph.valid,
    width: direction === 'horizontal' ? alongExtent : acrossExtent,
    height: direction === 'horizontal' ? acrossExtent : alongExtent,
  }
}

/** Split edges into a DAG and the back edges that closed a cycle in DFS order. */
function breakCycles(count: number, outgoing: readonly (readonly LayoutEdge[])[], index: ReadonlyMap<string, number>):
{ forward: LayoutEdge[]; back: LayoutEdge[] } {
  const state: ('new' | 'open' | 'done')[] = Array.from({ length: count }, () => 'new')
  const forward: LayoutEdge[] = []
  const back: LayoutEdge[] = []
  for (let root = 0; root < count; root++) {
    if (state[root] !== 'new') continue
    // Iterative DFS so a long dependency chain cannot exhaust the call stack.
    const stack: { node: number; next: number }[] = [{ node: root, next: 0 }]
    state[root] = 'open'
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const edge = outgoing[frame.node]?.[frame.next]
      if (edge === undefined) { state[frame.node] = 'done'; stack.pop(); continue }
      frame.next++
      const target = index.get(edge.to) ?? 0
      if (state[target] === 'open') back.push(edge)
      else {
        forward.push(edge)
        if (state[target] === 'new') { state[target] = 'open'; stack.push({ node: target, next: 0 }) }
      }
    }
  }
  return { forward, back }
}

/**
 * Count edge crossings between adjacent layers.
 * @param layout - A layered layout.
 * @returns the number of crossing edge pairs.
 */
export function countCrossings(layout: Pick<LayeredLayout, 'positions' | 'edges' | 'backEdges'>): number {
  const back = new Set(layout.backEdges)
  const spans = layout.edges.flatMap((edge) => {
    const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to)
    return back.has(edge) || from === undefined || to === undefined || to.layer !== from.layer + 1 ? [] : [{ from, to }]
  })
  let crossings = 0
  spans.forEach((a, i) => {
    for (const b of spans.slice(i + 1)) {
      if (a.from.layer === b.from.layer && (a.from.order - b.from.order) * (a.to.order - b.to.order) < 0) crossings++
    }
  })
  return crossings
}

/**
 * Longest chain through a DAG, used as the critical path when every node and
 * edge of the graph is loaded.
 * @param nodeIds - Nodes of the graph.
 * @param edges - Upstream → downstream edges.
 * @param weight - Per-node weight; defaults to 1 so the path counts nodes.
 * @returns node ids from the first to the last node of the heaviest chain.
 */
export function longestChain(nodeIds: readonly string[], edges: readonly LayoutEdge[], weight: (id: string) => number = () => 1): string[] {
  const { ids, predecessors, layerOf } = prepare(nodeIds, edges)
  const order = ids.map((_, node) => node).sort((a, b) => (layerOf[a] ?? 0) - (layerOf[b] ?? 0) || a - b)
  const total = ids.map(() => 0)
  const previous: (number | undefined)[] = ids.map(() => undefined)
  for (const node of order) {
    let best = 0
    for (const parent of predecessors[node] ?? []) {
      if ((total[parent] ?? 0) > best) { best = total[parent] ?? 0; previous[node] = parent }
    }
    total[node] = best + weight(ids[node] ?? '')
  }
  let tail: number | undefined
  for (const node of order) if (tail === undefined || (total[node] ?? 0) > (total[tail] ?? 0)) tail = node
  const chain: string[] = []
  for (let node = tail; node !== undefined; node = previous[node]) chain.unshift(ids[node] ?? '')
  return chain
}
