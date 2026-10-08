// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FactValue, type Fact } from '../src/FactValue.tsx'
import { SimClock, groupDecimal } from '../src/SimClock.tsx'

afterEach(cleanup)

const FACTS: Fact[] = [
  { state: 'observed', value: '42' },
  { state: 'unavailable', reason: '运行状态读取失败' },
  { state: 'unknown', reason: '外部操作结果丢失' },
  { state: 'stale', value: '18', observedAt: '修订 12' },
  { state: 'withheld', permission: '历史内容读取' },
  { state: 'truncated', value: '采购方：长名称…', full: '采购方：长名称供应链上下文完整文本' },
]

describe('FactValue', () => {
  it('rejects an unsupported public knowledge variant instead of presenting it as observed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<FactValue fact={{ state: 'future-state' } as unknown as Fact} />))
        .toThrow('unknown fact state {"state":"future-state"}')
    } finally { error.mockRestore() }
  })
  it('states unknown and stale knowledge without inventing a reason or observation time', () => {
    const { rerender } = render(<FactValue fact={{ state: 'unknown' }} />)
    expect(screen.getByText('结果未知')).toBeDefined()
    rerender(<FactValue fact={{ state: 'stale', value: '18' }} />)
    expect(screen.getByText('18').parentElement?.getAttribute('title')).toBe('可能已过期')
  })
  it('gives each knowledge state a distinct marker and readable text', () => {
    const texts = FACTS.map((fact) => {
      const { container, unmount } = render(<FactValue fact={fact} />)
      const node = container.firstElementChild as HTMLElement
      const result = { state: node.dataset.fact, text: node.textContent }
      unmount()
      return result
    })
    expect(texts.map(entry => entry.state)).toEqual(['observed', 'unavailable', 'unknown', 'stale', 'withheld', 'truncated'])
    expect(new Set(texts.map(entry => entry.text)).size).toBe(FACTS.length)
    expect(texts[1]!.text).toContain('不可用：运行状态读取失败')
    expect(texts[2]!.text).toContain('结果未知：外部操作结果丢失')
    expect(texts[3]!.text).toContain('可能已过期')
    expect(texts[4]!.text).toContain('需要权限：历史内容读取')
    expect(texts[5]!.text).toContain('已截断')
  })

  it('never renders an unavailable value as zero', () => {
    const { container } = render(<FactValue fact={{ state: 'unavailable', reason: '尚未观察' }} />)
    expect(container.textContent).not.toMatch(/\d/)
    expect(container.textContent).toContain('—')
  })

  it('keeps an observed zero distinct from unavailable', () => {
    const { container } = render(<FactValue fact={{ state: 'observed', value: 0 }} />)
    expect(container.textContent).toBe('0')
    expect(container.querySelector('[data-fact="observed"]')).not.toBeNull()
  })

  it('expands truncated text from a keyboard-reachable button', () => {
    render(<FactValue fact={FACTS[5]!} />)
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(screen.getByText('采购方：长名称供应链上下文完整文本')).toBeDefined()
    expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull()
  })

  it('uses owner labels when supplied', () => {
    render(<FactValue fact={{ state: 'unavailable', reason: 'not observed' }} labels={{
      unavailable: 'Unavailable', unknown: 'Unknown', stale: 'Stale', withheld: 'Requires', truncated: 'Truncated', expand: 'Expand',
    }} />)
    expect(screen.getByText('Unavailable：not observed')).toBeDefined()
  })
})

describe('SimClock', () => {
  it('groups decimal strings without numeric conversion', () => {
    expect(groupDecimal('1240')).toBe('1,240')
    expect(groupDecimal('9007199254740993')).toBe('9,007,199,254,740,993')
    expect(groupDecimal('-1234567.125')).toBe('-1,234,567.125')
    expect(groupDecimal('12')).toBe('12')
    expect(groupDecimal('not-a-number')).toBe('not-a-number')
  })

  it('shows values above 2^53 exactly, with the exact value in the tooltip', () => {
    render(<SimClock value="9007199254740993" unit="minute" unitLabel="分钟" label="模拟时间" />)
    const clock = screen.getByRole('img', { name: '模拟时间 9,007,199,254,740,993 分钟' })
    expect(clock.getAttribute('title')).toBe('9007199254740993 minute')
    expect(clock.getAttribute('data-clock')).toBe('simulated')
    // Number() would have rounded this value to ...992.
    expect(String(Number('9007199254740993'))).not.toBe('9007199254740993')
  })
})
