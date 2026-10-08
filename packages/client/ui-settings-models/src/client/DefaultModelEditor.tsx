/** Explicit default selection over the Host catalog; local input retains its revision until reviewed. */
import { useId, useState } from 'react'
import type { ModelProviderGroup, SettingsNamespaceView } from '@clocky/clocky-api-remotes/client'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { ModelsSettingsStore } from './store.ts'
import type { ModelsKey } from './locales.ts'
import css from './ModelsSection.module.css'

type Draft = { provider: string; model: string; reasoningEffort: string }
function fields(namespace: SettingsNamespaceView): Draft {
  const value = namespace.value as Record<string, unknown>
  return { provider: typeof value.provider === 'string' ? value.provider : '',
    model: typeof value.model === 'string' ? value.model : '',
    reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : '' }
}

/** @param props - Authorized namespace, Host directory and revision-fenced writer. @returns default-model settings. */
export function DefaultModelEditor({ namespace, groups, unavailable, writable, controller, t }: {
  namespace: SettingsNamespaceView
  groups: readonly ModelProviderGroup[]
  unavailable: boolean
  writable: boolean
  controller: ModelsSettingsStore
  t: (key: ModelsKey) => string
}) {
  const [origin, setOrigin] = useState(namespace)
  const [draft, setDraft] = useState(() => fields(namespace))
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [saved, setSaved] = useState(false)
  const id = useId()
  const models = groups.find(group => group.id === draft.provider)?.models ?? []
  const selected = models.find(model => model.id === draft.model)
  const stale = origin.revision !== namespace.revision
  const review = () => { setOrigin(namespace); setDraft(fields(namespace)); setFailed(false); setSaved(false) }
  return <section aria-label={t('defaultModel.title')}>
    <h3 className={css.title}>{t('defaultModel.title')}</h3>
    <p className={css.intro}>{t('defaultModel.hint')}</p>
    {unavailable && <p role="status">{t('defaultModel.unavailable')}</p>}
    {stale && <p role="status">{t('defaultModel.changed')}</p>}
    <form className={css.defaultForm} noValidate onSubmit={(event) => {
      event.preventDefault()
      if (saving || !writable || stale || unavailable || selected === undefined) return
      setSaving(true); setFailed(false); setSaved(false)
      void controller.saveDefault({ provider: draft.provider, model: draft.model,
        ...draft.reasoningEffort === '' ? {} : { reasoningEffort: draft.reasoningEffort } }, origin.revision)
        .then((view) => { if (view === undefined) return; setOrigin(view); setSaved(true) }, () => { setFailed(true) })
        .finally(() => { setSaving(false) })
    }}>
      <label htmlFor={`${id}-provider`}>{t('provider')}</label>
      <select id={`${id}-provider`} className={`${css.input} ${css.selectInput}`} value={draft.provider} disabled={!writable || saving || unavailable}
        onChange={(event) => { setDraft({ provider: event.currentTarget.value, model: '', reasoningEffort: '' }); setSaved(false) }}>
        <option value="">{t('defaultModel.chooseProvider')}</option>
        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
      <label htmlFor={`${id}-model`}>{t('defaultModel.model')}</label>
      <select id={`${id}-model`} className={`${css.input} ${css.selectInput}`} value={draft.model} disabled={!writable || saving || unavailable || draft.provider === ''}
        onChange={(event) => { setDraft({ ...draft, model: event.currentTarget.value, reasoningEffort: '' }); setSaved(false) }}>
        <option value="">{t('defaultModel.chooseModel')}</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <label htmlFor={`${id}-reasoning`}>{t('defaultModel.reasoning')}</label>
      <select id={`${id}-reasoning`} className={`${css.input} ${css.selectInput}`} value={draft.reasoningEffort} disabled={!writable || saving || selected === undefined}
        onChange={(event) => { setDraft({ ...draft, reasoningEffort: event.currentTarget.value }); setSaved(false) }}>
        <option value="">{t('defaultModel.providerDefault')}</option>
        {draft.reasoningEffort !== '' && !selected?.reasoning?.efforts.some(effort => effort.id === draft.reasoningEffort)
          && <option value={draft.reasoningEffort}>{draft.reasoningEffort}</option>}
        {selected?.reasoning?.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
      </select>
      <Button type="submit" loading={saving} disabled={!writable || unavailable || stale || selected === undefined}>{t('defaultModel.save')}</Button>
      {stale && <Button variant="secondary" onClick={review}>{t('defaultModel.review')}</Button>}
    </form>
    {saved && <p role="status">{t('defaultModel.saved')}</p>}
    {failed && <p role="alert">{t('defaultModel.failed')}</p>}
  </section>
}
