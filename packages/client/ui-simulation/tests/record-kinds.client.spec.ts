/** Labels never turn a truncated prefix or extension into a different known event family. */
import { expect, it } from 'vitest'
import { recordKindLabel, recordKinds } from '../src/client/record-kinds.ts'
import { en, zh } from '../src/client/locales.ts'
it.each([en, zh])('labels native families while preserving exact unknown and truncated kinds', (locale) => {
  for (const [kind, key] of recordKinds) expect(recordKindLabel(kind, key => locale[key])).toBe(locale[key])
  expect(recordKindLabel('extension/custom', key => locale[key])).toBe('extension/custom')
  expect(recordKindLabel('run/change', key => locale[key], true)).toBe('run/change')
})
