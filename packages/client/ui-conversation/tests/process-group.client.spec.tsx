// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { ProcessGroup } from '../src/client/chat/ProcessGroup.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function session(nodes: Record<string, unknown>) {
  const snapshot = { chat: { nodes: new Map(Object.entries(nodes)) } }
  return ((selector: (value: typeof snapshot) => unknown) => selector(snapshot)) as never
}

const settledTool = (name: string, start: number, end: number, isError = false) => ({
  kind: 'tool-call',
  data: { root: { kind: 'tool-result', seq: 1, time: end, callId: name, call: { name, argsRaw: '{}' }, callTime: start, content: [], isError } },
})
const runningTool = (name: string, start: number) => ({
  kind: 'tool-call', data: { root: { callId: name, name, argsRaw: '{}', turn: 1, step: 1, time: start, callView: null, children: [] } },
})

function mount(nodes: Record<string, unknown>, defaultOpen = false) {
  return render(<ProcessGroup keys={Object.keys(nodes)} defaultOpen={defaultOpen} useSession={session(nodes)}
    renderNode={key => <div key={key} data-testid="row">{key}</div>} t={makeTranslate(en) as never} />)
}

describe('ProcessGroup', () => {
  it('folds settled work behind a duration and step count', () => {
    mount({ a: settledTool('read', 0, 2_000), b: settledTool('write', 2_000, 12_000) })
    const header = screen.getByRole('button', { name: /Worked for 12s · 2 steps/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByTestId('row')).toHaveLength(0)
    fireEvent.click(header)
    expect(screen.getAllByTestId('row')).toHaveLength(2)
  })

  it('names the current tool while running', () => {
    mount({ a: settledTool('read', Date.now() - 1000, Date.now()), b: runningTool('bash', Date.now()) }, true)
    expect(screen.getByRole('button', { name: /Running bash/ })).toBeDefined()
    expect(screen.getAllByTestId('row')).toHaveLength(2)
  })

  it('keeps a group with a failed step open and marks it failed', () => {
    const view = mount({ a: settledTool('read', 0, 1_000, true), b: settledTool('write', 1_000, 2_000) })
    const header = screen.getByRole('button', { name: /Worked for/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-failed]')).not.toBeNull()
    expect(screen.getAllByTestId('row')).toHaveLength(2)
  })
})
