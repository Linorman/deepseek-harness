// Web e2e scenario: switching models in the composer is how this deployment's
// default is chosen. The gesture writes the shared `agent-default-model` settings section, a
// Team coordinator created afterwards starts from it, and a coordinator that already logged
// a route keeps deriving from its own log — the tier order the gateway
// resolves on every read.
// Zero model calls: the switch is settings/llm-domain traffic only, so there
// is no fixture and a stray stream would fail loud because the adapter registry is empty. Both
// routes are declared host-side (not through the UI, which has its own
// scenario) through the pi-ai adapter the shipped tree already mounts: a
// fixture-less scaffold registers no adapter at all, so the routes the
// picker offers — and the one the composer must start on — have to come from
// somewhere, and settings profiles are the product's own way to add them.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@clocky/clocky-session'
import { settingsNamespace } from '@clocky/clocky-settings'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** Points the shipped shared Agent default at this scenario's own route. */
const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))

/** The route this scenario starts on, patched over the shipped default. */
const START_ROUTE = 'origin-gateway'
const START_MODEL = 'origin-large'
/** The route the switch lands on, which then becomes the saved default. */
const ROUTE = 'acme-gateway'
const MODEL = 'acme-large'
const INITIAL_TEAM_OBJECTIVE = 'Open the model-selection coordinator.'

type TeamState = {
  readonly participants: readonly { readonly id: string; readonly role: string }[]
  readonly activations: readonly {
    readonly sessionId: string
    readonly activation: { readonly participantId: string }
  }[]
}

/** Resolve the Team-owned coordinator transcript from the durable Team state. */
function coordinatorSessionId(state: TeamState): SessionId {
  const coordinator = state.participants.find(participant => participant.role === 'coordinator')
  if (coordinator === undefined) throw new Error('Team state has no coordinator participant')
  const binding = state.activations.find(activation => activation.activation.participantId === coordinator.id)
  if (binding === undefined) throw new Error('Team state has no coordinator activation')
  return SessionId(binding.sessionId)
}

describe('web e2e: the composer model switch is the default for later Team coordinators', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Create a Team and return the Session of its durable coordinator binding. */
  const createCoordinator = async (objective: string): Promise<SessionId> => {
    const response = await scaffold.authenticatedRpc<TeamState>('team.create', {
      objective,
      cwd: scaffold.workspaceCwd,
    })
    if (!response.result.ok) throw new Error(`team.create failed: ${response.result.error.message}`)
    return coordinatorSessionId(response.result.value)
  }

  /** The route the gateway reports for one session, through the real wire face. */
  const currentOf = async (sessionId: string): Promise<unknown> => {
    const response = await scaffold.ctx.apiProxy.sessions.models({
      rpcId: `default-model-${sessionId}` as never,
      payload: { sessionId: SessionId(sessionId) },
    })
    if (!response.result.ok) throw new Error(`session.models failed: ${response.result.error.message}`)
    return response.result.value.current
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Two routes so the picker has somewhere to start and somewhere to go.
    // Declared through the settings seam rather than the Models page: this
    // scenario is about the composer, and the declaring flow is covered by
    // models-settings.e2e.
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        [START_ROUTE]: {
          displayName: 'Origin Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.origin.example/v1',
          models: [{ id: START_MODEL, name: 'Origin Large' }],
        },
        [ROUTE]: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }],
        },
      },
    })
    await createCoordinator(INITIAL_TEAM_OBJECTIVE)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByText(INITIAL_TEAM_OBJECTIVE, { exact: true }).click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('writes the switched model as the default and leaves a logged session alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model'))
    // A coordinator that has already run a turn, spelled as the fact a turn
    // leaves behind: its own logged route.
    const loggedId = await createCoordinator('Keep the logged model selection.')
    scaffold.ctx.sessions.get(loggedId)?.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })

    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Acme Large' }).click()

    // The switch is what sets the default: the shared Agent-route settings section
    // now names it, beside the provider profiles the Models page writes.
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('agent-default-model:')
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain(`provider: ${ROUTE}`)
    expect(document).toContain(`model: ${MODEL}`)

    // A coordinator created after the switch starts from it...
    expect(await currentOf(await createCoordinator('Use the switched model selection.')))
      .toEqual({ provider: ROUTE, model: MODEL })
    // ...while the coordinator holding a logged route keeps deriving from its log.
    expect(await currentOf(loggedId)).toEqual({ provider: START_ROUTE, model: START_MODEL })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('goes inert when the route the default names stops being served', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model-blocked'))
    const box = page.locator('textarea[data-input-phase], textarea').first()
    await expect.poll(async () => box.isEnabled(), { timeout: 10_000 }).toBe(true)

    // What removing the provider on the Models page leaves behind: the saved
    // default still names the route, and nothing serves it any more.
    // `replace`, not `update`: a merge patch of `{providers: {}}` leaves every
    // stored profile in place.
    await scaffold.ctx.settings.replace(settingsNamespace('llm-pi-ai'), { providers: {} })

    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(false)
    expect(await box.getAttribute('placeholder')).toBe('当前模型不可用，请先选择模型')

    // The block is an affordance; the refusal is the Host's. A client that
    // never disabled anything still cannot start a turn on a dead route.
    const refused = await scaffold.authenticatedRpc('session.prompt', {
      sessionId: await createCoordinator('Refuse the unavailable model.'),
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'hi' }],
    })
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })

    // The way out stays open. Locking the model seat with everything else
    // would leave the composer asking for the one thing it prevents.
    const seat = page.getByRole('button', { name: /^选择模型/ })
    expect(await seat.isEnabled()).toBe(true)
    await seat.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
