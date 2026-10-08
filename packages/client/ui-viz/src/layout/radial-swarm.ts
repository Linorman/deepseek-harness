/**
 * Radial swarm layout: one center node, rings of members around it, and
 * clusters for grouped nodes, settled by a seeded d3-force simulation.
 * Previously settled positions stay pinned, so a new node joining the swarm
 * moves nothing that the user has already located.
 */
import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { seededRandom, hashSeed } from './random.ts'
import { round2, type Point } from './space.ts'

/** One node of the swarm. */
export interface SwarmNodeInput {
  readonly id: string
  /** Ring index: 0 is the center, larger rings sit further out. */
  readonly ring: number
  /** Optional cluster key; nodes sharing it gather around one anchor on their ring. */
  readonly cluster?: string | undefined
}

/** One undirected attraction between two swarm nodes. */
export interface SwarmLinkInput {
  readonly source: string
  readonly target: string
}

/** Inputs to {@link layoutRadialSwarm}. */
export interface SwarmLayoutInput {
  readonly nodes: readonly SwarmNodeInput[]
  readonly links?: readonly SwarmLinkInput[]
  /** Seed text, normally the Team or run id. */
  readonly seed: string
  /** Settled positions from an earlier layout; matching nodes stay fixed. */
  readonly previous?: ReadonlyMap<string, Point> | undefined
  /** Distance between consecutive rings. */
  readonly ringGap?: number
  /** Minimum distance between node centers. */
  readonly nodeSpacing?: number
  /** Upper bound on simulation ticks. */
  readonly maxTicks?: number
}

/** Result of {@link layoutRadialSwarm}. */
export interface SwarmLayout {
  readonly positions: ReadonlyMap<string, Point>
  /** Cluster anchors, for drawing cluster hulls and labels. */
  readonly clusters: ReadonlyMap<string, Point & { readonly radius: number }>
  /** Ticks run before the simulation settled or hit `maxTicks`. */
  readonly ticks: number
}

interface SimNode extends SimulationNodeDatum {
  id: string
  ring: number
  cluster: string | undefined
}

/**
 * Place a swarm around its center.
 * @param input - Nodes, links, seed, and previously settled positions.
 * @returns deterministic positions rounded to two decimals.
 */
export function layoutRadialSwarm(input: SwarmLayoutInput): SwarmLayout {
  const { seed, previous, ringGap = 120, nodeSpacing = 56, maxTicks = 300 } = input
  const random = seededRandom(seed)
  const nodes = [...new Map(input.nodes.map(node => [node.id, node])).values()]
  // Cluster anchors spread evenly around the outermost cluster ring; the angle
  // offset comes from the seed so two swarms do not look identical.
  const clusterKeys = [...new Set(nodes.flatMap(node => node.cluster === undefined ? [] : [node.cluster]))].sort()
  const clusterRing = new Map<string, number>()
  for (const node of nodes) {
    if (node.cluster !== undefined) clusterRing.set(node.cluster, Math.max(clusterRing.get(node.cluster) ?? 0, node.ring))
  }
  const phase = (hashSeed(`${seed}:phase`) % 360) * Math.PI / 180
  const anchors = new Map<string, Point & { radius: number }>()
  clusterKeys.forEach((key, position) => {
    const angle = phase + position / Math.max(1, clusterKeys.length) * Math.PI * 2
    const radius = (clusterRing.get(key) ?? 1) * ringGap
    const members = nodes.filter(node => node.cluster === key).length
    const hull = Math.max(nodeSpacing, Math.sqrt(members) * nodeSpacing * 0.7)
    anchors.set(key, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, radius: hull })
  })

  const ringCounts = new Map<number, number>()
  const simNodes: SimNode[] = nodes.map((node) => {
    const pinned = previous?.get(node.id)
    const sim: SimNode = { id: node.id, ring: node.ring, cluster: node.cluster }
    if (pinned !== undefined) {
      sim.x = pinned.x; sim.y = pinned.y; sim.fx = pinned.x; sim.fy = pinned.y
    } else if (node.ring === 0) {
      sim.x = 0; sim.y = 0; sim.fx = 0; sim.fy = 0
    } else {
      // Start new nodes on their ring (or near their cluster anchor) so the
      // simulation only has to resolve overlaps, never travel across the canvas.
      const anchor = node.cluster === undefined ? undefined : anchors.get(node.cluster)
      const seen = ringCounts.get(node.ring) ?? 0
      ringCounts.set(node.ring, seen + 1)
      const angle = phase + seen * 2.399963 + random() * 0.2
      const radius = anchor === undefined ? node.ring * ringGap : nodeSpacing * 0.6
      sim.x = (anchor?.x ?? 0) + Math.cos(angle) * radius
      sim.y = (anchor?.y ?? 0) + Math.sin(angle) * radius
    }
    return sim
  })
  const ids = new Set(simNodes.map(node => node.id))
  const links: SimulationLinkDatum<SimNode>[] = (input.links ?? [])
    .filter(link => ids.has(link.source) && ids.has(link.target) && link.source !== link.target)
    .map(link => ({ source: link.source, target: link.target }))

  const simulation = forceSimulation(simNodes)
    .randomSource(random)
    .force('charge', forceManyBody<SimNode>().strength(-nodeSpacing * 1.6).distanceMax(ringGap * 3))
    .force('collide', forceCollide<SimNode>(nodeSpacing / 2).strength(1))
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id(node => node.id).strength(0.05))
    .force('radial', forceRadial<SimNode>(node => node.cluster === undefined ? node.ring * ringGap : 0)
      .strength(node => node.cluster === undefined ? 0.9 : 0))
    .force('clusterX', forceX<SimNode>(node => node.cluster === undefined ? 0 : anchors.get(node.cluster)?.x ?? 0)
      .strength(node => node.cluster === undefined ? 0 : 0.35))
    .force('clusterY', forceY<SimNode>(node => node.cluster === undefined ? 0 : anchors.get(node.cluster)?.y ?? 0)
      .strength(node => node.cluster === undefined ? 0 : 0.35))
    .stop()
  let ticks = 0
  // Settled means alpha has cooled below d3's own threshold; stop there.
  while (ticks < maxTicks && simulation.alpha() > simulation.alphaMin()) { simulation.tick(); ticks++ }

  const positions = new Map<string, Point>()
  for (const node of simNodes) positions.set(node.id, { x: round2(node.x ?? 0), y: round2(node.y ?? 0) })
  const clusters = new Map<string, Point & { radius: number }>()
  for (const [key, anchor] of anchors) {
    // Report the hull around where the members actually settled.
    const members = simNodes.filter(node => node.cluster === key)
    const cx = members.reduce((sum, node) => sum + (node.x ?? 0), 0) / members.length
    const cy = members.reduce((sum, node) => sum + (node.y ?? 0), 0) / members.length
    const radius = Math.max(anchor.radius, ...members.map(node => Math.hypot((node.x ?? 0) - cx, (node.y ?? 0) - cy) + nodeSpacing / 2))
    clusters.set(key, { x: round2(cx), y: round2(cy), radius: round2(radius) })
  }
  return { positions, clusters, ticks }
}
