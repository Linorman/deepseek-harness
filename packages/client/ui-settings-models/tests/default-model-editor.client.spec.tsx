// @vitest-environment jsdom
/** Default selection requires a user choice and explicit revision review, with no inference. */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DefaultModelEditor } from '../src/client/DefaultModelEditor.tsx'
import { en } from '../src/client/locales.ts'
import type { SettingsNamespaceView } from '@clocky/clocky-api-remotes/client'
import type { ModelsSettingsStore } from '../src/client/store.ts'

afterEach(cleanup)
const namespace: SettingsNamespaceView = { ns: 'agent-default-model', schema: {}, value: {},
  revision: 7, applies: 'new-session', secrets: [] } as never
const groups = [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }]

it('starts without choosing the first row and saves only the explicitly selected route', async () => {
  const saveDefault = vi.fn(async () => namespace)
  const view = render(<DefaultModelEditor namespace={namespace} groups={groups} unavailable={false} writable
    controller={{ saveDefault } as unknown as ModelsSettingsStore} t={key => en[key]} />)
  const provider = view.getByLabelText(en.provider), model = view.getByLabelText(en['defaultModel.model'])
  expect((provider as HTMLSelectElement).value).toBe('')
  expect((model as HTMLSelectElement).value).toBe('')
  expect((view.getByRole('button', { name: en['defaultModel.save'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(provider, { target: { value: 'provider' } })
  fireEvent.change(model, { target: { value: 'model' } })
  fireEvent.click(view.getByRole('button', { name: en['defaultModel.save'] }))
  await waitFor(() => { expect(saveDefault).toHaveBeenCalledWith({ provider: 'provider', model: 'model' }, 7) })
})

it('keeps input after a newer default arrives and requires explicit review before another save', () => {
  const saveDefault = vi.fn(async () => namespace)
  const props = { namespace, groups, unavailable: false, writable: true,
    controller: { saveDefault } as unknown as ModelsSettingsStore, t: (key: keyof typeof en) => en[key] }
  const view = render(<DefaultModelEditor {...props} />)
  fireEvent.change(view.getByLabelText(en.provider), { target: { value: 'provider' } })
  fireEvent.change(view.getByLabelText(en['defaultModel.model']), { target: { value: 'model' } })
  view.rerender(<DefaultModelEditor {...props} namespace={{ ...namespace, revision: 8, value: { provider: 'provider', model: 'model' } }} />)
  expect(view.getByText(en['defaultModel.changed'])).toBeTruthy()
  expect((view.getByLabelText(en['defaultModel.model']) as HTMLSelectElement).value).toBe('model')
  expect((view.getByRole('button', { name: en['defaultModel.save'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['defaultModel.review'] }))
  expect((view.getByRole('button', { name: en['defaultModel.save'] }) as HTMLButtonElement).disabled).toBe(false)
  expect(saveDefault).not.toHaveBeenCalled()
})
