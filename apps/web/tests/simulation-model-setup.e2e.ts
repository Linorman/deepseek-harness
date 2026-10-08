/** Default Simulation recovers model configuration through Settings while retaining the same creation input. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type LlmModelInfo, type StreamChunk } from '@clocky/clocky-llm'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

class AvailableModel extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'setup-model', name: 'Setup model' }])
  }
  override async *stream(): AsyncIterable<StreamChunk> { throw new Error('Model setup or paused creation must not infer') }
}

it('returns from model settings to retained input, rechecks and creates only after an explicit click', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, noModels: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).first().click()
    const create = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await create.getByRole('radio', { name: /公司采购/ }).click()
    await create.locator('[name="name"]').fill('保留的采购草稿')
    await create.locator('[name="buyerName"]').fill('采购方')
    await create.locator('[name="supplierName"]').fill('供应方')
    await create.locator('[name="initialStock"]').fill('2')
    expect(await create.getByRole('button', { name: '创建暂停的运行', exact: true }).isDisabled()).toBe(true)
    await create.getByRole('button', { name: '配置模型', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.waitFor()
    expect(await create.count()).toBe(0)
    expect(await page.locator('dialog[open]').count()).toBe(1)
    scaffold.ctx.llm.registerAdapter(['setup-provider'], new AvailableModel())
    const defaults = settings.getByRole('region', { name: '默认模型', exact: true })
    // Labels are supplied by the model section locale; use its semantic form associations.
    const selects = defaults.locator('select')
    await expect.poll(() => selects.nth(0).locator('option[value="setup-provider"]').count()).toBe(1)
    await selects.nth(0).selectOption('setup-provider')
    await selects.nth(1).selectOption('setup-model')
    await selects.nth(2).selectOption('')
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings.replace')
    await defaults.getByRole('button', { name: '保存默认模型', exact: true }).click()
    const saved = await (await savedResponse).json() as { result: { ok: boolean; error?: { code: string } } }
    await writeFile(join(root, 'model-save-diagnostic.json'), JSON.stringify({ ok: saved.result.ok, code: saved.result.error?.code,
      current: scaffold.ctx.agentDefaultModel.currentSelection(), view: await defaults.innerText() }, null, 2))
    await page.screenshot({ path: join(root, 'model-save-diagnostic.png') })
    await defaults.getByText('默认模型已保存。关闭设置即可返回输入。', { exact: true }).waitFor()
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    await create.waitFor()
    expect(await page.locator('dialog[open]').count()).toBe(1)
    expect(await create.locator('[name="name"]').inputValue()).toBe('保留的采购草稿')
    expect(await create.locator('[name="buyerName"]').inputValue()).toBe('采购方')
    await create.getByText('配置检查通过。创建时仍会重新检查当前权限与容量。', { exact: true }).waitFor()
    const before = await scaffold.authenticatedRpc<{ items: unknown[] }>('simulation.runs.list', {})
    expect(before.result.ok && before.result.value.items).toEqual([])
    await page.screenshot({ path: join(root, 'simulation-model-setup-return.png') })
    await create.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await create.getByRole('button', { name: '打开已登记运行', exact: true }).waitFor()
    expect(errors.pageErrors).toEqual([])
  } finally { await browser.close(); await scaffold.close() }
}, 90_000)
