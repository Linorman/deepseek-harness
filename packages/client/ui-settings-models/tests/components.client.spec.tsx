// @vitest-environment jsdom
/** Generic Models-section behavior over a scripted provider directory. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@clocky/schemastery'
import { bindSnapshotSelector } from '@clocky/clocky-client-test-runtime'
import type { RpcResponse, SettingsNamespaceView } from '@clocky/clocky-api-remotes/client'
import {
  ModelsSection, providerCopy, providerTargetLabel, removeProviderProfile,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { SettingsDescribeMirror } from '@clocky/clocky-client-ui-settings/src/client/settings-mirror.ts'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    displayName: Schema.string(),
    api: Schema.union(['openai-completions', 'openai-responses', 'anthropic-messages']),
    baseURL: Schema.string(),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number().step(1).min(1),
      maxTokens: Schema.number().step(1).min(1),
    })),
    headers: Schema.dict(Schema.string()),
  })),
})
const PlainConfig = Schema.object({ profiles: Schema.dict(Schema.object({ note: Schema.string() })) })

const OPENAI_MODELS = [{ id: 'gpt-test', name: 'Test model', contextWindow: 131_072, maxTokens: 8_192 }]

function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      value: {
        providers: {
          openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', models: OPENAI_MODELS, headers: { 'X-Team': 'a' } },
          zombie: { apiKeyEnv: 'ZOMBIE_API_KEY' },
        },
      },
      base: { providers: { openai: { models: OPENAI_MODELS } } },
      user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(PlainConfig.toJSON())) as unknown,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
  ]
}

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `models-${nextRpc++}` as never, result: { ok: true, value } }
}

function fail<T>(message: string, code = 'settings-rejected'): RpcResponse<T> {
  return {
    rpcId: `models-${nextRpc++}` as never,
    result: { ok: false, error: { code, message, details: { ns: 'llm-pi-ai' } } as never },
  }
}

function scriptedFace(overrides: {
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
  writable?: boolean
  configuredCredentialRefs?: readonly string[]
  providerDisplayNames?: Record<string, string>
} = {}) {
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[0])))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(ok({})))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({ providers: [
        { provider: 'openai', displayName: overrides.providerDisplayNames?.openai ?? 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
        { provider: 'anthropic', displayName: overrides.providerDisplayNames?.anthropic ?? 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
        { provider: 'zombie', displayName: overrides.providerDisplayNames?.zombie ?? 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
        { provider: 'broken', displayName: overrides.providerDisplayNames?.broken ?? 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'missing'], active: false },
        { provider: 'plain', displayName: overrides.providerDisplayNames?.plain ?? 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
      ] }))),
      discoverModels: vi.fn(() => Promise.resolve(ok({ models: [{ id: 'acme-large' }] }))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({
        writable: overrides.writable ?? true,
        hasDocument: false,
        namespaces: wireNamespaces(),
      }))),
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
          configured: ref === 'OPENAI_API_KEY' || overrides.configuredCredentialRefs?.includes(ref) === true,
          ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
          writable: true,
        }])),
      }))),
      set,
      unset: unset ?? vi.fn(() => Promise.resolve(ok({}))),
    },
  }
  return { face, mutate, set, unset }
}

type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

async function mount(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(overrides)
  const mirror = new SettingsDescribeMirror(scripted.face as never)
  const controller = new ModelsSettingsStore(scripted.face as unknown as WireFace, settingsSchema, mirror)
  await controller.load()
  const props: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: scripted.face as never,
    schema: settingsSchema,
    t,
  }
  const view = render(<ModelsSection {...props} />)
  return { ...scripted, controller, mirror, view }
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    render(<ModelsSection />)
    expect(document.body.textContent).toBe('')
  })

  it('renders generic provider rows and edits only the changed path', async () => {
    const { mutate } = await mount()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.getByText('zombie')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    fireEvent.click(screen.getByText(en.customized))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    fireEvent.change(url, { target: { value: 'https://proxy/v2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://proxy/v2' }],
      expectedRevision: 0,
    })
  })

  it('adds a dormant provider through the generic pi-ai card', async () => {
    const { mutate, set } = await mount()
    fireEvent.click(screen.getByText(en.add))
    const provider = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    fireEvent.change(provider, { target: { value: 'anthropic' } })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }],
    })
    await waitFor(() => { expect(set).toHaveBeenCalledWith({ ref: 'ANTHROPIC_API_KEY', value: 'sk-ant' }) })
  })

  it('requires confirmation before removing a user-owned provider', async () => {
    const { mutate, unset } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete zombie' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete zombie?' })
    expect(within(dialog).getByText('Deleting zombie removes its configuration. Any credential it uses is managed elsewhere and will be kept.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete zombie' }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'zombie'] }],
    })
  })

  it('surfaces a credential refusal before touching the settings profile', async () => {
    const unset = vi.fn(() => Promise.resolve(fail('credential blocked', 'credential-rejected')))
    const mutate = vi.fn()
    const load = vi.fn(() => Promise.resolve())

    await expect(removeProviderProfile(
      { settings: { mutate }, credentials: { unset } } as never,
      { load } as never,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'], credentialRef: 'ACME_API_KEY' },
    )).resolves.toBe('credential blocked')
    expect(mutate).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('surfaces a settings refusal and a transport rejection from removal', async () => {
    const load = vi.fn(() => Promise.resolve())
    const credentials = { unset: vi.fn(() => Promise.resolve(ok({}))) }
    const settings = { mutate: vi.fn(() => Promise.resolve(fail('settings blocked'))) }
    await expect(removeProviderProfile(
      { settings, credentials } as never,
      { load } as never,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'] },
    )).resolves.toBe('settings blocked')
    expect(load).not.toHaveBeenCalled()

    const rejecting = { mutate: vi.fn(() => Promise.reject(new Error('carrier down'))) }
    await expect(removeProviderProfile(
      { settings: rejecting, credentials } as never,
      { load } as never,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'] },
    )).resolves.toBe('carrier down')
  })

  it('shows a load failure with an explicit retry action', async () => {
    const scripted = scriptedFace()
    scripted.face.llm.providers = vi.fn()
      .mockResolvedValueOnce(fail('directory down', 'internal'))
      .mockResolvedValueOnce(ok({ providers: [] })) as never
    const mirror = new SettingsDescribeMirror(scripted.face as never)
    const controller = new ModelsSettingsStore(scripted.face as unknown as WireFace, settingsSchema, mirror)
    await controller.load()
    const props: ModelsSectionProps = {
      controller,
      useSnapshot: bindSnapshotSelector(controller.store),
      api: scripted.face as never,
      schema: settingsSchema,
      t,
    }
    render(<ModelsSection {...props} />)
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(screen.queryByText(/directory down/)).toBeNull() })
  })

  it('renders the read-only notice and exercises an idle refresh', async () => {
    const { controller } = await mount({ writable: false })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    controller.store.update((state) => { state.status = 'idle' })
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
  })

  it('closes an editor on cancel and toggles the same row closed', async () => {
    await mount()
    const edit = screen.getByRole('button', { name: openaiCopy(en.editProvider) })
    fireEvent.click(edit)
    expect(screen.getByText(en.customized)).toBeTruthy()
    fireEvent.click(edit)
    expect(screen.queryByText(en.customized)).toBeNull()
    fireEvent.click(edit)
    fireEvent.click(screen.getByText(en.cancel))
    await waitFor(() => { expect(screen.queryByText(en.customized)).toBeNull() })
  })

  it('keeps a failed deletion open with its failure message', async () => {
    const mutate = vi.fn(() => Promise.resolve(fail('delete blocked')))
    await mount({ mutate })
    fireEvent.click(screen.getByRole('button', { name: 'Delete zombie' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete zombie?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete zombie' }))
    expect(await screen.findByText('delete blocked')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Delete zombie?' })).toBeTruthy()
  })

  it('describes and dismisses removal of a provider with a managed credential', async () => {
    const { unset } = await mount({ configuredCredentialRefs: ['ZOMBIE_API_KEY'] })
    fireEvent.click(screen.getByRole('button', { name: 'Delete zombie' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete zombie?' })
    expect(within(dialog).getByText('Deleting zombie removes its configuration and stored API key.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog', { name: 'Delete zombie?' })).toBeNull()
    expect(unset).not.toHaveBeenCalled()
  })

  it('does not close the removal dialog while deletion is pending', async () => {
    const pending = Promise.withResolvers<RpcResponse<unknown>>()
    const mutate = vi.fn(() => pending.promise)
    await mount({ mutate })
    fireEvent.click(screen.getByRole('button', { name: 'Delete zombie' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete zombie?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete zombie' }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Delete zombie?' })).toBeTruthy()
    pending.resolve(ok({}))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Delete zombie?' })).toBeNull() })
  })

  it('renders a distinct display name with its route in the editor header', async () => {
    await mount({ providerDisplayNames: { openai: 'OpenAI' } })
    const row = screen.getByText('OpenAI').closest('li')
    if (row === null) throw new Error('OpenAI row missing')
    fireEvent.click(within(row).getByText(en.edit))
    expect(within(row).getAllByText('OpenAI')).toHaveLength(2)
    expect(within(row).getByText('openai')).toBeTruthy()
  })
})

describe('Models-section helpers', () => {
  it('keeps provider identity and minimal path operations stable', () => {
    expect(providerTargetLabel({ provider: 'gateway', displayName: 'Gateway' })).toBe('Gateway (gateway)')
    expect(providerCopy(en.deleteTitle, { provider: 'gateway', displayName: 'Gateway' })).toBe('Delete Gateway (gateway)?')
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
  })

  it('accepts only printable API keys and derives route references', () => {
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
    expect(apiKeyFailure('sk-live')).toBeUndefined()
    expect(apiKeyFailure('  ')).toBe('keyBlank')
    expect(apiKeyFailure('OPENAI_API_KEY=value')).toBe('keyIllegalCharacters')
  })

  it('removes a provider without rebuilding its settings section', async () => {
    const settings = { mutate: vi.fn(() => Promise.resolve(ok({}))) }
    const credentials = { unset: vi.fn(() => Promise.resolve(ok({}))) }
    const controller = { load: vi.fn(() => Promise.resolve()) }
    await expect(removeProviderProfile(
      { settings, credentials } as never,
      controller as never,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'], credentialRef: 'ACME_API_KEY' },
    )).resolves.toBeUndefined()
    expect(credentials.unset).toHaveBeenCalledWith({ ref: 'ACME_API_KEY' })
    expect(settings.mutate).toHaveBeenCalledWith({
      ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'acme'] }],
    })
    expect(controller.load).toHaveBeenCalledOnce()
  })
})
