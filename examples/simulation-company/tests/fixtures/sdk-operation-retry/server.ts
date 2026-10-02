/** Production SDK stdio with a single lost grant response and an external-model request-count audit. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Writable } from 'node:stream'
import type { Context } from '@clocky/cordis'
import { apply as serve } from '@clocky/clocky-sdk-jsonrpc-server'
import { requests } from '../../product-control-model.ts'
import { releaseTargetReceipt } from './target-fault.ts'

export const inject = ['agents', 'teamRuns', 'productPrincipals']
/** Only result publication is dropped; the original product grant and target ledger remain real and queryable. */
export function apply(ctx: Context): void {
  let dropped = false
  const output = new Writable({ write(chunk: Buffer, encoding, callback) {
    const frame = JSON.parse(chunk.toString()) as { result?: { commandId?: string; kind?: string } }
    const audit = writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'sdk-operation-model-count.json'),
      JSON.stringify({ requests: requests.length }), { mode: 0o600 })
    if (frame.result?.kind === 'retry-operation' && frame.result.commandId === 'sdk-operation-retry') {
      releaseTargetReceipt()
      if (!dropped && process.env.SDK_OPERATION_DROP_RESPONSE === 'true') {
        dropped = true; void audit.then(() => { callback() }, callback); return
      }
    }
    void audit.then(() => { process.stdout.write(chunk, encoding, callback) }, callback)
  } })
  serve(ctx, { output })
}
