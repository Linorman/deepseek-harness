/** Field comparison of already parsed private drafts; output is bounded independently of the retained definitions. */
import type { ScenarioDraftSave } from '@clocky/clocky-client-runtime/client'

/** One changed JSON path, with bounded display values; full originals remain separately inspectable. */
export interface DraftFieldChange {
  readonly path: string
  readonly local: string | undefined
  readonly saved: string | undefined
}
/** Bounded comparison with an exact omitted-field count. */
export interface DraftComparison {
  readonly changes: readonly DraftFieldChange[]
  readonly omitted: number
}

/** Compare names and supported definition fields without modifying either original.
 * @param local - Attempted save from the authenticated author.
 * @param saved - Current saved head, or null when that ancestor is absent.
 * @returns at most 128 changed paths; each value is explicitly shortened after 160 Unicode characters.
 */
export function compareAuthorDrafts(local: Pick<ScenarioDraftSave, 'name' | 'definition' | 'layout' | 'templateManifest'>,
  saved: Pick<ScenarioDraftSave, 'name' | 'definition' | 'layout' | 'templateManifest'> | null): DraftComparison {
  const changes: DraftFieldChange[] = []
  let total = 0
  const display = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    const text = JSON.stringify(value)
    const characters = Array.from(text)
    return characters.length > 160 ? characters.slice(0, 160).join('') + '…' : text
  }
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (Object.is(left, right)) return
    if (object(left) && object(right) && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const token = key.replaceAll('~', '~0').replaceAll('/', '~1')
        visit(left[key], right[key], `${path}/${token}`)
      }
      return
    }
    total++
    if (changes.length < 128) changes.push({ path, local: display(left), saved: display(right) })
  }
  visit(local.name, saved?.name, '/name')
  visit(local.definition, saved?.definition, '/definition')
  visit(local.layout, saved?.layout, '/layout')
  visit(local.templateManifest, saved?.templateManifest, '/templateManifest')
  return { changes, omitted: total - changes.length }
}
