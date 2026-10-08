import { describe, expect, it } from 'vitest'
import { teamSenderOf, withoutSenderPrefix } from '../src/client/chat/team-sender.ts'

describe('Team sender display projection', () => {
  it('reads the sender only from team-envelope sources', () => {
    expect(teamSenderOf({ kind: 'team-envelope', senderId: 'participant-1' })).toEqual({ senderId: 'participant-1' })
    expect(teamSenderOf({ kind: 'user' })).toBeUndefined()
    expect(teamSenderOf(null)).toBeUndefined()
  })

  it('removes the exact v3 prefix block and keeps the content that follows', () => {
    const content = [{ type: 'text', text: 'Direct message from participant-1:\n' }, { type: 'text', text: 'Ship it' }]
    expect(withoutSenderPrefix(content, { senderId: 'participant-1' })).toEqual([{ type: 'text', text: 'Ship it' }])
  })

  it('removes the prefix from a combined text block', () => {
    const content = [{ type: 'text', text: 'Direct message from participant-1:\nShip it' }]
    expect(withoutSenderPrefix(content, { senderId: 'participant-1' })).toEqual([{ type: 'text', text: 'Ship it' }])
  })

  it('leaves text alone when the prefix names another sender or is absent', () => {
    const other = [{ type: 'text', text: 'Direct message from participant-2:\nhello' }]
    expect(withoutSenderPrefix(other, { senderId: 'participant-1' })).toBe(other)
    const plain = [{ type: 'text', text: 'hello' }]
    expect(withoutSenderPrefix(plain, { senderId: 'participant-1' })).toBe(plain)
  })

  it('never mutates the recorded content', () => {
    const content = Object.freeze([Object.freeze({ type: 'text', text: 'Direct message from p:\nx' })])
    withoutSenderPrefix(content, { senderId: 'p' })
    expect(content[0]).toEqual({ type: 'text', text: 'Direct message from p:\nx' })
  })
})
