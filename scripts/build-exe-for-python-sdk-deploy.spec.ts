import { expect, it } from 'vitest'
import { stageWithWorkspaceRestore } from './build-exe-for-python-sdk-deploy.ts'

it('keeps restoration after carrier detachment and waits for it before completing', async () => {
  const staged = Promise.withResolvers<undefined>(), restored = Promise.withResolvers<undefined>()
  const order: string[] = []
  const work = stageWithWorkspaceRestore(async () => { order.push('stage'); await staged.promise },
    async () => { order.push('restore'); await restored.promise }).then(() => { order.push('complete') })
  expect(order).toEqual(['stage'])
  staged.resolve(undefined)
  await Promise.resolve(); await Promise.resolve()
  expect(order).toEqual(['stage', 'restore'])
  restored.resolve(undefined)
  await work
  expect(order).toEqual(['stage', 'restore', 'complete'])
})

it('restores the workspace after failed staging and preserves the original failure', async () => {
  const failure = new Error('Deployment failed')
  let restored = false
  await expect(stageWithWorkspaceRestore(() => Promise.reject(failure), async () => { restored = true })).rejects.toBe(failure)
  expect(restored).toBe(true)
})

it('fails a successful stage when workspace restoration fails', async () => {
  const failure = new Error('Workspace links could not be restored')
  await expect(stageWithWorkspaceRestore(() => Promise.resolve(), () => Promise.reject(failure))).rejects.toBe(failure)
})

it('retains both errors when deployment and restoration fail', async () => {
  const first = new Error('Deployment failed'), second = new Error('Restoration failed')
  const result = await stageWithWorkspaceRestore(() => Promise.reject(first), () => Promise.reject(second)).catch((error: unknown) => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).errors).toEqual([first, second])
})
