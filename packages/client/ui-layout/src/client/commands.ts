/**
 * Shell keyboard shortcuts and command-palette providers. Feature plugins
 * register through `ctx.layout`; the shell owns the single global key
 * listener, so two features cannot silently claim the same chord.
 */

/** Text that may follow the active locale: a string, or a reader called at display time. */
export type LiveText = string | (() => string)

/** Resolve {@link LiveText} for display.
 * @param value - Literal text or a reader of the current display text.
 * @returns the resolved display text.
 */
export function liveText(value: LiveText): string {
  return typeof value === 'function' ? value() : value
}

/** One registered keyboard shortcut. */
export interface ShortcutSpec {
  /** Stable owner-qualified id, for example `team.inbox`. */
  readonly id: string
  /** Chord such as `mod+k`, `?`, or `g i`; `mod` is Command on macOS and Control elsewhere. */
  readonly keys: string
  /** Human label shown in the shortcut overlay. */
  readonly label: LiveText
  /** Overlay group heading. */
  readonly group: LiveText
  /** Fire even while focus is in a text field (only sensible for `mod` chords). */
  readonly allowInInput?: boolean
  readonly run: () => void
}

/** One command-palette result produced by a provider. */
export interface CommandItem {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  readonly keywords?: readonly string[] | undefined
  readonly shortcut?: readonly string[] | undefined
  readonly run: () => void
}

/** A palette section owned by one feature. */
export interface CommandProvider {
  readonly id: string
  readonly label: LiveText
  /** Produce current items; called when the palette opens, so it reads the owner's live state. */
  readonly items: () => readonly CommandItem[]
}

/** Thrown when a chord is already registered by another owner. */
export class ShortcutConflictError extends Error {
  /**
   * @param chord - the normalized chord.
   * @param holder - id of the existing registration.
   * @param claimant - id that tried to register.
   */
  constructor(readonly chord: string, readonly holder: string, readonly claimant: string) {
    super(`shortcut "${chord}" is already registered by "${holder}"; "${claimant}" must choose another chord`)
  }
}

/**
 * Normalize a written chord: lower-case, modifiers in a fixed order.
 * @param keys - written chord, for example `Shift+Mod+P`.
 * @returns the canonical chord.
 */
export function normalizeChord(keys: string): string {
  const parts = keys.toLowerCase().split('+').map(part => part.trim()).filter(part => part.length > 0)
  const key = parts.pop() ?? ''
  const mods = ['mod', 'alt', 'shift'].filter(mod => parts.includes(mod))
  return [...mods, key].join('+')
}

/**
 * Chord for a keyboard event. Shift is dropped for printable non-letters,
 * whose shifted character already names the key (`?` rather than `shift+/`).
 * @param event - the key event.
 * @param mac - whether Command acts as the primary modifier.
 * @returns the canonical chord.
 */
export function chordOf(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac: boolean): string {
  const key = event.key.toLowerCase()
  const printable = key.length === 1
  const parts: string[] = []
  if (mac ? event.metaKey : event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey && !(printable && !/[a-z]/.test(key))) parts.push('shift')
  return [...parts, key].join('+')
}

/** Whether focus is in a place that types text. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit'].includes((target as HTMLInputElement).type))
}

/** The shell's shortcut and palette registries. */
export class CommandRegistry {
  readonly #shortcuts = new Map<string, ShortcutSpec>()
  readonly #providers = new Map<string, CommandProvider>()
  readonly #listeners = new Set<() => void>()
  #version = 0

  /**
   * Register one shortcut.
   * @param spec - the shortcut.
   * @returns a disposer that removes exactly this registration.
   * @throws ShortcutConflictError when the chord is already taken.
   */
  registerShortcut(spec: ShortcutSpec): () => void {
    const chord = normalizeChord(spec.keys)
    const holder = this.#shortcuts.get(chord)
    if (holder !== undefined) throw new ShortcutConflictError(chord, holder.id, spec.id)
    this.#shortcuts.set(chord, spec)
    this.#changed()
    return () => {
      if (this.#shortcuts.get(chord) !== spec) return
      this.#shortcuts.delete(chord)
      this.#changed()
    }
  }

  /**
   * Register one palette provider.
   * @param provider - the section provider.
   * @returns a disposer.
   */
  registerProvider(provider: CommandProvider): () => void {
    this.#providers.set(provider.id, provider)
    this.#changed()
    return () => {
      if (this.#providers.get(provider.id) !== provider) return
      this.#providers.delete(provider.id)
      this.#changed()
    }
  }

  /** Registered shortcuts in registration order, with display text resolved.
   * @returns registered shortcut identities, chords, labels and groups.
   */
  shortcuts(): readonly { id: string; chord: string; label: string; group: string }[] {
    return [...this.#shortcuts].map(([chord, spec]) => ({ id: spec.id, chord, label: liveText(spec.label), group: liveText(spec.group) }))
  }

  /** Current palette sections from every provider.
   * @returns sections with current labels and items in registration order.
   */
  sections(): { id: string; label: string; items: readonly CommandItem[] }[] {
    return [...this.#providers.values()].map(provider => ({ id: provider.id, label: liveText(provider.label), items: provider.items() }))
  }

  /** Subscribe to registration changes.
   * @param listener - Callback invoked after a registration changes.
   * @returns a disposer that removes the listener.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Monotonic registration version.
   * @returns the number of published registration changes.
   */
  version(): number {
    return this.#version
  }

  /**
   * Dispatch one key event. Input-method composition never triggers a
   * shortcut, and text fields only receive shortcuts registered for them.
   * @param event - the keydown event.
   * @param mac - whether Command acts as the primary modifier.
   * @returns whether a shortcut handled the event.
   */
  handle(event: KeyboardEvent, mac: boolean): boolean {
    if (event.isComposing || event.key === 'Process' || event.defaultPrevented) return false
    const spec = this.#shortcuts.get(chordOf(event, mac))
    if (spec === undefined) return false
    if (isEditable(event.target) && spec.allowInInput !== true) return false
    event.preventDefault()
    spec.run()
    return true
  }

  #changed(): void {
    this.#version += 1
    for (const listener of this.#listeners) listener()
  }
}
