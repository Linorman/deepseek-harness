// @vitest-environment jsdom
/** Trajectory ledger selection, details, status, and fold behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TrajectoryTable } from '../src/client/TrajectoryTable.tsx'
import { tEn, tZh } from './locales.client.ts'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

const TURNS: readonly TrajectoryTurnModel[] = [{
  turn: 1,
  groups: [{
    title: 'Step 1',
    description: '1.5s bash×2',
    cells: [
      {
        index: 1,
        kind: 'message',
        text: 'Checking files',
        outputDetail: 'Checking files',
        input: 10,
        output: 20,
        think: 5,
        timeSeconds: 1.5,
        assistantMetrics: {
          timingRecorded: true,
          stepStartTime: 1_000,
          firstTokenTime: 1_500,
          completedTime: 2_500,
          usageProvided: true,
          outputTokens: 20,
        },
      },
      {
        index: 2,
        kind: 'tool',
        text: 'bash · {"command":"pwd"}',
        inputDetail: '{"command":"pwd"}',
        timeSeconds: null,
      },
      {
        index: 3,
        kind: 'tool',
        text: 'bash · {"command":"false"}',
        inputDetail: '{"command":"false"}',
        outputDetail: 'ToolError: non_zero_exit',
        result: 'non_zero_exit',
        isError: true,
        timeSeconds: 0.2,
      },
    ],
  }],
}]

const FOLD_PROPS = {
  t: tZh,
  collapsedTurns: new Set<number>(),
  onToggleTurn: () => {},
  collapsedAssistants: new Set<string>(),
  onToggleAssistant: () => {},
}

describe('TrajectoryTable', () => {
  it.each([
    { t: tZh, row: '请求 1，助手，Checking files', details: '事件详情', preview: '预览' },
    { t: tEn, row: 'Request 1, Assistant, Checking files', details: 'Event details', preview: 'Preview' },
  ])('localizes request row names and inspector tabs: $details', ({ t, row, details, preview }) => {
    render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} t={t} />)
    fireEvent.keyDown(screen.getByRole('row', { name: row }), { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: details })).toBeTruthy()
    expect(screen.getByRole('tab', { name: preview })).toBeTruthy()
  })

  it('updates the selected row and folded summaries when the locale seat changes', () => {
    const props = { ...FOLD_PROPS, collapsedAssistants: new Set(['message\u0000index\u00001']) }
    const view = render(<TrajectoryTable turns={TURNS} {...props} />)
    fireEvent.click(screen.getByRole('row', { name: '请求 1，助手，Checking files' }))
    expect(screen.getByRole('row', { name: '已折叠助手概述，2 次工具调用 · bash' })).toBeTruthy()

    view.rerender(<TrajectoryTable turns={TURNS} {...props} t={tEn} />)
    expect(screen.getByRole('row', { name: 'Request 1, Assistant, Checking files' })
      .getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('row', { name: 'Collapsed assistant summary, 2 tool calls · bash' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Event details' })).toBeTruthy()
  })

  it.each([
    { t: tZh, kinds: ['系统', '用户', '上下文', '已压缩', '助手', '工具', '子工具'], empty: '无内容' },
    { t: tEn, kinds: ['System', 'User', 'Context', 'Compacted', 'Assistant', 'Tool', 'Subtool'], empty: 'no content' },
  ])('names every empty record kind in the active locale: $empty', ({ t, kinds, empty }) => {
    const cells = (['system', 'user', 'context', 'compacted', 'message', 'tool', 'subtool'] as const)
      .map((kind, index) => ({ index: index + 1, kind, text: '', timeSeconds: 0 }))
    render(<TrajectoryTable turns={[{ turn: 1, groups: [{ title: 'Prelude', cells }] }]}
      {...FOLD_PROPS} t={t} />)
    for (const kind of kinds) {
      expect(screen.getByRole('row', { name: `${kind}${empty === '无内容' ? '，' : ', '}${empty}` }))
        .toBeTruthy()
    }
  })

  it('shows a muted placeholder for an assistant response containing only tool calls', () => {
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'message',
          text: 'Tool call only',
          sourceBlocks: [{
            type: 'tool-call', content: '{}', callId: 'call-1', toolName: 'read',
          }],
          timeSeconds: 1,
        }],
      }],
    }]

    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    expect(screen.getByText('（仅工具调用）')).toBeTruthy()
  })

  it('shows assistant timing facts after keyboard selection', () => {
    render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    fireEvent.keyDown(screen.getByRole('row', { name: /助手/ }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '请求计时' }))

    expect(screen.getByText('500 ms')).toBeTruthy()
    expect(screen.getByText('1.00 s')).toBeTruthy()
    expect(screen.getByText('20.0 tok/s')).toBeTruthy()
  })

  it('shows a tool record Duration as exact milliseconds', () => {
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'tool',
          text: 'bash · {"command":"pwd"}',
          inputDetail: '{"command":"pwd"}',
          timeSeconds: 1.5,
        }],
      }],
    }]

    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)
    fireEvent.click(screen.getByRole('row', { name: /工具/ }))

    expect(screen.getByText('1,500 ms', { selector: 'dd' })).toBeTruthy()
  })

  it('breaks output tokens into labeled reasoning and content rows', () => {
    render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    fireEvent.click(screen.getByRole('row', { name: /助手/ }))

    expect(screen.getByText('token 数')).toBeTruthy()
    expect(screen.getByText('20 tok')).toBeTruthy()
    expect(screen.getByText('推理')).toBeTruthy()
    expect(screen.getByText('5 tok')).toBeTruthy()
    expect(screen.getByText('内容')).toBeTruthy()
    expect(screen.getByText('15 tok')).toBeTruthy()
  })

  it('marks Summary scroll regions for interaction-only scrollbar thumbs', () => {
    render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    fireEvent.click(screen.getByRole('row', { name: /助手/ }))

    const panel = screen.getByRole('tabpanel')
    expect(panel.querySelectorAll('[data-summary-scroll-region]').length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('tab', { name: '预览' }))
    expect(panel.querySelector('[data-summary-scroll-region]')).toBeNull()
  })

  it('keeps long thinking collapsed until the user asks to render it', () => {
    const thinking = 'private chain '.repeat(1_000)
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'message',
          text: 'private chain…',
          thinkingDetail: thinking,
          timeSeconds: 1,
        }],
      }],
    }]
    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    fireEvent.click(screen.getByRole('row', { name: /助手/ }))
    const toggle = screen.getByRole('button', { name: '思考' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(thinking)).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '思考' })).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.parentElement?.textContent?.length).toBeGreaterThan(thinking.length)
  })

  it('keeps raw HTML tags in a Markdown-derived context preview', () => {
    const html = [
      '<background-job-complete id="trajectory-ui-watch">',
      'Command: pnpm test',
      'Exit code: 0',
      '</background-job-complete>',
    ].join('\n')
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Message',
        cells: [{
          index: 1,
          kind: 'context',
          text: '',
          inputDetail: html,
          timeSeconds: 0,
        }],
      }],
    }]

    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    expect(screen.getByText(
      '<background-job-complete id="trajectory-ui-watch"> Command: pnpm test Exit code: 0 </background-job-complete>',
    )).toBeTruthy()
  })

  it('clears the selected row when ledger whitespace is clicked', () => {
    const onClearSelection = vi.fn()
    render(
      <TrajectoryTable
        turns={TURNS}
        {...FOLD_PROPS}
        onClearSelection={onClearSelection}
      />,
    )
    const row = screen.getByRole('row', { name: /助手/ })
    fireEvent.click(row)

    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('complementary', { name: '事件详情' })).toBeTruthy()

    const tablePane = screen.getByRole('table').parentElement
    expect(tablePane).not.toBeNull()
    fireEvent.click(tablePane as HTMLElement)

    expect(row.getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('complementary', { name: '事件详情' })).toBeNull()
    expect(onClearSelection).toHaveBeenCalledOnce()
  })

  it('keeps the selected record when older rows shift projection indexes', () => {
    const tail = (index: number): TrajectoryTurnModel => ({
      turn: 2,
      groups: [{
        title: 'Step 1',
        cells: [{
          index,
          kind: 'message',
          sourceSeq: 100,
          text: 'selected tail response',
          outputDetail: 'selected tail response detail',
          timeSeconds: 1,
        }],
      }],
    })
    const view = render(
      <TrajectoryTable turns={[tail(1)]} {...FOLD_PROPS} />,
    )
    fireEvent.click(screen.getByRole('row', { name: /selected tail response/ }))

    view.rerender(
      <TrajectoryTable
        turns={[{
          turn: 1,
          groups: [{
            title: 'Message',
            cells: [{
              index: 1,
              kind: 'user',
              sourceSeq: 1,
              text: 'older prompt',
              timeSeconds: 0,
            }],
          }],
        }, tail(2)]}
        {...FOLD_PROPS}
      />,
    )

    expect(screen.getByRole('row', { name: /selected tail response/ })
      .getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('selected tail response detail')).toBeTruthy()
  })

  it('keeps a selected request when prepending changes its display number', () => {
    const tail = (index: number): TrajectoryTurnModel => ({
      turn: 2,
      groups: [{
        title: 'Step 1',
        cells: [{
          index,
          kind: 'message',
          sourceSeq: 100,
          text: 'tail response',
          timeSeconds: 1,
        }],
      }],
    })
    const view = render(
      <TrajectoryTable turns={[tail(1)]} {...FOLD_PROPS} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '请求 #1' }))

    view.rerender(
      <TrajectoryTable
        turns={[{
          turn: 1,
          groups: [{
            title: 'Step 1',
            cells: [{
              index: 1,
              kind: 'message',
              sourceSeq: 1,
              text: 'older response',
              timeSeconds: 1,
            }],
          }],
        }, tail(2)]}
        {...FOLD_PROPS}
      />,
    )

    expect(screen.getByRole('button', { name: '请求 #2' })
      .getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('请求 #2')).toBeTruthy()
  })

  it('places the request boundary after leading steering input', () => {
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Step 2',
        cells: [{
          index: 1,
          kind: 'user',
          sourceSeq: 3,
          text: 'change direction',
          timeSeconds: 0,
        }, {
          index: 2,
          kind: 'message',
          sourceSeq: 4,
          text: 'continued',
          timeSeconds: 1,
        }],
      }],
    }]

    render(<TrajectoryTable
      turns={turns}
      requestNumbers={[{
        seq: 2,
        turn: 1,
        step: 2,
        group: 'Step 2',
        number: 1,
      }]}
      {...FOLD_PROPS}
    />)

    const request = screen.getByRole('button', { name: '请求 #1' })
    expect(request.closest('tr')?.getAttribute('aria-label')).toContain('助手')
  })

  it('follows appended records only while the ledger is already at the bottom', () => {
    const view = render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    const tablePane = screen.getByRole('table').parentElement as HTMLElement
    let scrollHeight = 200
    Object.defineProperties(tablePane, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    })
    tablePane.scrollTop = 100
    fireEvent.scroll(tablePane)

    scrollHeight = 260
    view.rerender(
      <TrajectoryTable
        turns={[...TURNS, {
          turn: 2,
          groups: [{
            title: 'Step 1',
            cells: [{ index: 4, kind: 'message', text: 'new reply', timeSeconds: 0.1 }],
          }],
        }]}
        {...FOLD_PROPS}
      />,
    )
    expect(tablePane.scrollTop).toBe(260)

    tablePane.scrollTop = 20
    fireEvent.scroll(tablePane)
    scrollHeight = 320
    view.rerender(
      <TrajectoryTable
        turns={[...TURNS, {
          turn: 2,
          groups: [{
            title: 'Step 1',
            cells: [
              { index: 4, kind: 'message', text: 'new reply', timeSeconds: 0.1 },
              { index: 5, kind: 'tool', text: 'new tool', timeSeconds: 0.1 },
            ],
          }],
        }]}
        {...FOLD_PROPS}
      />,
    )
    expect(tablePane.scrollTop).toBe(20)
  })

  it('preserves the visible anchor when the last older page disables virtualization', async () => {
    let resolveOlder: ((advanced: boolean) => void) | undefined
    const older = new Promise<boolean>((resolve) => { resolveOlder = resolve })
    const onLoadOlder = vi.fn(() => older)
    const view = render(
      <TrajectoryTable
        turns={TURNS}
        {...FOLD_PROPS}
        historyStartSeq={1}
        hasOlderRecords
        onLoadOlder={onLoadOlder}
      />,
    )
    const tablePane = screen.getByRole('table').parentElement as HTMLElement
    let scrollHeight = 200
    Object.defineProperties(tablePane, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    })
    tablePane.scrollTop = 0
    fireEvent.scroll(tablePane)
    fireEvent.scroll(tablePane)

    await waitFor(() => { expect(onLoadOlder).toHaveBeenCalledOnce() })
    expect(screen.getByRole('status').textContent).toContain('正在加载更早历史…')
    resolveOlder?.(true)
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('')
    })
    scrollHeight = 260
    view.rerender(
      <TrajectoryTable
        turns={[{
          turn: 0,
          groups: [{
            title: 'Step 1',
            cells: [{ index: 0, kind: 'user', text: 'older prompt', timeSeconds: 0 }],
          }],
        }, ...TURNS]}
        {...FOLD_PROPS}
        historyStartSeq={0}
        onLoadOlder={onLoadOlder}
      />,
    )

    expect(tablePane.scrollTop).toBe(60)
  })

  it('keeps an idle older-history control as the first row until paging completes', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    let resolveOlder: ((advanced: boolean) => void) | undefined
    const older = new Promise<boolean>((resolve) => { resolveOlder = resolve })
    const onLoadOlder = vi.fn(() => older)
    const view = render(
      <TrajectoryTable
        turns={TURNS}
        {...FOLD_PROPS}
        hasOlderRecords
        onLoadOlder={onLoadOlder}
      />,
    )

    const table = screen.getByRole('table')
    const loadButton = screen.getByRole('button', { name: '加载更早历史' })
    const loadRow = table.querySelector('tbody > tr:first-child')
    expect(loadRow?.contains(loadButton)).toBe(true)
    expect(loadRow?.getAttribute('aria-rowindex')).toBe('1')
    expect(screen.getByRole('status').textContent).toBe('')
    expect(table.getAttribute('aria-rowcount')).toBe('4')
    expect((await screen.findByRole('row', { name: /助手/ })).getAttribute('aria-rowindex'))
      .toBe('2')

    fireEvent.click(loadButton)
    expect(onLoadOlder).toHaveBeenCalledOnce()
    expect(loadButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('正在加载更早历史…')

    resolveOlder?.(false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '加载更早历史' })
        .hasAttribute('disabled')).toBe(false)
    })

    view.rerender(
      <TrajectoryTable turns={TURNS} {...FOLD_PROPS} />,
    )
    expect(screen.queryByRole('button', { name: '加载更早历史' })).toBeNull()
    expect(table.getAttribute('aria-rowcount')).toBe('3')
  })

  it('reflects an older page started outside the ledger in the persistent control', () => {
    render(
      <TrajectoryTable
        turns={TURNS}
        {...FOLD_PROPS}
        hasOlderRecords
        olderHistoryLoading
        onLoadOlder={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByRole('button', { name: '正在加载更早历史…' })
      .hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('正在加载更早历史…')
  })

  it('covers the ledger while the initial tail is loading', () => {
    const view = render(
      <TrajectoryTable turns={TURNS} {...FOLD_PROPS} historyLoading />,
    )

    expect(screen.getByRole('status').textContent).toContain('正在加载轨迹…')
    expect(screen.getByRole('table').getAttribute('data-scroll-ready')).toBeNull()

    view.rerender(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('table').getAttribute('data-scroll-ready')).toBe('true')
  })

  it('keeps a paged tail virtualized before its loaded window crosses the row threshold', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    const view = render(
      <TrajectoryTable turns={TURNS} {...FOLD_PROPS} hasOlderRecords />,
    )

    await waitFor(() => {
      expect(view.container.querySelector('tr[data-virtual-position]')).toBeTruthy()
    })
  })

  it('mounts only the visible window for a long ledger', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    const cells = Array.from({ length: 500 }, (_, index) => ({
      index: index + 1,
      kind: 'context' as const,
      text: `Context ${index + 1}`,
      timeSeconds: 0,
    }))
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{ title: '上下文', cells }],
    }]
    const view = render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    await waitFor(() => {
      expect(view.container.querySelectorAll('tr[data-virtual-position]').length)
        .toBeGreaterThan(0)
    })
    expect(view.container.querySelectorAll('tr[data-virtual-position]').length)
      .toBeLessThan(cells.length)
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('500')
    expect(view.container.querySelector('tr[data-trajectory-row-key]')
      ?.getAttribute('aria-rowindex')).toBe('1')
    expect(scrollTo).toHaveBeenCalled()
    expect(view.container.querySelector('tr[data-virtual-spacer="bottom"]')).toBeTruthy()
    expect(screen.getByText('Context 1')).toBeTruthy()
    expect(screen.queryByText('Context 500')).toBeNull()

    const tablePane = screen.getByRole('table').parentElement as HTMLElement
    tablePane.scrollTop = 9_000
    fireEvent.scroll(tablePane)
    await waitFor(() => {
      expect(Number(view.container.querySelector(
        'tr[data-virtual-position]',
      )?.getAttribute('data-virtual-position'))).toBeGreaterThan(0)
    })
    expect(view.container.querySelector('tr[data-virtual-spacer="top"]')).toBeTruthy()
    expect(screen.queryByText('Context 1')).toBeNull()
  })

  it('does not re-scroll a virtual ledger when streaming only changes row content', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    const cells = Array.from({ length: 500 }, (_, index) => ({
      index: index + 1,
      kind: 'context' as const,
      sourceSeq: index + 1,
      text: `Context ${index + 1}`,
      timeSeconds: 0,
    }))
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{ title: '上下文', cells }],
    }]
    const view = render(
      <TrajectoryTable
        turns={turns}
        {...FOLD_PROPS}
      />,
    )
    await waitFor(() => {
      expect(view.container.querySelector('tr[data-virtual-position]')).toBeTruthy()
    })
    scrollTo.mockClear()

    view.rerender(
      <TrajectoryTable
        turns={turns}
        streamingCells={[{ ...cells[0]!, text: 'Context 1 streaming update' }]}
        {...FOLD_PROPS}
      />,
    )

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByText('Context 1 streaming update')).toBeTruthy()
  })

  it('keeps the virtual tail reachable with collapsed-summary row heights', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    const turns: readonly TrajectoryTurnModel[] = Array.from(
      { length: 101 },
      (_, index) => ({
        turn: index + 1,
        groups: [{
          title: 'Step 1',
          cells: [
            {
              index: index * 2 + 1,
              kind: 'message' as const,
              sourceSeq: index * 2 + 1,
              text: `Message ${index + 1}`,
              timeSeconds: 1,
            },
            {
              index: index * 2 + 2,
              kind: 'tool' as const,
              callId: `call-${index + 1}`,
              text: `Tool ${index + 1}`,
              timeSeconds: 1,
            },
          ],
        }],
      }),
    )
    const collapsedTurns = new Set(turns.flatMap(turn =>
      turn.turn === null ? [] : [turn.turn]))
    const view = render(
      <TrajectoryTable
        turns={turns}
        {...FOLD_PROPS}
        collapsedTurns={collapsedTurns}
      />,
    )
    const tablePane = screen.getByRole('table').parentElement as HTMLElement
    tablePane.scrollTop = 5_000
    fireEvent.scroll(tablePane)

    await waitFor(() => {
      expect(view.container.querySelector('tr[data-virtual-position="201"]')).toBeTruthy()
    })
  })

  it('keeps running and failure semantics distinct from record roles', () => {
    const view = render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    expect(view.container.querySelector('tr[data-kind="tool"][data-running="true"]')).toBeTruthy()
    expect(view.container.querySelector('tr[data-kind="tool"][data-error="true"]')).toBeTruthy()
    // Kind chips carry categorical tints; running and failure stay on the row's own state.
    const toolChip = view.container.querySelector('tr[data-kind="tool"] [data-role-kind="tool"]')
    expect(toolChip?.className).toContain('tintOlive')
    expect(toolChip?.className).not.toMatch(/amber|needs/i)

    fireEvent.click(screen.getByRole('row', { name: /工具，bash \{"command":"pwd"\}/ }))
    expect(screen.getByText('进行中')).toBeTruthy()
    fireEvent.click(screen.getByRole('row', { name: /工具，bash \{"command":"false"\}/ }))
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByText('失败').className).toContain('error')
    fireEvent.click(screen.getByRole('tab', { name: '结果' }))
    const errorResult = screen.getByText('ToolError: non_zero_exit')
    expect(errorResult.closest('[class*="errorPayload"]')).toBeTruthy()
  })

  it('marks failed requests and lays coincident request markers left to right', () => {
    const turns: readonly TrajectoryTurnModel[] = [
      {
        turn: 1,
        groups: [{
          title: 'Step 1',
          cells: [{
            index: 1,
            kind: 'message',
            text: '',
            requestOnly: true,
            isError: true,
            timeSeconds: 0.1,
          }],
        }],
      },
      {
        turn: 2,
        groups: [{
          title: 'Step 1',
          cells: [{
            index: 2,
            kind: 'message',
            text: '',
            requestOnly: true,
            isError: true,
            timeSeconds: 0.1,
          }],
        }],
      },
      {
        turn: 3,
        groups: [{
          title: 'Step 1',
          cells: [{
            index: 3,
            kind: 'message',
            text: 'Recovered response',
            timeSeconds: 0.1,
          }],
        }],
      },
    ]
    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    const failed = screen.getByRole('button', { name: '请求 #1' })
    const retry = screen.getByRole('button', { name: '请求 #2' })
    const recovered = screen.getByRole('button', { name: '请求 #3' })
    expect(failed.getAttribute('data-request-status')).toBe('error')
    expect(failed.getAttribute('data-request-run-index')).toBe('0')
    expect(failed.style.getPropertyValue('--request-boundary-offset')).toBe('0px')
    expect(retry.getAttribute('data-request-run-index')).toBe('1')
    expect(retry.style.getPropertyValue('--request-boundary-offset')).toBe('8px')
    expect(recovered.getAttribute('data-request-run-index')).toBe('2')
    expect(recovered.style.getPropertyValue('--request-boundary-offset')).toBe('16px')
  })

  it('shows the custom role tooltip only from the responsive icon', () => {
    const view = render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    const toolTag = view.container.querySelector<HTMLElement>('[data-role-kind="tool"]')
    const toolIcon = toolTag?.querySelector<HTMLElement>('[data-role-icon="wrench"]')

    expect(toolTag).not.toBeNull()
    expect(toolTag?.getAttribute('title')).toBeNull()
    expect(toolIcon).toBeTruthy()

    fireEvent.mouseEnter(toolTag as HTMLElement)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(toolIcon as HTMLElement)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toBe('工具')
    expect(tooltip.getAttribute('data-side')).toBe('right')
    fireEvent.mouseLeave(toolIcon as HTMLElement)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('uses information and compression glyphs for injected and compacted context', () => {
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: '上下文',
        cells: [
          { index: 1, kind: 'context', text: 'Workspace context', timeSeconds: 0 },
          { index: 2, kind: 'compacted', text: 'Compacted history', timeSeconds: 0 },
        ],
      }],
    }]
    const view = render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)

    expect(view.container.querySelector(
      '[data-role-kind="context"] [data-role-icon="information"]',
    )).toBeTruthy()
    expect(view.container.querySelector(
      '[data-role-kind="compacted"] [data-role-icon="compacted"]',
    )).toBeTruthy()
  })

  it('keeps a compact turn label available for narrow layouts', () => {
    render(<TrajectoryTable turns={TURNS} {...FOLD_PROPS} />)
    const turnLabel = screen.getByLabelText('轮次 1')

    expect(turnLabel.textContent).toContain('轮次 1')
    expect(turnLabel.textContent).toContain('#1')
  })

  it('renders a single-text JSON tool result as a JSON tree', () => {
    const turns: readonly TrajectoryTurnModel[] = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'tool',
          text: 'read {"path":"result.json"}',
          outputDetail: '{"value":1,"nested":{"ok":true}}',
          outputBlocks: [{
            type: 'text',
            content: '{"value":1,"nested":{"ok":true}}',
          }],
          timeSeconds: 0.1,
        }],
      }],
    }]

    render(<TrajectoryTable turns={turns} {...FOLD_PROPS} />)
    fireEvent.click(screen.getByRole('row', { name: /工具/ }))
    fireEvent.click(screen.getByRole('tab', { name: '结果' }))

    expect(screen.getByRole('tree', { name: '结果 JSON' })).toBeTruthy()
    expect(screen.getByText('value:')).toBeTruthy()
  })

  it('keeps the first row and a compact summary when a turn is collapsed', () => {
    render(
      <TrajectoryTable
        turns={TURNS}
        {...FOLD_PROPS}
        collapsedTurns={new Set([1])}
      />,
    )
    expect(screen.queryByRole('columnheader')).toBeNull()
    expect(screen.getByRole('row', { name: /助手/ })).toBeTruthy()
    expect(screen.getByRole('row', { name: /已折叠轮次概述/ })).toBeTruthy()
  })

  const CALL_TURNS: readonly TrajectoryTurnModel[] = [{
    turn: 1,
    groups: [{
      title: 'Step 1',
      cells: [{
        index: 1,
        kind: 'tool',
        text: 'bash · {"command":"pwd"}',
        inputDetail: '{"command":"pwd"}',
        callId: 'call-1',
        timeSeconds: 0.1,
      }],
    }],
  }]

  it('an inspect target opens the matching record and acknowledges once', () => {
    const onInspectApplied = vi.fn()
    render(
      <TrajectoryTable
        turns={CALL_TURNS}
        {...FOLD_PROPS}
        inspectCallId="call-1"
        onInspectApplied={onInspectApplied}
      />,
    )

    expect(screen.getByRole('row', { name: /工具/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('complementary', { name: '事件详情' })).toBeTruthy()
    expect(onInspectApplied).toHaveBeenCalledOnce()
  })

  it('an unmatched inspect target stays pending without acknowledgement', () => {
    const onInspectApplied = vi.fn()
    render(
      <TrajectoryTable
        turns={CALL_TURNS}
        {...FOLD_PROPS}
        inspectCallId="call-missing"
        onInspectApplied={onInspectApplied}
      />,
    )

    expect(screen.getByRole('row', { name: /工具/ }).getAttribute('aria-selected')).toBe('false')
    expect(onInspectApplied).not.toHaveBeenCalled()
  })
})
