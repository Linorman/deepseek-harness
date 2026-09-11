/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/** Transport-independent request handler consumed by the Host HTTP bridge. */
export interface FetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport bridge.
   * @returns complete or streaming Fetch response.
   */
  fetch(request: Request): Promise<Response>
}

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; SSE bodies stream out chunk by chunk).
 * @param req - incoming node:http request (fully read before dispatch).
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
 * @param ownerSignal - transport authentication or carrier shutdown; aborts admitted long-running requests.
 */
export async function bridge(
  req: IncomingMessage,
  res: ServerResponse,
  apiHandler: FetchHandler,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
  ownerSignal?: AbortSignal,
): Promise<void> {
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort every SSE
  // stream right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  const onClose = (): void => {
    if (!res.writableEnded) abort.abort()
  }
  const onOwnerAbort = (): void => {
    abort.abort(ownerSignal?.reason)
    req.destroy()
    res.destroy()
  }
  res.on('close', onClose)
  ownerSignal?.addEventListener('abort', onOwnerAbort, { once: true })
  try {
    if (ownerSignal?.aborted) { onOwnerAbort(); return }
    await forward(req, res, apiHandler, maxRequestBodyBytes, abort.signal)
  } catch (error: unknown) {
    if (!abort.signal.aborted || (error !== abort.signal.reason && !(error instanceof Error && error.name === 'AbortError'))) throw error
  } finally {
    res.off('close', onClose)
    ownerSignal?.removeEventListener('abort', onOwnerAbort)
  }
}

/** Forward a bounded body and stream its response while the bridge retains cancellation ownership. */
async function forward(
  req: IncomingMessage, res: ServerResponse, apiHandler: FetchHandler, maxRequestBodyBytes: number, signal: AbortSignal,
): Promise<void> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > maxRequestBodyBytes) {
    res.writeHead(413, { connection: 'close' })
    res.end()
    req.destroy()
    return
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    received += buffer.byteLength
    if (received > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    chunks.push(buffer)
  }
  /* v8 ignore next 3 -- `??` arms: node:http always sets url/method on server
  requests; the fields are only optional on the client-side IncomingMessage type */
  const request = new Request(new URL(req.url ?? '/', 'http://clocky.internal'), {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
    ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
    signal,
  })
  const response = await apiHandler.fetch(request)
  if (signal.aborted || res.destroyed) return
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow/suspended SSE consumers). 'close' also
    // resolves so a mid-wait disconnect can't park this loop forever; the close
    // handler above aborts the handler stream, which then ends the iteration.
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done)
          res.off('close', done)
          resolve()
        }
        res.once('drain', done)
        res.once('close', done)
      })
    }
  }
  res.end()
}
