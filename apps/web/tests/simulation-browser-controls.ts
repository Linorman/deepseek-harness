/** Shared real-browser access to the one compact Simulation maintenance owner. */
import type { Locator } from 'playwright'

/** Expand maintenance without recreating its controller or retained mutation dialogs. */
export async function showSimulationMaintenance(workspace: Locator): Promise<void> {
  const disclosure = workspace.locator('[data-simulation-maintenance]')
  await disclosure.waitFor({ state: 'visible' })
  if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) await disclosure.locator('summary').click()
}

/** Open original request history through its secondary navigation entry on wide or narrow layouts. */
export async function showSimulationRequests(workspace: Locator): Promise<void> {
  if (await workspace.getByRole('region', { name: '持久原请求', exact: true }).isVisible()) return
  const more = workspace.getByRole('button', { name: /^更多仿真模块/ })
  if (await more.isVisible()) await more.click()
  else await workspace.getByRole('button', { name: /^仿真模块:/ }).click()
  await workspace.page().getByRole('menuitem', { name: '请求记录', exact: true }).click()
}
