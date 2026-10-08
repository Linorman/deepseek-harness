/** MV3 retirement must not strand the native tabs zoom controller's next operation. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext } from 'playwright'
import { expect, it } from 'vitest'
import { createNativeZoomContext } from './browser-native-zoom.ts'

it('keeps independently verified native tab zoom usable after its MV3 worker stops', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clocky-native-zoom-'))
  const server = createServer((_request, response) => {
    response.end('<!doctype html><title>Native zoom lifecycle</title><p>Native zoom lifecycle</p>')
  })
  let context: BrowserContext | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('No owned HTTP address')
    const zoom = await createNativeZoomContext(root, { locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
    context = zoom.context
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${address.port}/`)
    const worker = context.serviceWorkers()[0]
    if (worker === undefined) throw new Error('No installed extension worker')
    const session = await context.newCDPSession(page)
    const versions: Array<{ versionId: string; scriptURL: string; runningStatus: string }> = []
    session.on('ServiceWorker.workerVersionUpdated', (event: { versions: typeof versions }) => {
      versions.push(...event.versions)
    })
    await session.send('ServiceWorker.enable')
    await expect.poll(() => versions.some(value => value.scriptURL === worker.url() && value.runningStatus === 'running')).toBe(true)
    const version = versions.findLast(value => value.scriptURL === worker.url() && value.runningStatus === 'running')!
    expect(await zoom.setNativeZoom(page, 2)).toMatchObject({ factor: 2, width: 720, height: 500 })
    await session.send('ServiceWorker.stopWorker', { versionId: version.versionId })
    await expect.poll(() => versions.findLast(value => value.versionId === version.versionId)?.runningStatus).toBe('stopped')
    expect(await zoom.setNativeZoom(page, 1)).toMatchObject({ factor: 1, width: 1440, height: 1000 })
    const enlarged = await zoom.setNativeZoom(page, 4)
    expect(enlarged.factor).toBeCloseTo(4, 12)
    expect(enlarged).toMatchObject({ width: 360, height: 250 })
  } finally {
    await context?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }))
    await rm(root, { recursive: true, force: true })
  }
})
