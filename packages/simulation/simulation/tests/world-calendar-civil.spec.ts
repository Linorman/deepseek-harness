/** Bundled IANA data fixes weekdays, exception dates and DST folds/gaps independently of the Host timezone. */
import { describe, expect, it } from 'vitest'
import { compileCivilCalendar, simulationCivilCalendarSchema, WORLD_CALENDAR_TZDB_VERSION } from '../src/world-calendar-civil.ts'
function rule(overrides: object = {}) {
  return simulationCivilCalendarSchema.parse({ version: 1, timeZone: 'America/New_York', tzdbVersion: WORLD_CALENDAR_TZDB_VERSION,
    disambiguation: 'reject', origin: '2026-01-01T00:00:00Z', tickMilliseconds: 60000,
    from: '2026-03-08', until: '2026-03-08', weekdays: [7], shifts: ['02:30:00'], exceptDates: [], additions: [], ...overrides })
}
describe('pinned civil recurrence', () => {
  it('resolves nonexistent spring times only through the declared ambiguity rule', () => {
    expect(() => compileCivilCalendar(rule(), 4)).toThrow(/ambiguous|nonexistent/)
    const earlier = compileCivilCalendar(rule({ disambiguation: 'earlier' }), 4)
    const later = compileCivilCalendar(rule({ disambiguation: 'later' }), 4)
    expect(BigInt(later[0]!) - BigInt(earlier[0]!)).toBe(60n)
    expect(new Date(Date.parse('2026-01-01T00:00:00Z') + Number(later[0]) * 60000).toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })
  it('keeps both autumn interpretations reproducible and refuses an unselected fold', () => {
    const fold = { from: '2026-11-01', until: '2026-11-01', shifts: ['01:30:00'] }
    expect(() => compileCivilCalendar(rule(fold), 4)).toThrow(/ambiguous/)
    const earlier = compileCivilCalendar(rule({ ...fold, disambiguation: 'earlier' }), 4)
    const later = compileCivilCalendar(rule({ ...fold, disambiguation: 'later' }), 4)
    expect(BigInt(later[0]!) - BigInt(earlier[0]!)).toBe(60n)
  })
  it('compiles actual weekdays, holidays and extra shifts with exact tick alignment', () => {
    const value = rule({ timeZone: 'Asia/Tokyo', from: '2026-03-09', until: '2026-03-15', weekdays: [1, 2, 3, 4, 5],
      shifts: ['09:00:00'], exceptDates: ['2026-03-10'], additions: ['2026-03-14T12:00:00'] })
    expect(compileCivilCalendar(value, 5)).toHaveLength(5)
    expect(() => compileCivilCalendar(value, 4)).toThrow(/bound/)
    expect(() => compileCivilCalendar({ ...value, tzdbVersion: 'unknown' }, 5)).toThrow(/tzdb/)
    expect(() => compileCivilCalendar({ ...value, from: '2026-02-30' }, 5)).toThrow(/Gregorian/)
    expect(() => compileCivilCalendar({ ...value, until: '2040-01-01' }, 5)).toThrow(/bounded/)
  })
})
