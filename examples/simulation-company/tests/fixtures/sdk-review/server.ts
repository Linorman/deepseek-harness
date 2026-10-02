/** Production SDK server with one output-boundary response loss; all product and canonical work remains real. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { requests } from '../../product-control-model.ts'
import { Writable } from 'node:stream'
import type { Context } from '@clocky/cordis'
import { apply as serve } from '@clocky/clocky-sdk-jsonrpc-server'

export const inject = ['agents', 'teamRuns', 'productPrincipals']
/** Keep stdio framing and production server dispatch, dropping only the first configured review response. */
export function apply(ctx: Context): void {
  let dropped = false
  const output = new Writable({ write(chunk: Buffer, encoding, callback) {
    const frame = JSON.parse(chunk.toString()) as { result?: { commandId?: string; kind?: string } }
    // Only a request count is persisted; it proves paused/cold calls never reach the scripted external model.
    const audit = writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'sdk-review-model-count.json'),
      JSON.stringify({ requests: requests.length }), { mode: 0o600 })
    if (!dropped && process.env.SDK_REVIEW_DROP_RESPONSE === 'true'
      && frame.result?.kind === 'review' && frame.result.commandId === 'sdk-review-rework') {
      dropped = true; void audit.then(() => { callback() }, callback); return
    }
    void audit.then(() => { process.stdout.write(chunk, encoding, callback) }, callback)
  } })
  serve(ctx, { output })
}
