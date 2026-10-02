/** Drop one real target receipt after its Envelope commits; restored/explicitly repaired transport keeps the real idempotent target. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'

export const inject = ['teams']
export let releaseTargetReceipt = (): void => {}
/** Model/driver/native dispatch remain production owners; the first Simulation target response alone is uncertain. */
export async function apply(ctx: Context): Promise<void> {
  const auditFile = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'sdk-operation-target.json')
  let audit: { key?: string; envelopes: Array<{ id: string; sequence: number }> } = { envelopes: [] }
  try { audit = JSON.parse(await readFile(auditFile, 'utf8')) as typeof audit }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  let selected = audit.key
  let blocked = process.env.SDK_OPERATION_TARGET_FAULT === 'true'
  releaseTargetReceipt = () => { blocked = false }
  const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
  const fault: typeof ctx.teams.postChannelEnvelope = async (request) => {
    const envelope = await post(request)
    const key = String(request.idempotencyKey)
    if (!key.startsWith('["simulation",')) return envelope
    const parts = JSON.parse(key) as unknown[]
    if (parts[0] === 'simulation') {
      selected ??= key
      if (selected === key) {
        audit = { key: selected, envelopes: [...audit.envelopes, { id: envelope.id, sequence: envelope.sequence }] }
        await writeFile(auditFile, JSON.stringify(audit), { mode: 0o600 })
        if (blocked) throw new Error('Target receipt response was lost after its durable append')
      }
    }
    return envelope
  }
  ctx.effect(() => {
    ctx.teams.postChannelEnvelope = fault
    return () => { ctx.teams.postChannelEnvelope = post }
  })
}
