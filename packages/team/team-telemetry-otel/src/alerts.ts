/** Windowed alert policy for the OpenTelemetry Team telemetry provider. */

import type {
  TeamTelemetryRecord,
  TeamTelemetrySeverity,
} from '@clocky/clocky-team'

/** A configurable threshold over correlated Team telemetry records. */
export interface TeamTelemetryAlertRule {
  /** Stable deployment-local name included in the emitted alert record. */
  readonly name: string
  /** Optional source family filter. */
  readonly channel?: TeamTelemetryRecord['channel']
  /** Optional exact `event.type` attribute filter. */
  readonly eventType?: string
  /** Optional minimum source severity filter. */
  readonly severity?: TeamTelemetrySeverity
  /** Number of matching records required inside the rolling window. */
  readonly threshold: number
  /** Rolling window length in milliseconds. */
  readonly windowMillis: number
}

/** One threshold crossing returned by {@link TeamTelemetryAlertPolicy.observe}. */
export interface TeamTelemetryAlert {
  /** Rule that crossed its threshold. */
  readonly ruleName: string
  /** Timestamp of the source record that caused the crossing. */
  readonly observedAt: number
  /** Matching records retained in the rule's current window. */
  readonly count: number
  /** Threshold that was crossed. */
  readonly threshold: number
  /** Configured rolling window. */
  readonly windowMillis: number
  /** Detached source record for correlation and diagnostics. */
  readonly source: TeamTelemetryRecord
}

interface AlertState {
  readonly rule: TeamTelemetryAlertRule
  times: number[]
  armed: boolean
}

const SEVERITY_RANK: Record<TeamTelemetrySeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
}

/** Validate one rule before a provider starts accepting telemetry. */
function validateRule(rule: TeamTelemetryAlertRule, index: number): TeamTelemetryAlertRule {
  if (typeof rule.name !== 'string' || rule.name.trim().length === 0) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].name must be a non-empty string`)
  }
  if (!Number.isSafeInteger(rule.threshold) || rule.threshold < 1) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].threshold must be a positive integer`)
  }
  if (!Number.isSafeInteger(rule.windowMillis) || rule.windowMillis < 1) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].windowMillis must be a positive integer`)
  }
  if (rule.eventType !== undefined && (typeof rule.eventType !== 'string' || rule.eventType.length === 0)) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].eventType must be a non-empty string`)
  }
  if (rule.channel !== undefined && !['team', 'channel', 'session', 'ops'].includes(rule.channel)) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].channel is unsupported`)
  }
  if (rule.severity !== undefined && !['info', 'warn', 'error'].includes(rule.severity)) {
    throw new Error(`team-telemetry-otel: alerts[${String(index)}].severity is unsupported`)
  }
  return Object.freeze({ ...rule })
}

/**
 * Stateless-in-output, in-memory rolling alert policy. A rule emits once when
 * its count crosses the threshold, rearms after the window falls below that
 * threshold, and never mutates the source telemetry record.
 */
export class TeamTelemetryAlertPolicy {
  private readonly states: AlertState[]

  /**
   * @param rules - deployment-owned threshold rules.
   */
  constructor(rules: readonly TeamTelemetryAlertRule[] = []) {
    const names = new Set<string>()
    this.states = rules.map((rule, index) => {
      const validated = validateRule(rule, index)
      if (names.has(validated.name)) {
        throw new Error(`team-telemetry-otel: duplicate alert rule ${JSON.stringify(validated.name)}`)
      }
      names.add(validated.name)
      return { rule: validated, times: [], armed: true }
    })
  }

  /**
   * Observe one record and return every newly crossed threshold.
   * @param record - already-detached Team telemetry record.
   * @returns alert crossings caused by this record.
   */
  observe(record: TeamTelemetryRecord): TeamTelemetryAlert[] {
    const alerts: TeamTelemetryAlert[] = []
    const eventType = record.attributes['event.type']
    for (const state of this.states) {
      if (!matches(state.rule, record, eventType)) continue
      const cutoff = record.time - state.rule.windowMillis
      state.times = state.times.filter(time => time >= cutoff)
      state.times.push(record.time)
      if (state.times.length < state.rule.threshold) {
        state.armed = true
        continue
      }
      if (!state.armed) continue
      state.armed = false
      alerts.push({
        ruleName: state.rule.name,
        observedAt: record.time,
        count: state.times.length,
        threshold: state.rule.threshold,
        windowMillis: state.rule.windowMillis,
        source: structuredClone(record),
      })
    }
    return alerts
  }
}

/** Apply the optional dimensions of one rule without interpreting the body. */
function matches(
  rule: TeamTelemetryAlertRule,
  record: TeamTelemetryRecord,
  eventType: string | number | undefined,
): boolean {
  if (rule.channel !== undefined && rule.channel !== record.channel) return false
  if (rule.eventType !== undefined && rule.eventType !== eventType) return false
  if (rule.severity !== undefined && SEVERITY_RANK[record.severity] < SEVERITY_RANK[rule.severity]) return false
  return true
}
