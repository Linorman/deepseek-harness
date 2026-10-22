/** Version-pinned civil work schedules compile with bundled IANA data, never the Host timezone or Intl database. */
import moment from 'moment-timezone'
import { z } from 'zod'
import { simTimeSchema } from './time.ts'

/** Exact tzdb shipped by the pinned calendar conversion artifact. */
export const WORLD_CALENDAR_TZDB_VERSION = moment.tz.dataVersion
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
/** Explicit workweek, local shifts and exception dates, with deterministic DST and simulation-clock mapping. */
export const simulationCivilCalendarSchema = z.strictObject({
  version: z.literal(1), timeZone: z.string().min(1).max(128), tzdbVersion: z.string().min(1).max(32),
  disambiguation: z.enum(['reject', 'earlier', 'later']),
  origin: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  tickMilliseconds: z.number().int().positive().max(86400000),
  from: date, until: date, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  shifts: z.array(clock).min(1).max(64), exceptDates: z.array(date).max(4096), additions: z.array(local).max(4096),
}).refine(value => [value.weekdays, value.shifts, value.exceptDates, value.additions].every(items =>
  new Set<string | number>(items).size === items.length),
'Civil calendar selections must be distinct')
/** Original civil declaration retained with its calendar revision. */
export type SimulationCivilCalendar = z.infer<typeof simulationCivilCalendarSchema>
function instant(text: string): number {
  const value = Date.parse(text)
  if (!Number.isFinite(value) || new Date(value).toISOString().replace('.000Z', 'Z') !== text)
    throw new Error('Civil calendar requires a real canonical Gregorian date and UTC instant')
  return value
}
function resolveLocal(text: string, rule: SimulationCivilCalendar): number {
  const zone = moment.tz.zone(rule.timeZone)
  if (zone === null || rule.tzdbVersion !== WORLD_CALENDAR_TZDB_VERSION)
    throw new Error('Civil calendar timezone or pinned tzdb version is not installed')
  const wall = instant(`${text}Z`)
  const candidates = [...new Set(zone.offsets)].map(offset => wall + offset * 60000)
    .filter(utc => utc - zone.utcOffset(utc) * 60000 === wall).sort((a, b) => a - b)
  if (candidates.length === 1) return candidates[0] as number
  if (rule.disambiguation === 'reject') throw new Error('Civil calendar local time is ambiguous or nonexistent')
  if (candidates.length > 1) return (rule.disambiguation === 'earlier' ? candidates[0] : candidates.at(-1)) as number
  for (let index = 0; index < zone.untils.length - 1; index++) {
    const boundary = zone.untils[index], before = zone.offsets[index], after = zone.offsets[index + 1]
    if (boundary === undefined || before === undefined || after === undefined || after >= before) continue
    if (wall >= boundary - before * 60000 && wall < boundary - after * 60000)
      return wall + (rule.disambiguation === 'earlier' ? after : before) * 60000
  }
  throw new Error('Civil calendar local time is outside installed timezone coverage')
}
/** Convert a finite civil schedule into exact canonical simulated ticks.
 * @param raw - Original timezone/version, local workweek and explicit ambiguity policy.
 * @param maximum - Maximum admitted occurrences for this rule.
 * @returns ordered canonical ticks; invalid dates, fractional/negative ticks, unsupported tzdb and expansion overflow reject.
 */
export function compileCivilCalendar(raw: SimulationCivilCalendar, maximum: number): string[] {
  const rule = simulationCivilCalendarSchema.parse(raw)
  const start = instant(`${rule.from}T00:00:00Z`), end = instant(`${rule.until}T00:00:00Z`), origin = instant(rule.origin)
  if (end < start || (end - start) / 86400000 >= 4096 || maximum < 1 || maximum > 4096)
    throw new Error('Civil calendar horizon and occurrence count must be finite and bounded')
  if (moment.tz.zone(rule.timeZone) === null || rule.tzdbVersion !== WORLD_CALENDAR_TZDB_VERSION)
    throw new Error('Civil calendar timezone or pinned tzdb version is not installed')
  const excluded = new Set(rule.exceptDates), locals: string[] = []
  for (const day of excluded) instant(`${day}T00:00:00Z`)
  for (let day = start; day <= end; day += 86400000) {
    const value = new Date(day), label = value.toISOString().slice(0, 10), weekday = value.getUTCDay() || 7
    if (rule.weekdays.includes(weekday) && !excluded.has(label)) for (const shift of rule.shifts) locals.push(`${label}T${shift}`)
  }
  for (const added of rule.additions) {
    const day = instant(`${added.slice(0, 10)}T00:00:00Z`)
    if (day < start || day > end || excluded.has(added.slice(0, 10))) throw new Error('Civil addition conflicts with the horizon or exception date')
    locals.push(added)
  }
  const times = new Set(locals.map((value) => {
    const delta = resolveLocal(value, rule) - origin
    if (delta < 0 || delta % rule.tickMilliseconds !== 0) throw new Error('Civil occurrence cannot map to an exact nonnegative simulation tick')
    return simTimeSchema.parse(String(delta / rule.tickMilliseconds))
  }))
  if (times.size === 0 || times.size > maximum) throw new Error('Civil calendar occurrence count exceeds its declared bound')
  return [...times].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
}
