import { describe, expect, it } from 'vitest'
import type { TeamTelemetryRecord } from '@clocky/clocky-team'
import { TeamTelemetryAlertPolicy, type TeamTelemetryAlertRule } from '../src/alerts.ts'

function record(time: number, severity: TeamTelemetryRecord['severity'] = 'error', attributes: Record<string, string | number> = {}): TeamTelemetryRecord {
  return {
    channel: 'session',
    time,
    severity,
    attributes: { 'event.type': 'turn/end', ...attributes },
    body: { time },
  }
}

describe('TeamTelemetryAlertPolicy', () => {
  it('alerts once per threshold crossing and rearms after the window drains', () => {
    const policy = new TeamTelemetryAlertPolicy([{
      name: 'errors',
      threshold: 2,
      windowMillis: 100,
    }])

    expect(policy.observe(record(0))).toEqual([])
    const first = policy.observe(record(10))
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ ruleName: 'errors', observedAt: 10, count: 2 })
    expect(policy.observe(record(20))).toEqual([])
    expect(policy.observe(record(200))).toEqual([])
    expect(policy.observe(record(210))).toHaveLength(1)
  })

  it('applies channel, event, and minimum-severity filters without sharing the source body', () => {
    const rule: TeamTelemetryAlertRule = {
      name: 'failed-model',
      channel: 'session',
      eventType: 'turn/end',
      severity: 'error',
      threshold: 1,
      windowMillis: 1_000,
    }
    const policy = new TeamTelemetryAlertPolicy([rule])
    expect(policy.observe({ ...record(1, 'warn'), channel: 'team' })).toEqual([])
    expect(policy.observe(record(2, 'warn'))).toEqual([])
    const source = record(3, 'error')
    const alerts = policy.observe(source)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.source).toEqual(source)
    expect(alerts[0]?.source).not.toBe(source)
    expect(alerts[0]?.source.body).not.toBe(source.body)
    expect(policy.observe(record(4, 'error', { 'event.type': 'tool/result' }))).toEqual([])
  })

  it.each([
    [{ name: '', threshold: 1, windowMillis: 1 }, /name/],
    [{ name: 'bad-threshold', threshold: 0, windowMillis: 1 }, /threshold/],
    [{ name: 'bad-window', threshold: 1, windowMillis: 0 }, /windowMillis/],
    [{ name: 'bad-event', threshold: 1, windowMillis: 1, eventType: '' }, /eventType/],
    [{ name: 'bad-channel', threshold: 1, windowMillis: 1, channel: 'unknown' }, /channel/],
    [{ name: 'bad-severity', threshold: 1, windowMillis: 1, severity: 'fatal' }, /severity/],
  ])('rejects invalid rule %j', (rule, message) => {
    expect(() => new TeamTelemetryAlertPolicy([rule as TeamTelemetryAlertRule])).toThrow(message)
  })

  it('rejects duplicate names so alert identity is stable', () => {
    const rule = { name: 'same', threshold: 1, windowMillis: 1 }
    expect(() => new TeamTelemetryAlertPolicy([rule, rule])).toThrow(/duplicate alert rule/)
  })
})
