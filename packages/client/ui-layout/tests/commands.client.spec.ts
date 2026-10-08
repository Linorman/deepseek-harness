// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { chordOf, CommandRegistry, normalizeChord, ShortcutConflictError } from '../src/client/commands.ts'

/** Build a keydown event aimed at `target`. */
function keydown(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('shell shortcuts', () => {
  it('normalizes written chords so modifier order and case cannot create duplicates', () => {
    expect(normalizeChord('Shift+Mod+P')).toBe('mod+shift+p')
    expect(normalizeChord('?')).toBe('?')
    expect(chordOf({ key: 'K', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe('mod+k')
    expect(chordOf({ key: 'k', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, false)).toBe('mod+k')
    expect(chordOf({ key: '?', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }, true)).toBe('?')
  })

  it('refuses a second owner for the same chord and frees it on disposal', () => {
    const registry = new CommandRegistry()
    const dispose = registry.registerShortcut({ id: 'a', keys: 'mod+k', label: 'A', group: 'G', run: vi.fn() })
    expect(() => registry.registerShortcut({ id: 'b', keys: 'Mod+K', label: 'B', group: 'G', run: vi.fn() }))
      .toThrow(ShortcutConflictError)
    dispose()
    expect(() => registry.registerShortcut({ id: 'b', keys: 'mod+k', label: 'B', group: 'G', run: vi.fn() })).not.toThrow()
    expect(registry.shortcuts().map(item => item.id)).toEqual(['b'])
  })

  it('ignores composition and text fields unless the shortcut allows input', () => {
    const registry = new CommandRegistry()
    const help = vi.fn()
    const palette = vi.fn()
    registry.registerShortcut({ id: 'help', keys: '?', label: 'Help', group: 'G', run: help })
    registry.registerShortcut({ id: 'palette', keys: 'mod+k', label: 'Palette', group: 'G', allowInInput: true, run: palette })
    const input = document.createElement('textarea')
    expect(registry.handle(keydown({ key: '?', shiftKey: true }, input), true)).toBe(false)
    expect(registry.handle(keydown({ key: '?', shiftKey: true, isComposing: true }), true)).toBe(false)
    expect(help).not.toHaveBeenCalled()
    const event = keydown({ key: '?', shiftKey: true })
    expect(registry.handle(event, true)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(registry.handle(keydown({ key: 'k', metaKey: true }, input), true)).toBe(true)
    expect([help.mock.calls.length, palette.mock.calls.length]).toEqual([1, 1])
  })

  it('reads provider items when sections are requested and drops a disposed provider', () => {
    const registry = new CommandRegistry()
    let label = 'First'
    const dispose = registry.registerProvider({ id: 'teams', label: () => 'Teams', items: () => [{ id: '1', label, run: vi.fn() }] })
    expect(registry.sections()[0]?.items[0]?.label).toBe('First')
    label = 'Second'
    expect(registry.sections()[0]).toMatchObject({ label: 'Teams', items: [{ label: 'Second' }] })
    const versions = registry.version()
    dispose()
    expect(registry.sections()).toEqual([])
    expect(registry.version()).toBeGreaterThan(versions)
  })
})
