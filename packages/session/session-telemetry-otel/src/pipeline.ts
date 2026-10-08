/** Shared OTel SDK plumbing; sharing policy, capture and shutdown stay with the calling backend. */
import { APP_IDENTITY } from '@clocky/clocky-llm'
import { BatchLogRecordProcessor,LoggerProvider } from '@opentelemetry/sdk-logs'
import type { BatchLogRecordProcessorOptions } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { AnyValue,Logger,LogRecord } from '@opentelemetry/api-logs'

/** Exact fields handed to the SDK after the backend has applied its capture and privacy policy. */
export interface OtelPipelineRecord {
  readonly time: number
  readonly body: AnyValue
  readonly attributes: NonNullable<LogRecord['attributes']>
}

/** Construct the maintained SDK pipeline with complete exporter and processor passthrough.
 * @param exporter - Backend-validated exporter configuration, forwarded without field selection.
 * @param processor - Backend-validated batching configuration, forwarded without field selection.
 * @returns a backend-owned provider; the caller retains flushing and bounded shutdown.
 */
export function createOtelPipeline(
  exporter: OTLPExporterNodeConfigBase | undefined, processor: Omit<BatchLogRecordProcessorOptions, 'exporter'> | undefined,
): LoggerProvider {
  return new LoggerProvider({ resource: resourceFromAttributes({
    'service.name': APP_IDENTITY.product, 'service.version': APP_IDENTITY.version,
  }), processors: [new BatchLogRecordProcessor({ ...processor, exporter: new OTLPLogExporter(exporter) })] })
}

/** Emit one already-authorized record using the backend's severity mapping and instrumentation scope.
 * @param logger - Backend-selected ledger or operations logger.
 * @param record - JSON-compatible captured body and attributes with its source timestamp.
 * @param severity - Backend-owned numeric and textual severity mapping.
 */
export function emitOtelRecord(
  logger: Logger, record: OtelPipelineRecord, severity: Pick<LogRecord,'severityNumber'|'severityText'>,
): void {
  logger.emit({ timestamp: record.time, observedTimestamp: record.time, ...severity,
    body: record.body, attributes: record.attributes })
}
