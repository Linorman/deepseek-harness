/**
 * OpenTelemetry Service Provider for the Team telemetry capability.
 *
 * The provider composes the OTel JS SDK's logger pipeline as-is and maps the
 * detached records produced by {@link TeamTelemetryCoordinator} to OTLP/HTTP
 * logs. Optional alert rules are evaluated locally before their threshold
 * crossings are emitted as `ops` records. The Team Hub remains authoritative;
 * batching, retry, queueing, and transport loss belong to the SDK provider.
 *
 * @module @clocky/clocky-team-telemetry-otel
 */

import { createRequire } from 'node:module'
import z from '@clocky/schemastery'
import type { Context } from '@clocky/cordis'
import {
  TeamTelemetryBackend,
  TeamTelemetryCoordinator,
  type TeamTelemetryRecord,
  type TeamTelemetrySeverity,
  type TeamTelemetrySink,
} from '@clocky/clocky-team'
import { APP_IDENTITY } from '@clocky/clocky-llm'
import {
  TeamTelemetryAlertPolicy,
  type TeamTelemetryAlert,
  type TeamTelemetryAlertRule,
} from './alerts.ts'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type BatchLogRecordProcessorOptions,
} from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { SeverityNumber, type AnyValue, type Logger } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/** Whether the provider constructs and exports an SDK pipeline. */
export enum TeamTelemetryMode {
  FULL = 'FULL',
  DISABLED = 'DISABLED',
}

/** Default mode: loading an optional provider never shares Team data implicitly. */
export const DEFAULT_TEAM_TELEMETRY_MODE = TeamTelemetryMode.DISABLED

/**
 * Provider configuration. SDK exporter and processor objects pass through
 * unchanged; this provider validates the URL and the outer shutdown bound.
 */
export interface Config {
  /** Sharing mode; defaults to {@link TeamTelemetryMode.DISABLED}. */
  readonly mode?: TeamTelemetryMode
  /** OTLP/HTTP logs exporter options. `url` is required in `FULL` mode. */
  readonly exporter?: OTLPExporterNodeConfigBase & {
    /** Full OTLP logs endpoint; required in `FULL` mode. */
    readonly url?: string
  }
  /** Batch processor options, excluding the provider-created exporter. */
  readonly processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum outer wait for the complete SDK shutdown sequence. */
  readonly shutdownTimeoutMillis?: number
  /** Optional threshold rules that emit `ops` alert records on crossings. */
  readonly alerts?: readonly TeamTelemetryAlertRule[]
}

/** Schemastery validator for the provider's top-level options. */
export const Config: z<Config> = z.object({
  mode: z.union(Object.values(TeamTelemetryMode)).default(DEFAULT_TEAM_TELEMETRY_MODE),
  exporter: z.any(),
  processor: z.any(),
  shutdownTimeoutMillis: z.number(),
  alerts: z.any(),
})

/** Default outer allowance for the SDK's complete shutdown sequence. */
export const DEFAULT_TEAM_TELEMETRY_SHUTDOWN_TIMEOUT_MILLIS = 3_000

// Node clamps larger timer delays to one millisecond. This is a runtime limit.
const MAX_TIMER_DELAY_MILLIS = 2_147_483_647
const DROP_RECORD: TeamTelemetrySink['emit'] = () => {}

/** Map the seam's severity vocabulary to OTel severity numbers. */
const SEVERITY: Record<TeamTelemetrySeverity, { severityNumber: SeverityNumber; severityText: string }> = {
  info: { severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warn: { severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
}

/** Resolve and fail closed on direct-construction mode values. */
function resolveMode(mode: TeamTelemetryMode | undefined): TeamTelemetryMode {
  const resolved = mode ?? DEFAULT_TEAM_TELEMETRY_MODE
  switch (resolved) {
    case TeamTelemetryMode.FULL:
    case TeamTelemetryMode.DISABLED:
      return resolved
    default:
      throw new Error(`team-telemetry-otel: unsupported mode ${JSON.stringify(resolved)}`)
  }
}

/** Convert one threshold crossing into an exportable operational record. */
function alertRecord(alert: TeamTelemetryAlert): TeamTelemetryRecord {
  const attributes: Record<string, string | number> = {
    'telemetry.op': 'alert',
    'alert.name': alert.ruleName,
    'alert.count': alert.count,
    'alert.threshold': alert.threshold,
    'alert.window.ms': alert.windowMillis,
  }
  const eventType = alert.source.attributes['event.type']
  if (eventType !== undefined) attributes['alert.event.type'] = eventType
  for (const [key, value] of Object.entries(alert.source.attributes)) {
    if (key.endsWith('.id') || key === 'model.provider' || key === 'model.name') attributes[key] = value
  }
  return {
    channel: 'ops',
    time: alert.observedAt,
    severity: 'error',
    attributes,
    body: {
      op: 'alert',
      rule: alert.ruleName,
      source: structuredClone(alert.source),
    },
  }
}

/**
 * OTel Team backend. `DISABLED` creates no SDK objects and no capture
 * coordinator; `FULL` registers the coordinator after transport validation.
 */
export class OpenTelemetryTeamBackend extends TeamTelemetryBackend {
  static inject: readonly string[] = []
  static Config = Config

  private readonly directEmit: TeamTelemetrySink['emit']
  private readonly provider: LoggerProvider | undefined
  private readonly shutdownTimeoutMillis: number
  private shutdownPromise: Promise<void> | undefined

  /**
   * @param ctx - Cordis context whose Team telemetry service this instance owns.
   * @param config - validated plugin configuration, or direct-construction options.
   */
  constructor(ctx: Context, config: Config) {
    const mode = resolveMode(config.mode)
    super(ctx)
    if (mode === TeamTelemetryMode.DISABLED) {
      this.directEmit = DROP_RECORD
      this.provider = undefined
      this.shutdownTimeoutMillis = DEFAULT_TEAM_TELEMETRY_SHUTDOWN_TIMEOUT_MILLIS
      return
    }

    const url = config.exporter?.url
    if (url === undefined || url.length === 0) {
      throw new Error('team-telemetry-otel: exporter.url is required (the full OTLP logs endpoint)')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`team-telemetry-otel: exporter.url is not a valid URL: ${JSON.stringify(url)}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`team-telemetry-otel: exporter.url must be http(s), got ${parsed.protocol}`)
    }
    const batchSize = config.processor?.maxExportBatchSize
    if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
      throw new Error(`team-telemetry-otel: processor.maxExportBatchSize must be a positive integer, got ${String(batchSize)}`)
    }
    const shutdownTimeoutMillis = config.shutdownTimeoutMillis ?? DEFAULT_TEAM_TELEMETRY_SHUTDOWN_TIMEOUT_MILLIS
    if (!Number.isFinite(shutdownTimeoutMillis) || shutdownTimeoutMillis <= 0 || shutdownTimeoutMillis > MAX_TIMER_DELAY_MILLIS) {
      throw new Error(`team-telemetry-otel: shutdownTimeoutMillis must be a positive finite number no greater than ${MAX_TIMER_DELAY_MILLIS}, got ${String(shutdownTimeoutMillis)}`)
    }
    this.shutdownTimeoutMillis = shutdownTimeoutMillis
    const alertPolicy = new TeamTelemetryAlertPolicy(config.alerts)
    this.provider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': APP_IDENTITY.product,
        'service.version': APP_IDENTITY.version,
      }),
      processors: [
        new BatchLogRecordProcessor({
          ...config.processor,
          exporter: new OTLPLogExporter(config.exporter),
        }),
      ],
    })
    const ledger = this.provider.getLogger('@clocky/clocky-team-telemetry-otel', version)
    const ops = this.provider.getLogger('@clocky/clocky-team-telemetry-otel/ops', version)
    const enqueue: TeamTelemetrySink['emit'] = (record) => {
      const logger: Logger = record.channel === 'ops' ? ops : ledger
      logger.emit({
        timestamp: record.time,
        observedTimestamp: record.time,
        ...SEVERITY[record.severity],
        body: record.body as AnyValue,
        attributes: record.attributes,
      })
      if (record.channel === 'ops' && record.attributes['telemetry.op'] === 'alert') return
      for (const alert of alertPolicy.observe(record)) {
        const emitted = alertRecord(alert)
        ops.emit({
          timestamp: emitted.time,
          observedTimestamp: emitted.time,
          ...SEVERITY[emitted.severity],
          body: emitted.body as AnyValue,
          attributes: emitted.attributes,
        })
      }
    }
    this.directEmit = enqueue
    const backend: TeamTelemetrySink = { emit: enqueue, shutdown: () => this.shutdown() }
    new TeamTelemetryCoordinator(ctx, backend)
  }

  /** Hand one detached direct record into the configured OTel pipeline. */
  emit(record: TeamTelemetryRecord): void {
    this.directEmit(record)
  }

  /**
   * Drain the SDK provider under an outer deadline. The underlying promise
   * stays observed after timeout so a late transport failure is not unhandled.
   * @returns completion after shutdown or rejection at the outer deadline.
   */
  async shutdown(): Promise<void> {
    if (this.provider === undefined) return
    this.shutdownPromise ??= this.shutdownProvider(this.provider)
    await this.shutdownPromise
  }

  /** Execute the single SDK shutdown sequence shared by explicit and fiber disposal. */
  private async shutdownProvider(provider: LoggerProvider): Promise<void> {
    const ops = provider.getLogger('@clocky/clocky-team-telemetry-otel/ops', version)
    const time = Date.now()
    ops.emit({
      timestamp: time,
      observedTimestamp: time,
      ...SEVERITY.info,
      body: { op: 'shutdown' },
      attributes: { 'telemetry.op': 'shutdown' },
    })
    const providerShutdown = provider.shutdown()
    const deadline = Promise.withResolvers<never>()
    const timer = setTimeout(() => {
      deadline.reject(new Error(`team-telemetry-otel: provider shutdown exceeded ${this.shutdownTimeoutMillis}ms`))
    }, this.shutdownTimeoutMillis)
    try {
      await Promise.race([providerShutdown, deadline.promise])
    } finally {
      clearTimeout(timer)
    }
  }
}

export { TeamTelemetryAlertPolicy }
export type { TeamTelemetryAlert, TeamTelemetryAlertRule }
export default OpenTelemetryTeamBackend
