/** Team telemetry capture seam and live event correlator. */

import { Service } from '@clocky/cordis'
import type { Context } from '@clocky/cordis'
import type { Session, SessionEvent } from '@clocky/clocky-session'
import type { ChannelEvent, TeamEvent } from './types.ts'

/** Severity used by Team telemetry receivers and alerting policies. */
export type TeamTelemetrySeverity = 'info' | 'warn' | 'error'

/**
 * One logical Team telemetry record. The body remains the source event's
 * detached JSON payload; identity and span attributes are duplicated in the
 * small attribute map so receivers can group records without decoding it.
 */
export interface TeamTelemetryRecord {
  /** Source family: Team journal, channel WAL, participant Session, or lifecycle signal. */
  readonly channel: 'team' | 'channel' | 'session' | 'ops'
  /** Source event time, or the emission time for an operational signal. */
  readonly time: number
  /** Preclassified severity for dashboards and alerting. */
  readonly severity: TeamTelemetrySeverity
  /** Correlation and span attributes; values stay primitive for log exporters. */
  readonly attributes: Record<string, string | number>
  /** Detached source event data or operational payload. */
  readonly body: unknown
}

/** Minimum non-blocking handoff contract required by the Team telemetry coordinator. */
export interface TeamTelemetrySink {
  /**
   * Accept one already-detached record. Implementations must enqueue rather
   * than block the Team or Session event path.
   * @param record - record owned by the sink after this call.
   */
  emit(record: TeamTelemetryRecord): void
  /** Optional non-blocking flush hint after a Session flush boundary. */
  flush?(): void
  /**
   * Drain and close the downstream exporter.
   * @returns completion after the sink reaches quiescence.
   */
  shutdown(): Promise<void>
}

/**
 * Team telemetry backend Service Definition. A deployment provider extends
 * this class and composes {@link TeamTelemetryCoordinator}; the coordinator
 * owns capture and correlation, while batching, retry, loss, and export stay
 * with the provider.
 */
export abstract class TeamTelemetryBackend extends Service implements TeamTelemetrySink {
  /** @param ctx - context that owns this backend's lifetime. */
  constructor(ctx: Context) {
    super(ctx, 'teamTelemetry')
  }

  /**
   * See {@link TeamTelemetrySink.emit}.
   * @param record - detached telemetry record owned by the backend.
   */
  abstract emit(record: TeamTelemetryRecord): void

  /** See {@link TeamTelemetrySink.flush}. */
  flush?(): void

  /**
   * See {@link TeamTelemetrySink.shutdown}.
   * @returns completion after the backend reaches quiescence.
   */
  abstract shutdown(): Promise<void>
}

declare module '@clocky/cordis' {
  interface Context {
    /** Optional deployment-selected Team telemetry backend. */
    teamTelemetry: TeamTelemetryBackend
  }

  interface Events {
    /**
     * Transform one Team telemetry record before export. A listener must call
     * `next()` to preserve lower redaction or enrichment layers.
     * @param record - detached candidate record.
     * @param next - remaining telemetry policy waterfall.
     * @mode waterfall
     */
    'team-telemetry/record'(record: TeamTelemetryRecord, next: () => TeamTelemetryRecord): TeamTelemetryRecord
  }
}

/** Keys whose values identify a Team entity or execution span. */
const ID_KEYS: Readonly<Record<string, string>> = {
  teamId: 'team.id',
  participantId: 'participant.id',
  activationId: 'activation.id',
  sessionId: 'session.id',
  channelId: 'channel.id',
  envelopeId: 'envelope.id',
  taskId: 'task.id',
  attemptId: 'attempt.id',
  traceId: 'trace.id',
  causationId: 'causation.id',
  correlationId: 'correlation.id',
  provider: 'model.provider',
  model: 'model.name',
}

/** Nested payload members that may carry known correlation fields. */
const CORRELATION_CONTAINERS = new Set([
  'team', 'goal', 'participant', 'binding', 'activation', 'channel', 'envelope',
  'task', 'attempt', 'sample', 'usage', 'action', 'source', 'message', 'header',
])

/** Session event families mapped to the spans they represent. */
function spanKind(type: string): 'model' | 'tool' | 'lifecycle' | 'input' {
  if (type === 'request/header' || type === 'assistant/chunk' || type === 'assistant/message') return 'model'
  if (type === 'tool/call' || type === 'tool/result') return 'tool'
  if (type === 'user/message' || type === 'agent/inbox/spliced') return 'input'
  return 'lifecycle'
}

/** Map a Team event's terminal/error semantics to telemetry severity. */
function teamSeverity(event: TeamEvent): TeamTelemetrySeverity {
  return event.type === 'policy/denied' ? 'warn' : 'info'
}

/** Map a channel record's explicit failure marker to telemetry severity. */
function channelSeverity(event: ChannelEvent): TeamTelemetrySeverity {
  const record = event.record as unknown as { type?: unknown; reason?: unknown }
  return record.type === 'channel/closed' && typeof record.reason === 'object' && record.reason !== null
    && (record.reason as { kind?: unknown }).kind === 'failed'
    ? 'error'
    : 'info'
}

/** Map Session outcomes to an alerting severity without interpreting plugin events. */
function sessionSeverity(event: SessionEvent): TeamTelemetrySeverity {
  if (event.type === 'turn/end' && event.data.reason.kind === 'error') return 'error'
  if (event.type === 'tool/result' && event.data.message.content[0].isError === true) return 'error'
  return 'info'
}

/** Build stable identity attributes from a known Team/Session payload. */
function correlationAttributes(value: unknown): Record<string, string | number> {
  const attributes: Record<string, string | number> = {}
  const visit = (candidate: unknown, depth: number, parent?: string): void => {
    if (depth > 3 || candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return
    for (const [key, child] of Object.entries(candidate)) {
      const outputKey = ID_KEYS[key]
      if (outputKey !== undefined && (typeof child === 'string' || typeof child === 'number')) {
        attributes[outputKey] = child
      } else if (key === 'id' && typeof child === 'string') {
        if (parent === 'team') attributes['team.id'] = child
        if (parent === 'participant') attributes['participant.id'] = child
        if (parent === 'activation') attributes['activation.id'] = child
        if (parent === 'channel') attributes['channel.id'] = child
        if (parent === 'envelope') attributes['envelope.id'] = child
        if (parent === 'task') attributes['task.id'] = child
        if (parent === 'attempt') attributes['attempt.id'] = child
      }
      if (CORRELATION_CONTAINERS.has(key)) visit(child, depth + 1, key)
    }
  }
  visit(value, 0)
  return attributes
}

/** Add the immutable Session header identity to a correlation map. */
function sessionAttributes(session: Pick<Session, 'id' | 'header'>): Record<string, string | number> {
  const attributes = correlationAttributes(session.header)
  attributes['session.id'] = String(session.id)
  const header = session.header
  if (header.cwd !== undefined) attributes['session.cwd'] = header.cwd
  if (header.agentPreset !== undefined) attributes['agent.preset'] = header.agentPreset
  return attributes
}

/** Render one post-commit Team-journal notification for export. */
function teamRecord(event: TeamEvent): TeamTelemetryRecord {
  const attributes = correlationAttributes(event)
  attributes['event.type'] = event.type
  attributes['source.cursor'] = event.type === 'team/created' || event.type === 'team/changed'
    ? event.team.cursor
    : event.cursor
  return {
    channel: 'team',
    time: event.type === 'team/created' || event.type === 'team/changed' ? event.team.updatedAt : event.createdAt,
    severity: teamSeverity(event),
    attributes,
    body: structuredClone(event),
  }
}

/** Render one post-commit channel-WAL notification for export. */
function channelRecord(event: ChannelEvent): TeamTelemetryRecord {
  const attributes = correlationAttributes(event)
  attributes['channel.id'] = String(event.channelId)
  attributes['event.type'] = event.record.type
  const cursor = event.record.type === 'channel/envelope' ? event.record.envelope.sequence : event.record.sequence
  const time = event.record.type === 'channel/envelope' ? event.record.envelope.createdAt : event.record.createdAt
  attributes['source.cursor'] = cursor
  return {
    channel: 'channel',
    time,
    severity: channelSeverity(event),
    attributes,
    body: structuredClone(event.record),
  }
}

/** Render one model/tool/lifecycle Session event with Team provenance. */
function sessionRecord(session: Session, event: SessionEvent): TeamTelemetryRecord {
  const attributes = sessionAttributes(session)
  Object.assign(attributes, correlationAttributes(event.data))
  attributes['event.type'] = event.type
  attributes['event.seq'] = event.seq
  attributes['span.kind'] = spanKind(event.type)
  return {
    channel: 'session',
    time: event.time,
    severity: sessionSeverity(event),
    attributes,
    body: structuredClone(event.data),
  }
}

/** Render a Session disposal signal, which has no durable event payload. */
function sessionDisposedRecord(session: Session): TeamTelemetryRecord {
  return {
    channel: 'ops',
    time: Date.now(),
    severity: 'info',
    attributes: { ...sessionAttributes(session), 'telemetry.op': 'session-disposed' },
    body: { op: 'session-disposed' },
  }
}

/**
 * Live Team telemetry correlator. It observes the authoritative Team/channel
 * post-commit feeds and every local Session event, preserving the exact
 * source cursor while adding Team, participant, activation, channel,
 * Envelope, task, attempt, model, and tool correlation when present.
 */
export class TeamTelemetryCoordinator {
  /** @param ctx - context whose event streams are observed. @param backend - downstream handoff sink. */
  constructor(private readonly ctx: Context, private readonly backend: TeamTelemetrySink) {
    ctx.on('team/changed', (event) => { this.contain(() => { this.deliver(teamRecord(event)) }) })
    ctx.on('channel/changed', (event) => { this.contain(() => { this.deliver(channelRecord(event)) }) })
    ctx.on('session/event', (session, event) => { this.contain(() => { this.deliver(sessionRecord(session, event)) }) })
    ctx.on('session/disposed', (session) => { this.contain(() => { this.deliver(sessionDisposedRecord(session)) }) })
    ctx.on('session/flush', () => { this.contain(() => { this.backend.flush?.() }) })
    ctx.effect(() => async () => {
      try {
        await this.backend.shutdown()
      } catch (error: unknown) {
        this.ctx.logger.warn(`team telemetry: backend shutdown failed: ${renderError(error)}`)
      }
    }, 'team telemetry capture')
  }

  /** Apply the deployment's Team telemetry waterfall and hand one record over. */
  private deliver(record: TeamTelemetryRecord): void {
    const redacted = this.ctx.waterfall('team-telemetry/record', record, () => record)
    this.backend.emit(redacted)
  }

  /** Keep one observer or backend failure from interrupting an authoritative event stream. */
  private contain(operation: () => void): void {
    try {
      operation()
    } catch (error: unknown) {
      this.ctx.logger.warn(`team telemetry: capture failed: ${renderError(error)}`)
    }
  }
}

/** Render a thrown telemetry failure without allowing diagnostics to throw again. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
