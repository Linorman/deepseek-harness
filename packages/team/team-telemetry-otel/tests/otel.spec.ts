import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import OpenTelemetryTeamBackend, {
  Config,
  DEFAULT_TEAM_TELEMETRY_MODE,
  TeamTelemetryMode,
} from '../src/index.ts'

interface Capture {
  body: {
    resourceLogs: {
      scopeLogs: {
        scope: { name: string }
        logRecords: {
          attributes?: { key: string; value: Record<string, unknown> }[]
        }[]
      }[]
    }[]
  }
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
  }
})

async function collector(
  beforeRespond?: (requestIndex: number) => Promise<void> | void,
): Promise<{ url: string; captures: Capture[] }> {
  const captures: Capture[] = []
  let requestIndex = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      void (async () => {
        await beforeRespond?.(requestIndex++)
        const raw = Buffer.concat(chunks)
        const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
        captures.push({ body: JSON.parse(body.toString()) as Capture['body'] })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })()
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('collector has no address')
  return { url: `http://127.0.0.1:${String(address.port)}/v1/logs`, captures }
}

function records(captures: Capture[]) {
  return captures.flatMap(capture => capture.body.resourceLogs.flatMap(resource => resource.scopeLogs.flatMap(scope =>
    scope.logRecords.map(record => ({ scope: scope.scope.name, record })))))
}

describe('OpenTelemetryTeamBackend wire', () => {
  it('exports direct records and a configurable alert crossing through the real OTLP pipeline', async () => {
    const { url, captures } = await collector()
    const ctx = new Context()
    const fiber = await ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url },
      alerts: [
        { name: 'two-errors', threshold: 2, windowMillis: 1_000 },
        { name: 'team-signal', channel: 'team', threshold: 1, windowMillis: 1_000 },
      ],
    })
    const record = {
      channel: 'session' as const,
      time: Date.now(),
      severity: 'error' as const,
      attributes: { 'event.type': 'turn/end', 'team.id': 'team-1' },
      body: { error: 'boom' },
    }
    ctx.teamTelemetry.emit(record)
    ctx.teamTelemetry.emit({ ...record, time: record.time + 1 })
    ctx.teamTelemetry.emit({ channel: 'ops', time: record.time + 2, severity: 'info', attributes: { 'telemetry.op': 'alert' }, body: null })
    ctx.teamTelemetry.emit({ channel: 'team', time: record.time + 3, severity: 'warn', attributes: {}, body: null })
    await fiber.dispose()

    const all = records(captures)
    expect(all.length).toBeGreaterThanOrEqual(4)
    expect(all.some(({ record: item }) => item.attributes?.some(attribute =>
      attribute.key === 'event.type' && attribute.value.stringValue === 'turn/end'))).toBe(true)
    const alert = all.find(({ scope, record: item }) =>
      scope.endsWith('/ops') && item.attributes?.some(attribute =>
        attribute.key === 'alert.name' && attribute.value.stringValue === 'two-errors'))
    expect(alert).toBeDefined()
    expect(alert?.record.attributes).toContainEqual({ key: 'team.id', value: { stringValue: 'team-1' } })
    expect(all.some(({ scope, record: item }) =>
      scope.endsWith('/ops') && item.attributes?.some(attribute =>
        attribute.key === 'telemetry.op' && attribute.value.stringValue === 'shutdown'))).toBe(true)
  })

  it('constructs no transport in disabled mode and exposes the default config', async () => {
    const { captures } = await collector()
    const ctx = new Context()
    const fiber = await ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.DISABLED,
      exporter: { url: 'not-a-url' },
    })
    ctx.teamTelemetry.emit({ channel: 'ops', time: 0, severity: 'info', attributes: {}, body: null })
    await ctx.teamTelemetry.shutdown()
    await fiber.dispose()
    expect(captures).toEqual([])
    expect(Config({}).mode).toBe(DEFAULT_TEAM_TELEMETRY_MODE)
  })

  it('defaults direct construction to disabled delivery', async () => {
    const ctx = new Context()
    const backend = new OpenTelemetryTeamBackend(ctx, {})
    backend.emit({ channel: 'ops', time: 0, severity: 'info', attributes: {}, body: null })
    await ctx.fiber.dispose()
  })

  it('drains a directly constructed full backend idempotently', async () => {
    const { url, captures } = await collector()
    const ctx = new Context()
    const backend = new OpenTelemetryTeamBackend(ctx, { mode: TeamTelemetryMode.FULL, exporter: { url } })
    backend.emit({ channel: 'session', time: Date.now(), severity: 'info', attributes: {}, body: null })
    await backend.shutdown()
    await ctx.fiber.dispose()
    expect(captures.length).toBeGreaterThan(0)
  })

  it('bounds an in-flight SDK export during shutdown and keeps the late promise observed', async () => {
    const gate = Promise.withResolvers<boolean>()
    const arrived = Promise.withResolvers<boolean>()
    const { url, captures } = await collector(async (index) => {
      if (index === 0) {
        arrived.resolve(true)
        await gate.promise
      }
    })
    const ctx = new Context()
    const fiber = await ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url, timeoutMillis: 60_000 },
      processor: { scheduledDelayMillis: 10, exportTimeoutMillis: 60_000 },
      shutdownTimeoutMillis: 50,
    })
    ctx.teamTelemetry.emit({ channel: 'session', time: Date.now(), severity: 'info', attributes: {}, body: null })
    await arrived.promise
    const started = performance.now()
    await expect(ctx.teamTelemetry.shutdown()).rejects.toThrow(/exceeded 50ms/)
    await fiber.dispose()
    expect(performance.now() - started).toBeLessThan(1_000)
    gate.resolve(true)
    await expect.poll(() => captures.length).toBeGreaterThanOrEqual(2)
  })
})

describe('OpenTelemetryTeamBackend configuration and load path', () => {
  it('rejects transport errors before SDK setup', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(OpenTelemetryTeamBackend, { mode: TeamTelemetryMode.FULL }))
      .rejects.toThrow(/exporter\.url is required/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'ftp://collector' },
    })).rejects.toThrow(/must be http\(s\)/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'http://collector' },
      alerts: [{ name: 'bad', threshold: 0, windowMillis: 1 }],
    })).rejects.toThrow(/threshold/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'not a url' },
    })).rejects.toThrow(/not a valid URL/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'http://collector' },
      processor: { maxExportBatchSize: 0 },
    })).rejects.toThrow(/maxExportBatchSize/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'http://collector' },
      processor: { maxExportBatchSize: 0.5 },
    })).rejects.toThrow(/maxExportBatchSize/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'http://collector' },
      shutdownTimeoutMillis: 0,
    })).rejects.toThrow(/shutdownTimeoutMillis/)
    await expect(ctx.plugin(OpenTelemetryTeamBackend, {
      mode: TeamTelemetryMode.FULL,
      exporter: { url: 'http://collector' },
      shutdownTimeoutMillis: Number.POSITIVE_INFINITY,
    })).rejects.toThrow(/shutdownTimeoutMillis/)
  })

  it('rejects an unknown direct mode before reading transport configuration', () => {
    const ctx = new Context()
    let exporterRead = false
    const config = {
      mode: 'INVALID',
      get exporter() {
        exporterRead = true
        throw new Error('transport config was read')
      },
    } as unknown as Config
    expect(() => new OpenTelemetryTeamBackend(ctx, config)).toThrow(/unsupported mode/)
    expect(exporterRead).toBe(false)
  })

  it('keeps the Service class and its Config through the loader unwrap path', async () => {
    const module = await import('../src/index.ts')
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(module) as typeof OpenTelemetryTeamBackend
    expect(unwrapped).toBe(OpenTelemetryTeamBackend)
    expect(unwrapped.inject).toEqual([])
    expect(typeof unwrapped.Config).toBe('function')
    expectTypeOf<Config['mode']>().toEqualTypeOf<TeamTelemetryMode | undefined>()
  })
})
