import WebSocket, { WebSocketServer } from 'ws'
import {
  parseTeamLinkClientFrame,
} from '@clocky/clocky-team-link'
import type {
  TeamLinkClientFrame,
  TeamLinkServerFrame,
} from '@clocky/clocky-team-link'

/** Minimal framed WebSocket peer used to test the remote client without a Hub. */
export class TestWebSocketPeer {
  readonly endpoint: string
  private readonly server: WebSocketServer
  private readonly accepted = Promise.withResolvers<WebSocket>()
  private hasAccepted = false

  private constructor(server: WebSocketServer, endpoint: string) {
    this.server = server
    this.endpoint = endpoint
    server.on('connection', (socket) => {
      if (this.hasAccepted) {
        socket.terminate()
        return
      }
      this.hasAccepted = true
      this.accepted.resolve(socket)
    })
  }

  /** Start one loopback peer and expose its `ws:` endpoint. */
  static async create(): Promise<TestWebSocketPeer> {
    const server = new WebSocketServer({ port: 0, perMessageDeflate: false })
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test WebSocket peer did not expose a TCP address')
    return new TestWebSocketPeer(server, `ws://127.0.0.1:${String(address.port)}`)
  }

  /** Await the single client connection. */
  async accept(): Promise<WebSocket> {
    return await this.accepted.promise
  }

  /** Close every test peer socket and its listener. */
  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error == null) resolve()
        else reject(error)
      })
    })
  }
}

class ClientFrameInbox {
  private readonly frames: TeamLinkClientFrame[] = []
  private readonly waiters: PromiseWithResolvers<TeamLinkClientFrame>[] = []
  private failure: unknown

  constructor(socket: WebSocket) {
    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (this.failure !== undefined) return
      try {
        if (isBinary) throw new Error('test peer received an unexpected binary client frame')
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8')
        this.push(parseTeamLinkClientFrame(JSON.parse(text)))
      } catch (error: unknown) {
        this.stop(error)
      }
    })
    socket.once('error', (error: Error) => { this.stop(error) })
    socket.once('close', () => { this.stop(new Error('test peer socket closed before a client frame arrived')) })
  }

  next(): Promise<TeamLinkClientFrame> {
    const frame = this.frames.shift()
    if (frame !== undefined) return Promise.resolve(frame)
    if (this.failure !== undefined) {
      return Promise.reject(this.failure instanceof Error ? this.failure : new Error('test peer failed before a client frame arrived'))
    }
    const waiter = Promise.withResolvers<TeamLinkClientFrame>()
    this.waiters.push(waiter)
    return waiter.promise
  }

  private push(frame: TeamLinkClientFrame): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.frames.push(frame)
    else waiter.resolve(frame)
  }

  private stop(error: unknown): void {
    if (this.failure !== undefined) return
    this.failure = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }
}

const inboxes = new WeakMap<WebSocket, ClientFrameInbox>()

/** Receive and strictly parse one client frame. */
export async function receiveFrame(socket: WebSocket): Promise<TeamLinkClientFrame> {
  let inbox = inboxes.get(socket)
  if (inbox === undefined) {
    inbox = new ClientFrameInbox(socket)
    inboxes.set(socket, inbox)
  }
  return await inbox.next()
}

/** Send one framed server message. */
export async function sendFrame(socket: WebSocket, frame: TeamLinkServerFrame): Promise<void> {
  await sendRaw(socket, JSON.stringify(frame))
}

/** Send one raw server payload for malformed-frame tests. */
export async function sendRaw(socket: WebSocket, value: string | Buffer, binary = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.send(value, { binary, compress: false }, (error) => {
      if (error == null) resolve()
      else reject(error)
    })
  })
}
