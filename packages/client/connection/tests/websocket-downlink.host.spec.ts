import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@clocky/clocky-host-apiproxy/api'
import { RpcId, PRODUCT_AUTHENTICATION_RETIRED_CLOSE_CODE } from '@clocky/clocky-host-apiproxy/api'
import { currentAuthenticatedProductCall } from '@clocky/clocky-host-apiproxy'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../src/api-path.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from '../src/websocket-downlink.ts'

type MuxSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<MuxFrame>>
type HostSource = (signal: AbortSignal) => AsyncIterable<RpcRequest<HostFrame>>

const running: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(close => close()))
})

function untilAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

async function * idle<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
  await untilAbort(signal)
}

function api(mux: MuxSource, host: HostSource): ApiProxy {
  return {
    events: {
      mux: (_request, signal) => mux(signal),
      host: (_request, signal) => host(signal),
    },
  } as ApiProxy
}

async function serve(downlinks: WebSocketDownlinks, productSignal?: AbortSignal): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const server = createServer()
  const call: AuthenticatedProductCall | undefined = productSignal === undefined ? undefined
    : { principal: { id: 'ws-principal' as never, issuer: 'test', subject: 'user', assurance: 'test', credentialGeneration: 1 },
      credentialGeneration: 1, signal: productSignal }
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://clocky.internal').pathname
    if (pathname === MUX_EVENTS_PATH) void downlinks.handleMux(request, socket, head, call)
    else if (pathname === HOST_EVENTS_PATH) void downlinks.handleHost(request, socket, head, call)
    else socket.destroy()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: `ws://127.0.0.1:${String(port)}`,
    close: async () => {
      await downlinks.close()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}

function read(socket: WebSocket): Promise<ServerRequest> {
  return once(socket, 'message').then(([data]) => JSON.parse(String(data)) as ServerRequest)
}

async function acceptedSocket(downlinks: WebSocketDownlinks): Promise<WebSocket> {
  const server = (downlinks as unknown as { server: { clients: Set<WebSocket> } }).server
  let accepted: WebSocket | undefined
  await vi.waitFor(() => {
    accepted = server.clients.values().next().value
    expect(accepted).toBeDefined()
  })
  return accepted as WebSocket
}

function productCall(signal: AbortSignal): AuthenticatedProductCall {
  return { principal: { id: 'ws-principal' as never, issuer: 'test', subject: 'user', assurance: 'test', credentialGeneration: 1 },
    credentialGeneration: 1, signal }
}

function acceptor(downlinks: WebSocketDownlinks): WebSocketServer {
  return (downlinks as unknown as { server: WebSocketServer }).server
}

function fakeRequest(): IncomingMessage { return { url: MUX_EVENTS_PATH } as IncomingMessage }

describe('WebSocket downlinks', () => {
  it('opens both event sources under the authenticated product principal', async () => {
    const seen: (AuthenticatedProductCall | undefined)[] = []
    const source = api(idle, idle)
    source.events.mux = (_request, signal) => { seen.push(currentAuthenticatedProductCall()); return idle(signal) }
    source.events.host = (_request, signal) => { seen.push(currentAuthenticatedProductCall()); return idle(signal) }
    const productAuth = new AbortController()
    const host = await serve(new WebSocketDownlinks(source), productAuth.signal)
    running.push(host.close)
    const mux = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    const info = new WebSocket(`${host.origin}${HOST_EVENTS_PATH}`)
    await Promise.all([once(mux, 'open'), once(info, 'open')])
    await vi.waitFor(() => { expect(seen).toHaveLength(2) })
    expect(seen.map(call => call?.principal.id)).toEqual(['ws-principal', 'ws-principal'])
    expect(seen.every(call => call?.signal === productAuth.signal)).toBe(true)
    expect(currentAuthenticatedProductCall()).toBeUndefined()
    const closed = Promise.all([once(mux, 'close'), once(info, 'close')])
    mux.close(); info.close()
    await closed
  })

  it('carries mux and host over independent downstream sockets and cancels each source on close', async () => {
    let muxAborted = false
    let hostAborted = false
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          yield {
            rpcId: RpcId('mux-1'),
            payload: { type: 'session/subscribed', sessionId: 'session-1' as never, lastSeq: 4 },
          }
          await untilAbort(signal)
        } finally {
          muxAborted = true
        }
      },
      async function * (signal) {
        try {
          yield { rpcId: RpcId('host-1'), payload: { type: 'host/remote-event', event: 'commands/change', args: [] } }
          await untilAbort(signal)
        } finally {
          hostAborted = true
        }
      },
    ))
    const host = await serve(downlinks)
    running.push(host.close)

    const mux = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    const hostSocket = new WebSocket(`${host.origin}${HOST_EVENTS_PATH}`)
    const muxFrame = read(mux)
    const hostFrame = read(hostSocket)
    expect(await muxFrame).toEqual({
      type: 'server-request',
      rpcId: 'mux-1',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 4 },
    })
    expect(await hostFrame).toEqual({
      type: 'server-request',
      rpcId: 'host-1',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })

    const muxClosed = once(mux, 'close')
    const hostClosed = once(hostSocket, 'close')
    mux.close()
    hostSocket.close()
    await Promise.all([muxClosed, hostClosed])
    await vi.waitFor(() => {
      expect(muxAborted).toBe(true)
      expect(hostAborted).toBe(true)
    })
  })

  it('rejects client messages because upstream remains HTTP', async () => {
    let aborted = false
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          aborted = true
        }
      },
      idle,
    ))
    const host = await serve(downlinks)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    const closed = once(socket, 'close')
    socket.send('upstream payload')
    const [code, reason] = await closed as [number, Buffer]
    expect(code).toBe(1008)
    expect(String(reason)).toBe('downlink only')
    await vi.waitFor(() => { expect(aborted).toBe(true) })
  })

  it('sends stream/error before closing when a source fails', async () => {
    const downlinks = new WebSocketDownlinks(api(
      async function * () {
        throw new Error('mux source failed')
      },
      idle,
    ))
    const host = await serve(downlinks)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    const failure = read(socket)
    const closed = once(socket, 'close')
    expect((await failure).payload).toEqual({
      type: 'stream/error',
      error: { code: 'internal', message: 'Error: mux source failed', details: {} },
    })
    await closed
  })

  it('aborts the source when an accepted socket reports a transport error', async () => {
    let aborted = false
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          aborted = true
        }
      },
      idle,
    ))
    const host = await serve(downlinks)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    const accepted = await acceptedSocket(downlinks)
    const closed = once(socket, 'close')
    accepted.emit('error', new Error('transport failed'))
    await closed
    expect(aborted).toBe(true)
  })

  it('terminates an admitted downlink when its product-auth call is revoked', async () => {
    let aborted = false
    const productAuth = new AbortController()
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          aborted = true
        }
      },
      idle,
    ))
    const host = await serve(downlinks, productAuth.signal)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    const closed = once(socket, 'close')
    productAuth.abort()
    const closedEvent: unknown[] = await closed
    expect(closedEvent[0]).toBe(PRODUCT_AUTHENTICATION_RETIRED_CLOSE_CODE)
    expect(aborted).toBe(true)
  })

  it('rejects an upgrade before ws negotiation when its product-auth call is already revoked', async () => {
    let opened = false
    const productAuth = new AbortController()
    productAuth.abort()
    const downlinks = new WebSocketDownlinks(api(
      async function * () {
        opened = true
      },
      idle,
    ))
    const host = await serve(downlinks, productAuth.signal)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    socket.on('error', () => {})
    await new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    expect(opened).toBe(false)
  })

  it('drops a source frame that races after the client has closed', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    let sourceSignal: AbortSignal | undefined
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        sourceSignal = signal
        try {
          await gate
          yield {
            rpcId: RpcId('late'),
            payload: { type: 'session/subscribed', sessionId: 'session-late' as never, lastSeq: 0 },
          }
        } finally {
          finish()
        }
      },
      idle,
    ))
    const host = await serve(downlinks)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    const closed = once(socket, 'close')
    socket.close()
    await closed
    await vi.waitFor(() => { expect(sourceSignal?.aborted).toBe(true) })
    release()
    await finished
  })

  it('contains socket send callback failures and closes the downlink', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const downlinks = new WebSocketDownlinks(api(
      async function * () {
        await gate
        yield {
          rpcId: RpcId('send-failure'),
          payload: { type: 'session/subscribed', sessionId: 'session-send' as never, lastSeq: 0 },
        }
      },
      idle,
    ))
    const host = await serve(downlinks)
    running.push(host.close)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    const accepted = await acceptedSocket(downlinks)
    const send = vi.spyOn(accepted, 'send').mockImplementation(((
      _data: unknown,
      optionsOrCallback?: unknown,
      callback?: (error?: Error) => void,
    ) => {
      const done = typeof optionsOrCallback === 'function'
        ? optionsOrCallback as (error?: Error) => void
        : callback
      done?.(new Error('socket send failed'))
    }) as WebSocket['send'])
    const closed = once(socket, 'close')
    release()
    await closed
    expect(send).toHaveBeenCalledTimes(2)
    send.mockRestore()
  })

  it('rejects when its acceptor has already closed', async () => {
    const downlinks = new WebSocketDownlinks(api(idle, idle))
    await downlinks.close()
    await expect(downlinks.close()).rejects.toThrow('The server is not running')
  })

  it('waits for source cleanup before teardown resolves', async () => {
    let cleanupStarted!: () => void
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve })
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve })
    let cleaned = false
    const downlinks = new WebSocketDownlinks(api(
      async function * (signal) {
        try {
          await untilAbort(signal)
        } finally {
          cleanupStarted()
          await cleanupGate
          cleaned = true
        }
      },
      idle,
    ))
    const host = await serve(downlinks)
    const socket = new WebSocket(`${host.origin}${MUX_EVENTS_PATH}`)
    await once(socket, 'open')
    let closed = false
    const closing = host.close().then(() => { closed = true })
    try {
      await started
      expect(closed).toBe(false)
      releaseCleanup()
      await closing
      expect(cleaned).toBe(true)
    } finally {
      releaseCleanup()
      await closing
    }
  })

  it('destroys an upgrade socket when product authentication retires before negotiation', async () => {
    const authentication = new AbortController()
    const downlinks = new WebSocketDownlinks(api(idle, idle))
    const handleUpgrade = vi.spyOn(acceptor(downlinks), 'handleUpgrade').mockImplementation(() => {})
    const socket = new PassThrough()
    const destroy = vi.spyOn(socket, 'destroy')
    try {
      const pending = downlinks.handleMux(fakeRequest(), socket, Buffer.alloc(0), productCall(authentication.signal))
      expect(handleUpgrade).toHaveBeenCalledOnce()
      authentication.abort()
      await pending
      expect(destroy).toHaveBeenCalledOnce()
    } finally {
      handleUpgrade.mockRestore()
    }
  })

  it('terminates a late upgrade callback after authentication retired', async () => {
    const authentication = new AbortController()
    const downlinks = new WebSocketDownlinks(api(idle, idle))
    let accept!: (socket: WebSocket) => void
    const handleUpgrade = vi.spyOn(acceptor(downlinks), 'handleUpgrade').mockImplementation((request, _socket, _head, callback) => {
      accept = (socket) => { callback(socket, request) }
    })
    const socket = new PassThrough()
    const terminate = vi.fn()
    const accepted = Object.assign(new EventEmitter(), { terminate }) as unknown as WebSocket
    try {
      const pending = downlinks.handleMux(fakeRequest(), socket, Buffer.alloc(0), productCall(authentication.signal))
      authentication.abort()
      await pending
      accept(accepted)
      expect(terminate).toHaveBeenCalledOnce()
    } finally {
      handleUpgrade.mockRestore()
    }
  })

  it.each([new Error('upgrade failed'), 'upgrade failed'])('normalizes a synchronous upgrade failure %s', async (failure) => {
    const downlinks = new WebSocketDownlinks(api(idle, idle))
    const handleUpgrade = vi.spyOn(acceptor(downlinks), 'handleUpgrade').mockImplementation(() => { throw failure })
    try {
      await expect(downlinks.handleMux(fakeRequest(), new PassThrough(), Buffer.alloc(0))).rejects.toThrow('upgrade failed')
    } finally {
      handleUpgrade.mockRestore()
    }
  })

  it.each([new Error('socket close failed'), 'socket close failed'])('settles a pump rejection after socket close fails %s', async (failure) => {
    const downlinks = new WebSocketDownlinks(api(async function * () {}, idle))
    const accepted = Object.assign(new EventEmitter(), {
      readyState: WebSocket.OPEN,
      close: vi.fn(() => { throw failure }),
    }) as unknown as WebSocket
    const handleUpgrade = vi.spyOn(acceptor(downlinks), 'handleUpgrade').mockImplementation((request, _socket, _head, callback) => {
      callback(accepted, request)
    })
    try {
      await expect(downlinks.handleMux(fakeRequest(), new PassThrough(), Buffer.alloc(0))).rejects.toThrow('socket close failed')
    } finally {
      handleUpgrade.mockRestore()
    }
  })

  it('rejects a disallowed upgrade before WebSocket negotiation', async () => {
    const socket = new PassThrough()
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    const ended = once(socket, 'end')
    rejectWebSocketUpgrade(socket)
    await ended
    expect(Buffer.concat(chunks).toString('utf8')).toBe('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 9\r\n\r\nforbidden')
  })
})
