import { describe, expect, it } from 'vitest'
import { composerActivity } from '../src/client/contract/composer-activity.ts'

describe('composer activity', () => {
  it('is absent while idle, even with stale partial or call state', () => {
    expect(composerActivity({ running: false, tool: 'bash', toolStep: 2, partialStep: 2 })).toBeUndefined()
  })

  it('prefers the newest running tool call over streaming text', () => {
    expect(composerActivity({ running: true, tool: 'bash', toolStep: 3, partialStep: 3, partialBlock: 'text' }))
      .toEqual({ kind: 'tool', name: 'bash', step: 3 })
  })

  it('distinguishes reasoning from a reply and falls back to working', () => {
    expect(composerActivity({ running: true, partialStep: 1, partialBlock: 'reasoning' })).toEqual({ kind: 'thinking', step: 1 })
    expect(composerActivity({ running: true, partialStep: 1, partialBlock: 'text' })).toEqual({ kind: 'replying', step: 1 })
    expect(composerActivity({ running: true })).toEqual({ kind: 'working' })
  })
})
