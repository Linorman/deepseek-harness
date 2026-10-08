/** Production authentication callbacks: terminal denial, quiet transport and one explicit recovery handshake. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const ROOT = join(REPO_ROOT, '.tmp/web-runtime-20261007')
let scaffold: WebScaffold
let browser: Browser

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true })
  scaffold = await launchWebScaffold({ tempRoot: ROOT })
  browser = await chromium.launch()
})
afterAll(async () => { await browser?.close(); await scaffold?.close() })

it.each(['missing', 'revoked'] as const)('stops protected retries for 30 seconds after %s authentication', async (scenario) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const requests: string[] = [], refusals: number[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) requests.push(path)
  })
  page.on('response', (response) => { if (response.status() === 401) refusals.push(401) })
  try {
    if (scenario === 'revoked') await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    if (scenario === 'revoked') {
      await page.locator('[data-mode-card="team"]').waitFor()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置', exact: true })
      await dialog.getByRole('button', { name: '模型', exact: true }).click()
      await scaffold.replaceBrowserAuthentication()
    }
    const banner = page.getByRole('alert').filter({ hasText: '本地访问凭据已失效' })
    await banner.waitFor()
    await page.waitForTimeout(1500)
    const settled = requests.length, denied = refusals.length
    await page.waitForTimeout(30_000)
    expect(requests.slice(settled)).toEqual([])
    expect(refusals.length).toBe(denied)
    await page.keyboard.press('Escape')
    const checksBefore = requests.filter(path => path === '/api/host.describe').length
    await banner.getByRole('button', { name: '重新检查访问', exact: true }).click()
    await expect.poll(() => requests.filter(path => path === '/api/host.describe').length).toBe(checksBefore + 1)
    await page.waitForTimeout(500)
    expect(await banner.count()).toBe(1)
    expect(requests.filter(path => path === '/api/host.describe').length).toBe(checksBefore + 1)
    await scaffold.authenticateBrowserPage(page)
    await banner.getByRole('button', { name: '重新检查访问', exact: true }).click()
    await banner.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: 'Workspace Write' }).waitFor()
    await page.keyboard.press('Escape')
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(ROOT, `authentication-${scenario}.json`), JSON.stringify({ scenario, quietSeconds: 30,
      settledRequestCount: settled, requestsAfterSettlement: requests.slice(settled), deniedResponsesBeforeQuiet: denied,
      handshakeChecksBefore: checksBefore, browser: browser.version(), errors }, null, 2))
  } finally { await page.close() }
}, 90_000)
