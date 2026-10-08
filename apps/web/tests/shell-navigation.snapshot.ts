/**
 * Shell and navigation: create Team work from the empty-state launcher with
 * the keyboard alone, inspect the coordinator in the conversation pane beside
 * the Team page, fall back to a sheet on narrow viewports, and explain an
 * expired credential in the connection banner. The command palette and the
 * shortcut overlay are reached from the keyboard alone.
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/lifecycle-chrome', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

it('creates Team work from the launcher, opens the pane beside the page, and banners an expired credential', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: join(SNAPSHOT_DIR, 'session.jsonl'),
    replayOverride: join(SNAPSHOT_DIR, 'replay.override.json'),
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })

    // The empty state is a launcher: folder and preset chips plus starters.
    const launcher = page.getByRole('group', { name: '新建团队任务的选项' })
    await launcher.waitFor()
    await launcher.getByRole('list', { name: '建议起点' }).getByRole('button').first().click()
    const input = page.locator('textarea').first()
    expect(await input.inputValue()).toBe('梳理这个仓库的架构，写一份概览')
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')

    // Keyboard only: replace the starter and submit with Enter.
    await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type(PROMPT)
    const settled = scaffold.whenTurnSettled()
    await page.keyboard.press('Enter')
    await settled

    const workspace = page.locator('[data-team-workspace-page]')
    await workspace.waitFor()
    const row = page.locator('section[aria-label="团队目录"] [role="listitem"]').first()
    await row.waitFor()
    expect(await row.getAttribute('data-status')).not.toBeNull()

    // The coordinator opens in a pane, and the Team page stays visible at 1280px.
    const pane = page.locator('[data-conversation-pane]')
    if (!await pane.isVisible()) {
      await workspace.getByRole('button', { name: /^(与协调者沟通|查看协调者记录)$/ }).click()
    }
    await pane.waitFor({ state: 'visible' })
    expect(await pane.getAttribute('data-conversation-pane')).toBe('split')
    expect(await page.locator('dialog[open]').count()).toBe(0)
    const teamBox = await workspace.boundingBox()
    const paneBox = await pane.boundingBox()
    expect(teamBox!.width).toBeGreaterThanOrEqual(480)
    expect(teamBox!.x + teamBox!.width).toBeLessThanOrEqual(paneBox!.x + 1)

    // Resize from the keyboard, then expand and restore.
    const separator = page.getByRole('separator', { name: '调整对话面板宽度' })
    const before = Number(await separator.getAttribute('aria-valuenow'))
    await separator.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBe(before + 16)
    await pane.getByRole('button', { name: '展开对话' }).click()
    await expect.poll(() => pane.getAttribute('data-conversation-pane')).toBe('expanded')
    await pane.getByRole('button', { name: '恢复并排视图' }).click()
    await expect.poll(() => pane.getAttribute('data-conversation-pane')).toBe('split')

    // Narrow viewports present the pane as a full-screen sheet.
    await page.setViewportSize({ width: 900, height: 900 })
    await expect.poll(() => pane.getAttribute('data-conversation-pane')).toBe('sheet')
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(() => pane.getAttribute('data-conversation-pane')).toBe('split')

    // Escape closes the pane and returns to the Team page.
    await pane.focus()
    await page.keyboard.press('Escape')
    await pane.waitFor({ state: 'hidden' })
    await workspace.waitFor({ state: 'visible' })

    // Keyboard only: the palette finds the Team by its words and opens it;
    // `?` lists the registered shortcuts.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+K`)
    const palette = page.getByRole('combobox', { name: '命令面板' })
    await palette.waitFor()
    await page.keyboard.type('LIGHTHOUSE')
    expect(await page.getByRole('option').first().innerText()).toContain('LIGHTHOUSE')
    await page.keyboard.press('Enter')
    await palette.waitFor({ state: 'hidden' })
    await workspace.waitFor({ state: 'visible' })
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: '键盘快捷键' })
    await help.waitFor()
    expect(await help.innerText()).toContain('打开命令面板')
    await page.keyboard.press('Escape')
    await help.waitFor({ state: 'hidden' })
    // Settings is reachable from the palette too.
    await page.keyboard.press(`${mod}+K`)
    await palette.waitFor()
    await page.keyboard.type('打开设置')
    await page.keyboard.press('Enter')
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.waitFor()
    await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })

    // An expired credential surfaces as one banner, not as inline transport text.
    await scaffold.replaceBrowserAuthentication()
    const banner = page.getByRole('alert').filter({ hasText: '本地访问凭据已失效' })
    await banner.waitFor({ timeout: 30_000 })
    expect(await banner.innerText()).toContain('clocky web')
    expect(await page.locator('body').innerText()).not.toMatch(/transport failure|HTTP 401/)
    expect(errors.pageErrors).toEqual([])
  } catch (cause) {
    await page.screenshot({ path: join(process.cwd(), '.tmp/ui-redesign-evidence/shell-navigation-failure.png') }).catch(() => undefined)
    throw cause
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 240_000)
