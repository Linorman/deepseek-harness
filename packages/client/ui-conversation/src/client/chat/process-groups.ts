/**
 * Fold consecutive process rows (tool calls, context injections, and
 * assistant steps that carry only reasoning or tool calls) into groups, so a
 * turn reads as its answers with the work behind them on demand.
 */

import type { AssistantChatData, ToolChatData } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

/** One rendered entry in the chat flow. */
export type FlowEntry =
  | { readonly type: 'node'; readonly key: string }
  | { readonly type: 'group'; readonly key: string; readonly keys: readonly string[] }

/** Smallest run that becomes a group; a lone tool call stays a plain row. */
export const MIN_GROUP_SIZE = 2

/** Minimal node view the classifier reads. */
interface NodeLike {
  readonly kind: string
  readonly data: unknown
}

/**
 * Whether a node is process detail rather than an answer or a person's turn.
 * @param node - chat node.
 * @returns true for tool calls, context injections, and text-free assistant steps.
 */
export function isProcessNode(node: NodeLike | undefined): boolean {
  if (node === undefined) return false
  if (node.kind === 'tool-call' || node.kind === 'context') return true
  if (node.kind !== 'assistant-step') return false
  const blocks = (node.data as AssistantChatData).blocks
  return blocks.length > 0 && blocks.every(block => block.kind === 'reasoning' || block.kind === 'tool-call')
}

/**
 * Group runs of process nodes; everything else passes through in order.
 * @param order - node keys in flow order.
 * @param process - per-key process flags, aligned with `order`.
 * @returns flow entries; a group's key is its first node key.
 */
export function groupFlow(order: readonly string[], process: readonly boolean[]): FlowEntry[] {
  const out: FlowEntry[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length >= MIN_GROUP_SIZE) out.push({ type: 'group', key: `group:${run[0]}`, keys: run })
    else for (const key of run) out.push({ type: 'node', key })
    run = []
  }
  order.forEach((key, index) => {
    if (process[index] === true) run.push(key)
    else { flush(); out.push({ type: 'node', key }) }
  })
  flush()
  return out
}

/** Live summary of one group. */
export interface GroupSummary {
  readonly steps: number
  readonly startTime: number | undefined
  readonly endTime: number | undefined
  readonly running: boolean
  readonly failed: boolean
  /** Name of the latest tool call, or undefined when the latest step is reasoning or context. */
  readonly currentTool: string | undefined
}

/**
 * Summarize the nodes of one group.
 * @param nodes - group nodes in order (missing nodes are skipped).
 * @returns step count, time span, and running/failed state.
 */
export function summarizeGroup(nodes: readonly (NodeLike & { readonly data: unknown })[]): GroupSummary {
  let startTime: number | undefined
  let endTime: number | undefined
  let running = false
  let failed = false
  let currentTool: string | undefined
  for (const node of nodes) {
    if (node.kind === 'tool-call') {
      const root = (node.data as ToolChatData).root
      const begin = isRunningTool(root) ? root.time : root.callTime ?? root.time
      startTime = startTime === undefined ? begin : Math.min(startTime, begin)
      if (isRunningTool(root)) { running = true; currentTool = root.name }
      else {
        endTime = endTime === undefined ? root.time : Math.max(endTime, root.time)
        if (root.isError) failed = true
        currentTool = root.call?.name
      }
    } else if (node.kind === 'assistant-step') {
      const data = node.data as AssistantChatData
      startTime = startTime === undefined ? data.time : Math.min(startTime, data.time)
      endTime = endTime === undefined ? data.time : Math.max(endTime, data.time)
      if (data.status === 'running') running = true
      currentTool = undefined
    } else {
      const time = (node.data as { readonly time?: unknown }).time
      if (typeof time === 'number') {
        startTime = startTime === undefined ? time : Math.min(startTime, time)
        endTime = endTime === undefined ? time : Math.max(endTime, time)
      }
      currentTool = undefined
    }
  }
  return { steps: nodes.length, startTime, endTime, running, failed, currentTool }
}
