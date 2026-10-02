/** A draft image preview must sit above native Session inspection without closing its parent or sending input. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('previews an image above Session inspection and returns focus without sending the draft', async () => {
  const root = join(process.cwd(), '.tmp-webui-improvement/image-inspection')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, replayProvidersOnly: true,
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/plan-narrow-viewport/session.jsonl'), replayInputModalities: ['text', 'image'] })
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const errors = watchConsole(page)
  try {
    const response = await scaffold.authenticatedRpc<TeamStateSnapshot>('team.create', { objective: 'Image preview context', cwd: scaffold.workspaceCwd })
    if (!response.result.ok) throw new Error(response.result.error.message)
    const team = response.result.value, coordinator = team.participants.find(member => member.role === 'coordinator')!
    const binding = team.activations.find(value => value.activation.participantId === coordinator.id)!
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?team=${team.team.id}&view=members&session=${binding.sessionId}&participant=${coordinator.id}`)
    const inspection = page.locator('dialog[data-inspecting][open]')
    const input = inspection.getByRole('textbox')
    await input.fill('Unsent image context')
    await input.evaluate((element) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'tiny.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    })
    const thumbnail = inspection.getByTitle('View original', { exact: true })
    await thumbnail.click()
    const preview = page.getByRole('dialog', { name: 'Original image preview', exact: true })
    await preview.waitFor()
    expect(await preview.evaluate(element => element.matches(':modal'))).toBe(true)
    await preview.getByRole('button', { name: 'Close original image preview', exact: true }).click()
    await preview.waitFor({ state: 'hidden' })
    expect(await inspection.isVisible()).toBe(true)
    expect(await thumbnail.evaluate(element => element === document.activeElement)).toBe(true)
    await thumbnail.click()
    await page.keyboard.press('Escape')
    await preview.waitFor({ state: 'hidden' })
    expect(await inspection.isVisible()).toBe(true)
    expect(await input.inputValue()).toBe('Unsent image context')
    expect(scaffold.ctx.sessions.get(binding.sessionId)?.events.filter(event => event.type === 'turn/start')).toEqual([])
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(root, 'restored-inspection.png') })
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), String(cause) + '\n' + await page.locator('body').innerText())
    throw cause
  } finally { await browser.close(); await scaffold.close() }
}, 60000)
