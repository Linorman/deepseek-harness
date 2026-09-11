/** Web e2e scenario: startup enters a Team draft without selecting a Session. */

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: Team draft startup', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders an enabled Team draft and no Session browser', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-team-draft-startup'))
    await page.getByRole('region', { name: 'Tasks' }).waitFor({ timeout: 30_000 })
    expect(await page.locator('div[data-phase]').first().getAttribute('data-phase')).toBe('hero')
    const textarea = page.getByPlaceholder('Describe what you want to build')
    await textarea.waitFor({ timeout: 30_000 })
    expect(await textarea.isEnabled()).toBe(true)
    expect(await page.getByRole('tree', { name: 'Sessions' }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})
