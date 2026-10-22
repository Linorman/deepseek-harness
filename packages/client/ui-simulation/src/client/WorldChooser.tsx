/** Small chooser before the workbench: start from a Host template, import a file, or begin a blank definition. */
import clsx from 'clsx'
import { useId, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ScenarioSourceFormat } from '@clocky/clocky-simulation-scenario'
import type { WorldTemplateView, WorldWindow } from './world-domain.ts'
import { windowValue } from './world-domain.ts'
import { WindowStatus } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import type { WorldAuthorDraft } from './world-draft.ts'
import css from './World.module.css'

/** What the chooser asks the caller to open. */
export type ChooserResult =
  | { readonly kind: 'template'; readonly template: WorldTemplateView }
  | { readonly kind: 'import'; readonly name: string; readonly text: string; readonly format: ScenarioSourceFormat }
  | { readonly kind: 'blank' }
  | { readonly kind: 'continue'; readonly slot: string }

const ACCEPT = ['.json', '.yaml', '.yml']

/**
 * Three option cards navigable with arrow keys; Enter confirms. Unfinished drafts are listed underneath.
 * @param props.templates - Host template window (unpublished until the catalog offers World templates).
 * @param props.drafts - Retained authoring slots, newest first.
 * @param props.maxBytes - Draft allowance; oversized files are refused inside the import card.
 * @param props.slotsFull - Whether a new slot can be allocated.
 * @param props.choose - Open the workbench for the choice.
 * @returns form modal.
 */
export function NewWorldChooser({ templates, drafts, maxBytes, slotsFull, maxSlots, choose, close, error, t }: {
  templates: WorldWindow<readonly WorldTemplateView[]>
  drafts: readonly WorldAuthorDraft[]
  maxBytes: number
  slotsFull: boolean
  maxSlots: number
  choose: (result: ChooserResult) => void
  close: () => void
  /** Refusal from opening the chosen draft (for example, the draft allowance). */
  error?: string | undefined
  t: WorldT
}) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const [importError, setImportError] = useState<string>()
  const file = useRef<HTMLInputElement>(null)
  const list = windowValue(templates)?.value ?? []
  const read = async (input: File | undefined) => {
    if (input === undefined || slotsFull) return
    const name = input.name.toLowerCase()
    const extension = ACCEPT.find(item => name.endsWith(item))
    if (extension === undefined) { setImportError(t('world.new.import.type')); return }
    if (input.size > maxBytes) { setImportError(t('world.new.import.size', { max: maxBytes })); return }
    try {
      const text = await input.text()
      setImportError(undefined)
      choose({ kind: 'import', name: input.name.replace(/\.(world\.)?(json|ya?ml)$/i, ''), text, format: extension === '.json' ? 'json' : 'yaml' })
    } catch { setImportError(t('world.fileFailed')) }
  }
  // Arrow keys move between every card's actions (templates, file, blank); Enter and Space activate the focused button.
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    const actions = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-chooser-action]:not(:disabled)'))
    const index = actions.findIndex(action => action === document.activeElement)
    if (index === -1 || actions.length === 0) return
    event.preventDefault()
    actions[(index + delta + actions.length) % actions.length]?.focus()
  }
  const drop = (event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragging(false); void read(event.dataTransfer.files[0]) }
  return <Modal open size="form" className={clsx(css.chooserDialog)} title={t('world.new')} closeLabel={t('world.close')} onClose={close}
    footer={<Button variant="secondary" onClick={close}>{t('world.close')}</Button>}>
    {slotsFull && <p className={css.warning} role="status">{t('world.new.slotsFull', { max: maxSlots })}</p>}
    {error !== undefined && <p className={css.fieldError} role="alert">{error}</p>}
    <div className={css.chooser} role="group" aria-label={t('world.new')} onKeyDown={move}>
      <section className={css.chooserCard} aria-labelledby={`${id}-template`}>
        <span className={css.chooserIcon} aria-hidden="true">◇</span>
        <h3 id={`${id}-template`}>{t('world.new.template')}</h3><span className={css.muted}>{t('world.new.template.hint')}</span>
        <WindowStatus window={templates} compact t={t} />
        {templates.status === 'ready' && list.length === 0 && <span className={css.muted}>{t('world.new.template.none')}</span>}
        {list.length > 0 && <ul className={css.templateList}>{list.map(template => <li key={template.id}>
          <button type="button" data-chooser-action disabled={slotsFull} onClick={() => { choose({ kind: 'template', template }) }}>
            <strong>{template.name}</strong>
            <span className={css.domainBadges}>{template.domains.map(domain => <span key={domain} className={css.badge} data-tone="tint" data-domain={domain}>
              {domain === 'organization' || domain === 'governance' || domain === 'external' ? t(`world.nav.${domain}`) : domain}</span>)}</span>
            <small>{t('world.new.template.summary', { people: template.people, committees: template.committees })}</small>
          </button></li>)}</ul>}
      </section>
      <section className={css.chooserCard} aria-labelledby={`${id}-import`} data-dragging={dragging || undefined}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => { setDragging(false) }} onDrop={drop}>
        <span className={css.chooserIcon} aria-hidden="true">⇪</span>
        <h3 id={`${id}-import`}>{t('world.new.import')}</h3>
        <span className={css.muted}>{dragging ? t('world.new.import.drop') : t('world.new.import.hint')}</span>
        <Button variant="secondary" size="sm" data-chooser-action disabled={slotsFull} onClick={() => { file.current?.click() }}>
          {t('world.new.import.choose')}</Button>
        <input ref={file} type="file" hidden aria-label={t('world.new.import.choose')}
          accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
          onChange={(event) => { void read(event.target.files?.[0]); event.target.value = '' }} />
        {importError !== undefined && <span className={css.fieldError} role="alert">{importError}</span>}
      </section>
      <section className={css.chooserCard} aria-labelledby={`${id}-blank`}>
        <span className={css.chooserIcon} aria-hidden="true">＋</span>
        <h3 id={`${id}-blank`}>{t('world.new.blank')}</h3><span className={css.muted}>{t('world.new.blank.hint')}</span>
        <Button variant="secondary" size="sm" data-chooser-action disabled={slotsFull} onClick={() => { choose({ kind: 'blank' }) }}>
          {t('world.new.blank.start')}</Button>
      </section>
    </div>
    {drafts.length > 0 && <section className={css.chooserDrafts} aria-label={t('world.new.drafts')}>
      <h4>{t('world.new.drafts')}</h4>
      <ul>{drafts.slice(0, 3).map(draft => <li key={draft.slot}>
        <span>{t('world.new.draftRow', { name: draft.name.trim() || t('world.author.untitled'), count: draft.diagnosticCount })}</span>
        <Button size="sm" variant="secondary" onClick={() => { choose({ kind: 'continue', slot: draft.slot }) }}>{t('world.new.continue')}</Button>
      </li>)}</ul>
    </section>}
  </Modal>
}
