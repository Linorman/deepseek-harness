import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bridge } from '../src/http-bridge.ts'

describe('HTTP bridge abort', () => {
  it('drains an authenticated long request when its owner shuts down even while the socket remains connected', async () => {
    const owner = new AbortController()
    const started = Promise.withResolvers<undefined>()
    const ended = Promise.withResolvers<undefined>()
    let carrierSignal: AbortSignal | undefined
    const server = createServer((req, res) => {
      void bridge(req, res, { async fetch(request) {
        carrierSignal = request.signal
        started.resolve(undefined)
        await new Promise<undefined>((resolve) => {
          request.signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
        })
        return new Response(null, { status: 204 })
      } }, 1024, owner.signal).then(() => { ended.resolve(undefined) }, ended.reject)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port')
    const response = fetch(`http://127.0.0.1:${address.port}/api/team.watch`).catch((error: unknown) => error)
    try {
      await started.promise
      owner.abort()
      await expect.poll(() => carrierSignal?.aborted).toBe(true)
      await ended.promise
      expect(await response).toBeInstanceOf(Error)
    } finally {
      server.closeAllConnections()
      await new Promise<undefined>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve(undefined) })
      })
      await response
    }
  })

  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })
})
