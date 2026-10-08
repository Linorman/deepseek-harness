// Avatar: participant initials on a role tint. Identity is text, not color.

import clsx from 'clsx'
import css from './Avatar.module.css'

/** Categorical role tints (never status colors); unknown roles hash onto a stable tint. */
export type AvatarTone = 'teal' | 'fuchsia' | 'olive' | 'slate'

const KNOWN_ROLES: Readonly<Record<string, AvatarTone>> = {
  coordinator: 'fuchsia',
  human: 'teal',
  user: 'teal',
  system: 'slate',
}
const HASHED: readonly AvatarTone[] = ['olive', 'fuchsia', 'teal']

/**
 * Pick the tint for a role: fixed for known roles, stable hash otherwise.
 * @param role - participant role.
 * @returns the tint name.
 */
export function avatarTone(role: string | undefined): AvatarTone {
  if (role === undefined || role.length === 0) return 'slate'
  const known = KNOWN_ROLES[role.toLowerCase()]
  if (known !== undefined) return known
  let hash = 0
  // for..of emits nonempty Unicode characters; modulo indexes the fixed,
  // nonempty palette above, so neither lookup has an absent-value case.
  for (const char of role) hash = (hash * 31 + (char.codePointAt(0) as number)) >>> 0
  return HASHED[hash % HASHED.length] as AvatarTone
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Split text into user-perceived characters, keeping emoji and combining marks whole. */
function graphemes(text: string): string[] {
  return Array.from(SEGMENTER.segment(text), part => part.segment)
}

/**
 * Derive up to two initials: the first character of a CJK name, otherwise the
 * first letters of the first two words (or the first two letters of one word).
 * @param name - display name.
 * @returns uppercase initials, or `?` for an empty name.
 */
export function avatarInitials(name: string): string {
  const [first] = graphemes(name.trim())
  if (first === undefined) return '?'
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(first)) return first
  const [one = '', two] = name.trim().split(/[\s_\-.]+/).filter(word => word.length > 0)
  // When a second word exists, both filtered words are nonempty and native
  // grapheme segmentation supplies a first character for each.
  const letters = two === undefined
    ? graphemes(one).slice(0, 2).join('')
    : `${graphemes(one)[0] as string}${graphemes(two)[0] as string}`
  return letters.toUpperCase()
}

/**
 * Render a participant avatar.
 * @param props.name - display name; becomes the accessible name unless `decorative`.
 * @param props.role - participant role, choosing the tint.
 * @param props.size - 20, 24 (default), or 32 px.
 * @param props.decorative - hide from assistive technology when adjacent text names the participant.
 * @returns the avatar element.
 */
export function Avatar({ name, role, size = 24, decorative = false, className }: {
  name: string
  role?: string | undefined
  size?: 20 | 24 | 32
  decorative?: boolean
  className?: string | undefined
}) {
  return (
    <span
      className={clsx(css.avatar, css[`s${String(size)}` as 's20' | 's24' | 's32'], className)}
      data-tone={avatarTone(role)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
    >
      {avatarInitials(name)}
    </span>
  )
}
