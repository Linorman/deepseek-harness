/** Test-only external observation of actual scripted-model requests; product progress remains journal-owned. */
import { rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import type {} from '../../world-driver-model.ts'

export const inject = ['worldDriverProbe', 'sessions']

/** @param ctx - Real Loader services; observations never create an Agent, command or World effect. */
export async function apply(ctx: Context): Promise<void> {
  const path = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'sdk-world-model-count.json')
  let tail = Promise.resolve()
  const record = () => {
    tail = tail.then(async () => {
      await writeFile(`${path}.pending`, JSON.stringify({ calls: ctx.worldDriverProbe.requests.length }))
      await rename(`${path}.pending`, path)
    })
    return tail
  }
  await record()
  ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') void record() })
  ctx.effect(() => async () => { await tail })
}
