/** Dictionary-backed locale seats for component fixtures, including interpolation. */
import type { TranslateNS } from '@clocky/clocky-client-ui-slots'
import { en, zh } from '../src/client/locales.ts'

function translate(dictionary: Readonly<Record<string, string>>): TranslateNS<'trajectory'> {
  return (key, params) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      params !== undefined && name in params ? String(params[name]) : match)
  }
}

/** Chinese locale seat matching the product's default copy. */
export const tZh = translate(zh)
/** English locale seat used to verify switching and copy parity. */
export const tEn = translate(en)
