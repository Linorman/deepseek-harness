// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { ToolRow, toolDurationMs } from '../src/client/tool/components/ToolRow.tsx'

afterEach(cleanup)

describe('tool row duration', () => {
  it('measures settled calls only', () => {
    expect(toolDurationMs({ kind: 'tool-result', time: 4_500, callTime: 1_000 })).toBe(3_500)
    expect(toolDurationMs({ kind: 'tool-result', time: 4_500, callTime: null })).toBeUndefined()
    expect(toolDurationMs({ time: 4_500 })).toBeUndefined()
  })

  it('renders the duration at the end of the summary line', () => {
    const { container } = render(<ToolRow t={makeTranslate({}) as never} variant="others" icon={null} title="bash"
      summary="ls" body={null} state="ok" durationMs={12_400} />)
    const duration = container.querySelector('[data-volatile]')
    expect(duration?.textContent).toBe('12s')
  })
})
