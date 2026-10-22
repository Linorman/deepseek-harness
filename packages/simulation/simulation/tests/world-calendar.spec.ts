/** Finite simulated recurrence compilation rejects ambiguity and unbounded expansion before scheduling. */
import { describe, expect, it } from 'vitest'
import { compileCalendarTimes, simulationCalendarRecurrenceSchema, simulationCalendarRevisionRequestSchema } from '../src/world-calendar.ts'
const recurrence = () => simulationCalendarRecurrenceSchema.parse({ version: 1, clock: 'simulation', shifts: ['0', '2'],
  exceptions: ['2'], additions: ['3'] })
const rule = () => ({ startsAt: '0', endsAt: '8', period: '4', maxOccurrences: 5, recurrence: recurrence() })
describe('finite calendar compilation', () => {
  it('orders bounded shifts, suppresses exceptions and deduplicates added instants', () => {
    expect(compileCalendarTimes(rule())).toEqual(['0', '3', '4', '6', '8'])
    expect(compileCalendarTimes({ ...rule(), recurrence: { ...recurrence(), additions: [] } })).toEqual(['0', '4', '6', '8'])
  })
  it('refuses unbounded horizons, unsupported wall-clock interpretations and over-capacity schedules', () => {
    for (const value of [{ ...rule(), endsAt: null }, { ...rule(), maxOccurrences: 2 },
      { ...rule(), endsAt: '999999999999999999' }, { ...rule(), period: '1' }])
      expect(() => compileCalendarTimes(value)).toThrow()
    expect(() => simulationCalendarRecurrenceSchema.parse({ ...recurrence(), clock: 'America/New_York' })).toThrow()
    expect(() => simulationCalendarRecurrenceSchema.parse({ ...recurrence(), version: 2 })).toThrow()
    expect(() => simulationCalendarRecurrenceSchema.parse({ ...recurrence(), timezone: 'local' })).toThrow()
  })
  it('refuses additions outside the declared horizon or contradictory exception declarations', () => {
    for (const additions of [['9'], ['2']]) expect(() => compileCalendarTimes({ ...rule(),
      recurrence: simulationCalendarRecurrenceSchema.parse({ ...recurrence(), additions }) })).toThrow()
  })
  it('rejects undeclared room and equipment booking rather than accepting an inert reservation', () => {
    const request = { commandId: 'edit', expectedRuleRevision: 1, calendar: { id: 'shift',
      target: { kind: 'person', personId: 'worker' }, body: 'Work', ...rule() } }
    for (const extra of [{ roomId: 'room' }, { equipment: ['machine'] }, { reservations: [] }])
      expect(() => simulationCalendarRevisionRequestSchema.parse({ ...request, calendar: { ...request.calendar, ...extra } })).toThrow()
  })

})
