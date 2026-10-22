import { compareAuthorDrafts } from './world-draft-compare.ts'
import { WorldTemplateExport } from './WorldTemplateExport.tsx'
import { WorldDraftGraph } from './WorldDraftGraph.tsx'
import { stageScenarioDraftCommand, worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioDraftCommand } from '@clocky/clocky-simulation-scenario'
import type { ScenarioDraftRevision, ScenarioDraftSave, ScenarioDraftSaveResult, ScenarioDraftRead, ScenarioDraftReadResult } from '@clocky/clocky-client-runtime/client'
/**
 * World authoring workbench: a full page (not a dialog) with a section rail, form/source editors sharing one draft,
 * explicit checks, located diagnostics, a frozen preview and one original paused creation.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Button, Input, Menu, Modal, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import { ViewSwitch } from '@clocky/clocky-client-ui-viz'
import type { ScenarioDiagnostic, ScenarioV1SourceDiagnostic, ScenarioSourceFormat } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldPreflightInputSchema } from '@clocky/clocky-simulation-product/world-schema'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationCommand, SimulationCommandKey, SimulationCommandState, SimulationProductRunId, SimulationProductWorldPreflightInput,
  SimulationProductWorldPreflightResult, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import { CommandRecord } from './CommandRecord.tsx'
import { commandUnresolved } from './command-props.ts'
import type { WorldT } from './WorldFacts.tsx'
import { WindowStatus, groupTime } from './WorldFacts.tsx'
import type { CellLocate } from './WorldDraftTable.tsx'
import { DraftTableEditor } from './WorldDraftTable.tsx'
import type { SourceEditorHandle, SourceMarker } from './WorldDraftSource.tsx'
import { DraftSourceEditor } from './WorldDraftSource.tsx'
import type { DiagnosticItem } from './WorldDiagnostics.tsx'
import { DiagnosticList } from './WorldDiagnostics.tsx'
import { JsonField } from './WorldJsonField.tsx'
import { PreviewPanel } from './WorldPreview.tsx'
import type { DraftPath, Json, SectionId, SectionSpec, WorldAuthorDraft } from './world-draft.ts'
import { LIMIT_GROUPS, SECTIONS, sectionSpecs, parseDraft, asArray, asObject, cellOf, draftBytes, editModel, editSource, getPath,
  locatePath, pathModified, readablePath, scalarText, sectionFilled, sectionOf, serialize, setPath, sourceOnlyPaths, step, switchFormat,
  symbols } from './world-draft.ts'
import css from './World.module.css'

/** Replace an explicitly selected saved source, including when invalid raw text retained the same last parsed model. */
function restoreRevision(draft: WorldAuthorDraft, revision: ScenarioDraftRevision, undoDepth: number): WorldAuthorDraft {
  const model = JSON.parse(JSON.stringify(revision.definition)) as Json
  return { ...editModel(draft, model, undoDepth), name: revision.name, layout: revision.layout,
    templateManifest: revision.templateManifest, savedDraftId: revision.draftId, savedRevision: revision.revision,
    source: { text: serialize(model, draft.source.format), format: draft.source.format, edited: false },
    syntax: { ok: true }, check: undefined, pendingSave: undefined }
}

/** Props: the retained slot, Host preflight window and caller-owned original command operations. */
export interface AuthorWorkbenchProps {
  saveDraft?: ((input: ScenarioDraftSave) => Promise<ScenarioDraftSaveResult>) | undefined
  readDraft?: ((input: ScenarioDraftRead) => Promise<ScenarioDraftReadResult>) | undefined
  draft: WorldAuthorDraft
  /** Store the next draft; throws when the draft allowance would be exceeded. */
  change: (draft: WorldAuthorDraft) => void
  maxBytes: number
  /** In-memory undo steps kept per draft. */
  undoDepth: number
  /** Sections the installed compiler accepts; others stay reserved and read-only. */
  supportedSections: readonly SectionId[]
  validation: SimulationReadState<SimulationProductWorldPreflightResult>
  preflight: (input: SimulationProductWorldPreflightInput) =>
  Promise<SimulationReadState<SimulationProductWorldPreflightResult> | undefined>
  connected: boolean
  authorizationVersion: number
  command?: SimulationCommandState | undefined
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  inspectorWidth: number
  resizeInspector: (width: number) => void
  back: () => void
  openRun: (runId: SimulationProductRunId) => void
  discard: () => void
  download: (name: string, text: string, format: ScenarioSourceFormat) => void
  t: WorldT
}

type Pending = { model: Json } | undefined
const CHECK_SCOPE = (input: SimulationProductWorldPreflightInput) => JSON.stringify(['worldPreflight', input])

/**
 * Render the workbench.
 * @param props - Draft slot, Host preflight and command operations.
 * @returns page content for the Simulation workspace.
 */
export function AuthorWorkbench(props: AuthorWorkbenchProps) {
  const { draft, t } = props, id = useId()
  const latest = useRef(props)
  latest.current = props
  const [graphState, setGraphState] = useState<'idle' | 'checking' | 'rejected'>('idle')
  const [savedId, setSavedId] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [conflict, setConflict] = useState<Extract<ScenarioDraftSaveResult, { status: 'conflict' }>>()
  const comparison = useMemo(() => conflict === undefined ? undefined
    : compareAuthorDrafts(conflict.attempted, conflict.current), [conflict])
  const [exportMenu, setExportMenu] = useState(false)
  const [capacityError, setCapacityError] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const [confirm, setConfirm] = useState(false)
  const [runName, setRunName] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [current, setCurrent] = useState<SectionId>('basics')
  const [locate, setLocate] = useState<{ table: string } & CellLocate>()
  const [drawer, setDrawer] = useState(false)
  const [diagIndex, setDiagIndex] = useState(-1)
  const generation = useRef(0)
  const busy = useRef(false)
  const editor = useRef<HTMLDivElement>(null)
  const source = useRef<SourceEditorHandle>(null)
  const specs = sectionSpecs(draft.model)
  const locked = draft.commandKey !== undefined
  const formReadOnly = locked || !draft.syntax.ok
  const bytes = draftBytes(draft)
  const usage = Math.round(bytes / props.maxBytes * 100)

  const store = (next: WorldAuthorDraft) => {
    try { props.change(next); setCapacityError(false); return true }
    catch { setCapacityError(true); return false }
  }
  const applyModel = (model: Json) => {
    if (formReadOnly) return false
    if (draft.source.edited && !draft.regenerateAcknowledged) { setPending({ model }); return false }
    return store(editModel(draft, model, props.undoDepth))
  }
  const updatePath = (path: DraftPath, value: Json | undefined) => applyModel(setPath(draft.model, path, value))

  const save = async () => {
    if (props.saveDraft === undefined || saveState === 'saving' || locked || !props.connected) return
    const parsed = parseDraft(draft.model, 'json', draft.model)
    if (!parsed.ok || parsed.definition.apiVersion !== 'clocky.world/v1') { void runCheck(); return }
    const input = draft.pendingSave ?? { draftId: draft.savedDraftId ?? draft.slot, saveId: crypto.randomUUID(),
      parentRevision: draft.savedRevision ?? null, name: draft.name.trim() || parsed.definition.metadata.name,
      definition: parsed.definition, layout: draft.layout?.map(node => ({ ...node })), templateManifest: draft.templateManifest }
    if (!store({ ...draft, pendingSave: input })) return
    const version = props.authorizationVersion
    setSaveState('saving')
    try {
      const result = await props.saveDraft(input)
      if (version !== latest.current.authorizationVersion || draft.slot !== latest.current.draft.slot) return
      if (result.status === 'conflict') { setConflict(result); store({ ...latest.current.draft, pendingSave: undefined }) }
      else {
        setConflict(undefined); store({ ...latest.current.draft, savedDraftId: result.value.draftId,
          savedRevision: result.value.revision, pendingSave: undefined })
      }
      setSaveState('idle')
    } catch { setSaveState('error') }
  }

  const loadSaved = async () => {
    if (props.readDraft === undefined || savedId.trim() === '' || !props.connected || locked || draft.pendingSave !== undefined) return
    const version = props.authorizationVersion, original = draft
    setLoadError(false)
    try {
      const { value } = await props.readDraft({ draftId: savedId.trim() })
      if (version !== latest.current.authorizationVersion || original !== latest.current.draft) return
      if (value === null) { setLoadError(true); return }
      store(restoreRevision(latest.current.draft, value, props.undoDepth))
      setConflict(undefined)
    } catch { setLoadError(true) }
  }

  const graphDefinition = useMemo(() => worldScenarioV1Schema.safeParse(draft.model), [draft.model])
  const graphCommand = async (command: ScenarioDraftCommand) => {
    if (!graphDefinition.success || formReadOnly || busy.current || !props.connected) return
    const original = draft, version = props.authorizationVersion
    busy.current = true; setGraphState('checking')
    try {
      const staged = stageScenarioDraftCommand(graphDefinition.data, command)
      if (!staged.ok) { setGraphState('rejected'); return }
      const result = await props.preflight({ definition: staged.definition, templateManifest: draft.templateManifest })
      if (latest.current.draft !== original || latest.current.authorizationVersion !== version) { setGraphState('idle'); return }
      if (result?.value?.status !== 'ready' || result.stale || result.error !== undefined) { setGraphState('rejected'); return }
      applyModel(JSON.parse(JSON.stringify(staged.definition)) as Json); setGraphState('idle')
    } catch { setGraphState('rejected') }
    finally { busy.current = false }
  }

  // ── Check ──
  const check = draft.check
  const checkedInput = useMemo(() => {
    if (check === undefined || check.local !== undefined) return undefined
    const parsed = parseDraft(check.model, 'json', check.model)
    if (!parsed.ok) return undefined
    try { return simulationProductWorldPreflightInputSchema.parse({
      definition: parsed.definition, templateManifest: check.templateManifest }) }
    catch { return undefined /* Shared compiler accepted it; a schema mismatch leaves the check without a Host scope. */ }
  }, [check])
  const hostResult = checkedInput !== undefined && props.validation.scope === CHECK_SCOPE(checkedInput) ? props.validation : undefined
  const ready = hostResult?.value?.status === 'ready' ? hostResult.value : undefined
  const outdated = check !== undefined && (JSON.stringify(check.model) !== JSON.stringify(draft.model)
    || JSON.stringify(check.templateManifest) !== JSON.stringify(draft.templateManifest))
  const stale = hostResult !== undefined && (hostResult.stale || hostResult.error !== undefined)
  const rawDiagnostics: readonly (ScenarioDiagnostic | ScenarioV1SourceDiagnostic)[] = check?.local
    ?? (hostResult?.value?.status === 'invalid' ? hostResult.value.diagnostics : [])
  const diagnostics: DiagnosticItem[] = rawDiagnostics.map((item, index) => {
    const located = item.line !== undefined ? { line: item.line, column: item.column ?? 1 }
      : draft.view === 'source' && draft.syntax.ok ? locatePath(draft.source.text, draft.source.format, item.path) : undefined
    return { key: `${String(index)}:${item.path.join('.')}:${item.code}`, severity: item.code === 'stale-preflight' ? 'warning' : 'error',
      section: sectionOf(item.path, draft.model), readable: readablePath(draft.model, item.path, t), path: item.path, code: item.code,
      message: item.message, line: located?.line, column: located?.column,
      modified: check !== undefined && pathModified(check.model, draft.model, item.path) }
  })
  if (!draft.syntax.ok) {
    diagnostics.unshift({ key: 'syntax', severity: 'error', section: 'basics', readable: draft.source.format.toUpperCase(), path: [],
      code: 'invalid-json', message: draft.syntax.line === undefined ? t('world.author.syntaxErrorNoLocation')
        : t('world.author.syntaxError', { line: draft.syntax.line, column: draft.syntax.column ?? 1 }),
      line: draft.syntax.line, column: draft.syntax.column, modified: false })
  }
  const openDiagnostics = diagnostics.filter(item => !item.modified)
  useEffect(() => {
    const count = openDiagnostics.length
    if (count !== draft.diagnosticCount && !locked) { try { props.change({ ...draft, diagnosticCount: count }) }
    catch { /* Counter only; capacity refusal keeps the previous count. */ } }
  }, [openDiagnostics.length])

  const runCheck = async () => {
    if (busy.current || locked || !props.connected) return
    if (!draft.syntax.ok) { setDrawer(true); return }
    const text = draft.view === 'source' ? draft.source.text : undefined
    const parsed = text === undefined ? parseDraft(draft.model, 'json', draft.model) : parseDraft(text, draft.source.format, draft.model)
    if (!parsed.ok) {
      store({ ...draft, check: { model: draft.model, templateManifest: draft.templateManifest,
        text, format: draft.source.format, local: parsed.diagnostics } }); return
    }
    let input: SimulationProductWorldPreflightInput
    try { input = simulationProductWorldPreflightInputSchema.parse({
      definition: parsed.definition, templateManifest: draft.templateManifest }) }
    catch { store({ ...draft, check: { model: draft.model, templateManifest: draft.templateManifest,
      text, format: draft.source.format, local: [] } }); return }
    if (!store({ ...draft, check: { model: draft.model, templateManifest: draft.templateManifest,
      text, format: draft.source.format } })) return
    busy.current = true
    try { await props.preflight(input) } finally { busy.current = false }
  }

  // ── Locate ──
  const locateItem = (item: DiagnosticItem) => {
    generation.current++
    setDiagIndex(diagnostics.indexOf(item))
    if (draft.view === 'source' || !draft.syntax.ok) {
      if (draft.view !== 'source') store({ ...draft, view: 'source' })
      const position = item.line !== undefined ? { line: item.line, column: item.column ?? 1 }
        : locatePath(draft.source.text, draft.source.format, item.path)
      requestAnimationFrame(() => { if (position !== undefined) source.current?.locate(position.line, position.column) })
      return
    }
    const section = item.section
    setCurrent(section)
    const cell = cellOf(item.path, draft.model)
    if (cell !== undefined) { setLocate({ table: cell.table, row: cell.row, column: cell.column, generation: generation.current }); return }
    const field = editor.current?.querySelector<HTMLElement>(`[data-path="${item.path.join('.')}"]`)
      ?? document.getElementById(`${id}-section-${section}`)
    field?.scrollIntoView({ block: 'center' }); field?.focus()
    if (field !== null) field.dataset.flash = String(generation.current)
  }
  const stepDiagnostic = (direction: 1 | -1) => {
    if (diagnostics.length === 0) return
    const next = (diagIndex + direction + diagnostics.length) % diagnostics.length
    const item = diagnostics[next]
    if (item !== undefined) locateItem(item)
  }

  // ── Section rail tracking ──
  useEffect(() => {
    const root = editor.current
    if (root === null || draft.view !== 'form' || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      const section = (visible?.target as HTMLElement | undefined)?.dataset.section as SectionId | undefined
      if (section !== undefined) setCurrent(section)
    }, { root: null, rootMargin: '0px 0px -60% 0px' })
    root.querySelectorAll('[data-section]').forEach((element) => { observer.observe(element) })
    return () => { observer.disconnect() }
  }, [draft.view])
  const goSection = (section: SectionId) => {
    setCurrent(section)
    const heading = document.getElementById(`${id}-section-${section}`)
    heading?.scrollIntoView({ block: 'start' }); heading?.focus({ preventScroll: true })
  }

  // ── Create ──
  const canCreate = props.connected && !locked && ready !== undefined && !outdated && !stale && draft.syntax.ok
  const create = () => {
    if (!canCreate || busy.current || runName.trim() === '') return
    busy.current = true
    try {
      const parsed = parseDraft(draft.model, 'json', draft.model)
      if (!parsed.ok) return
      const input = simulationProductWorldPreflightInputSchema.parse({
        definition: parsed.definition, templateManifest: draft.templateManifest })
      const command: SimulationCommand = { kind: 'world-create', input: { ...input, name: runName.trim(),
        commandId: crypto.randomUUID() as import('@clocky/clocky-client-runtime/client').SimulationProductCommandId,
        preflight: { hash: ready.preview.hash, catalogGeneration: ready.preview.catalogGeneration } } }
      const key = simulationCommandKey(command)
      if (!store({ ...draft, commandKey: key })) return
      try { props.retain(command, props.authorizationVersion) }
      catch { props.change(draft); setCapacityError(true); return }
      setConfirm(false)
      void props.submit(key)
    } finally { busy.current = false }
  }

  // ── Inspector resize ──
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX, startWidth = props.inspectorWidth
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => { props.resizeInspector(Math.min(440, Math.max(280, startWidth - (next.clientX - startX)))) }
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up) }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up)
  }

  const sectionIssues = (section: SectionId) => openDiagnostics.filter(item => item.section === section).length
  const renderSection = (spec: SectionSpec) => {
    const reserved = !props.supportedSections.includes(spec.id)
    const readOnly = formReadOnly || reserved
    const extra = sourceOnlyPaths(draft.model, spec)
    return <section key={spec.id} className={css.authorSection} data-section={spec.id} aria-labelledby={`${id}-section-${spec.id}`}
      data-reserved={reserved || undefined}>
      <header className={css.authorSectionHead}>
        <h2 id={`${id}-section-${spec.id}`} tabIndex={-1}>{t(spec.title)}</h2>
        {extra.length > 0 && <button type="button" className={css.chip} onClick={() => {
          store({ ...draft, view: 'source' })
          const position = locatePath(draft.source.text, draft.source.format, extra[0] ?? [])
          requestAnimationFrame(() => { if (position !== undefined) source.current?.locate(position.line, position.column) })
        }}>{t('world.author.sourceOnly', { count: extra.length })}</button>}
      </header>
      {reserved && <p className={css.reservedNote}>{t('world.author.section.reserved')}</p>}
      {spec.fields.length > 0 && <div className={css.fieldGrid}>{spec.fields.map((field) => {
        const value = getPath(draft.model, field.path), fieldId = `${id}-${field.id}`
        const issue = openDiagnostics.find(item => item.path.join('.') === field.path.join('.'))
        return <div key={field.id} className={field.kind === 'longtext' ? css.fieldWide : css.field}>
          <label htmlFor={fieldId}>{t(field.label)}</label>
          {field.kind === 'json' ? <JsonField id={fieldId} path={field.path.join('.')} readOnly={readOnly}
            value={value} change={next => updatePath(field.path, next)} /> : field.kind === 'longtext' ? <textarea id={fieldId} data-path={field.path.join('.')} className={`${css.textarea} ${css['resize-none']}`} rows={3} readOnly={readOnly}
            value={typeof value === 'string' ? value : ''} aria-invalid={issue !== undefined || undefined}
            onChange={(event) => { updatePath(field.path, event.target.value) }} />
            : <Input id={fieldId} data-path={field.path.join('.')} readOnly={readOnly} value={scalarText(value)}
              aria-invalid={issue !== undefined || undefined}
              onChange={(event) => { updatePath(field.path, event.target.value) }} />}
          {issue !== undefined && <p className={css.fieldError}>{issue.message}</p>}
        </div>
      })}</div>}
      {spec.tables.map(table => <div key={table.id} className={css.authorTable}>
        {spec.tables.length > 1 || spec.fields.length > 0 ? <h3>{t(table.title)}</h3> : null}
        <DraftTableEditor table={table} rows={asArray(getPath(draft.model, table.path))} readOnly={readOnly}
          symbols={kind => symbols(draft.model, kind)}
          diagnostics={diagnostics.flatMap((item) => {
            const cell = cellOf(item.path, draft.model)
            return cell?.table === table.id ? [{ row: cell.row, column: cell.column, message: item.message, modified: item.modified }] : []
          })}
          locate={locate?.table === table.id ? locate : undefined}
          change={(rows) => { updatePath(table.path, rows) }} t={t} />
      </div>)}
      {spec.id === 'runtime' && <div className={css.limits}>
        <p className={css.muted}>{t('world.field.limitBlank')}</p>
        {LIMIT_GROUPS.map(group => <fieldset key={group.group} className={css.limitGroup}>
          <legend><code>limits.{group.group}</code></legend>
          {group.keys.map((key) => {
            const path = ['limits', group.group, key], value = getPath(draft.model, path), fieldId = `${id}-limit-${group.group}-${key}`
            return <div key={key} className={css.limitField}>
              <label htmlFor={fieldId}><code>{key}</code></label>
              <Input id={fieldId} data-path={path.join('.')} inputMode="numeric" readOnly={readOnly}
                value={scalarText(value)}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  let next = setPath(draft.model, path, raw === '' ? undefined : /^-?[0-9]+$/.test(raw) ? Number(raw) : raw)
                  if (asObject(draft.model).apiVersion !== 'clocky.world/v1' && Object.keys(asObject(getPath(next, ['limits', group.group]))).length === 0) next = setPath(next, ['limits', group.group], undefined)
                  if (asObject(draft.model).apiVersion !== 'clocky.world/v1' && Object.keys(asObject(getPath(next, ['limits']))).length === 0) next = setPath(next, ['limits'], undefined)
                  applyModel(next)
                }} />
            </div>
          })}
        </fieldset>)}
      </div>}
    </section>
  }

  const inspector = <aside className={css.authorInspector} aria-label={t('world.author.inspector')} data-open={drawer || undefined}
    style={{ '--inspector-width': `${String(props.inspectorWidth)}px` } as CSSProperties}>
    <div className={css.resizeHandle} role="separator" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={440}
      aria-valuenow={props.inspectorWidth} tabIndex={0} aria-label={t('world.author.inspector')} onPointerDown={resize}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') props.resizeInspector(Math.min(440, props.inspectorWidth + 16))
        if (event.key === 'ArrowRight') props.resizeInspector(Math.max(280, props.inspectorWidth - 16))
      }} />
    <div className={css.inspectorPane}>
      {hostResult !== undefined && hostResult.loading && <WindowStatus window={{ status: 'loading' }} t={t} />}
      {hostResult?.error !== undefined && <p className={css.warning} role="alert">{t('world.loadFailed')}</p>}
      <DiagnosticList items={diagnostics} state={check === undefined && draft.syntax.ok ? 'unchecked' : 'checked'} stale={stale} locate={locateItem} t={t} />
    </div>
    <div className={css.inspectorPane}>
      {ready !== undefined ? <PreviewPanel value={ready} model={draft.model} outdated={outdated}
        recheck={() => { void runCheck() }} t={t} />
        : <section className={css.preview} aria-label={t('world.preview.title')}><h3>{t('world.preview.title')}</h3>
          <p className={css.muted}>{t(check === undefined ? 'world.diag.notChecked' : 'world.preview.blocked')}</p></section>}
    </div>
  </aside>

  return <div className={css.author} data-view={draft.view} data-locked={locked || undefined}>
    <header className={css.authorHeader}>
      <div className={css.authorTitle}>
        <Button variant="ghost" size="sm" onClick={props.back}>← {t('world.author.back')}</Button>
        <label className={css.srOnly} htmlFor={`${id}-name`}>{t('world.author.rename')}</label>
        <input id={`${id}-name`} className={css.titleInput} value={draft.name} placeholder={t('world.author.untitled')} readOnly={locked}
          onChange={(event) => { store({ ...draft, name: event.target.value }) }} />
        <span className={css.retention} data-locked={locked || undefined}>{locked ? <><span aria-hidden="true">🔒 </span>{t('world.author.locked')}</>
          : t('world.author.retained')}</span>
      </div>
      <div className={css.authorActions}>
        {props.saveDraft !== undefined && asObject(draft.model).apiVersion === 'clocky.world/v1' && <Button size="sm" variant="secondary"
          disabled={locked || !props.connected || !draft.syntax.ok || saveState === 'saving' || conflict !== undefined} onClick={() => { void save() }}>
          {t(saveState === 'saving' ? 'world.author.saving' : draft.pendingSave !== undefined ? 'world.author.retrySave' : 'world.author.save')}</Button>}
        <Button size="sm" variant="ghost" disabled={locked || draft.past.length === 0} onClick={() => { store(step(draft, 'undo')) }}>{t('world.author.undo')}</Button>
        <Button size="sm" variant="ghost" disabled={locked || draft.future.length === 0} onClick={() => { store(step(draft, 'redo')) }}>{t('world.author.redo')}</Button>
        <ViewSwitch label={`${t('world.author.form')} / ${t('world.author.source')}`} value={draft.view} options={[{ id: 'form', label: t('world.author.form') },
          { id: 'source', label: t('world.author.source') }, { id: 'graph', label: t('world.author.graph') }]} onChange={(view) => {
          store({ ...draft, view, source: view === 'source' && draft.syntax.ok && !draft.source.edited
            ? { ...draft.source, text: serialize(draft.model, draft.source.format) } : draft.source })
        }} />
        <Menu open={exportMenu} portal align="end" items={[{ id: 'json', label: 'JSON' }, { id: 'yaml', label: 'YAML' }]}
          footer={[{ type: 'label', id: 'notice', text: t('world.overview.exportNotice') }]}
          anchor={<Button size="sm" variant="secondary" aria-expanded={exportMenu} disabled={!draft.syntax.ok}
            onClick={() => { setExportMenu(!exportMenu) }}>{t('world.author.export')}<IconChevronDownOutline14 /></Button>}
          onClose={() => { setExportMenu(false) }} onSelect={(format) => {
            setExportMenu(false)
            const name = (draft.name.trim() || t('world.author.untitled')).replace(/[\\/:*?"<>|]/g, '-')
            props.download(`${name}.world.${format}`, serialize(draft.model, format as ScenarioSourceFormat), format as ScenarioSourceFormat)
          }} />
        <Button size="sm" variant="secondary" disabled={!props.connected || locked || props.validation.loading} onClick={() => { void runCheck() }}
          aria-keyshortcuts="Control+Enter Meta+Enter">{t('world.author.check')}</Button>
        <Button size="sm" variant="primary" disabled={!canCreate} onClick={() => {
          const metadata = asObject(getPath(draft.model, ['metadata']))
          setRunName(draft.name.trim() || (typeof metadata.name === 'string' ? metadata.name : '')); setConfirm(true)
        }}>{t('world.author.create')} ▸</Button>
      </div>
    </header>
    {!props.connected && <p className={css.warning} role="status">{t('world.disconnected')}</p>}
    {usage >= 90 && <p className={css.warning} role="status">{t('world.author.capacity', { percent: usage, max: props.maxBytes })}</p>}
    <WorldTemplateExport key={JSON.stringify([draft.savedDraftId ?? draft.slot, draft.templateManifest])} draft={draft} ready={ready}
      disabled={locked || !draft.syntax.ok || outdated || stale} t={t} download={props.download}
      change={templateManifest => store({ ...draft, templateManifest })} />
    {draft.savedRevision !== undefined && <p className={css.muted} role="status">{t('world.author.savedRevision', { revision: draft.savedRevision })} · {draft.savedDraftId ?? draft.slot}</p>}
    {saveState === 'error' && <p className={css.error} role="alert">{t('world.author.saveError')}</p>}
    {conflict !== undefined && <section className={css.warning} role="alert">
      <h3>{t('world.author.conflict')}</h3><p>{t('world.author.conflictNotice')}</p>
      <p>{t('world.author.conflictParent', { revision: conflict.attempted.parentRevision ?? '—' })}
        {conflict.current !== null && <> · {t('world.author.conflictHead', {
          revision: conflict.current.revision, author: conflict.current.author })}</>}</p>
      <table className={`${css.dataTable} ${css.authorDiff}`} aria-label={t('world.author.changedFields')}>
        <thead><tr><th>{t('world.author.fieldPath')}</th><th>{t('world.author.localVersion')}</th>
          <th>{t('world.author.savedVersion')}</th></tr></thead>
        <tbody>{comparison?.changes.map(change => <tr key={change.path}>
          <th scope="row"><code>{change.path}</code></th>
          <td className={css.prose}>{change.local ?? t('world.author.absentField')}</td>
          <td className={css.prose}>{change.saved ?? t('world.author.absentField')}</td>
        </tr>)}</tbody>
      </table>
      {(comparison?.omitted ?? 0) > 0 && <p>{t('world.author.omittedChanges', { count: comparison?.omitted ?? 0 })}</p>}
      <details><summary>{t('world.author.localVersion')}</summary><pre className={css.authorComparison}>{JSON.stringify(conflict.attempted, null, 2)}</pre></details>
      <details><summary>{t('world.author.savedVersion')}</summary><pre className={css.authorComparison}>{JSON.stringify(conflict.current, null, 2)}</pre></details>
      <Button variant="secondary" disabled={locked} onClick={() => {
        if (conflict.current !== null) store(restoreRevision(draft, conflict.current, props.undoDepth))
        setConflict(undefined)
      }}>{t('world.author.loadSaved')}</Button>
      <Button variant="secondary" disabled={locked} onClick={() => {
        store({ ...draft, savedRevision: conflict.current?.revision, pendingSave: undefined }); setConflict(undefined)
      }}>{t('world.author.keepLocal')}</Button>
    </section>}
    {capacityError && <p className={css.error} role="alert">{t('world.author.capacityRefused')}</p>}
    {props.command !== undefined && draft.commandKey !== undefined && <div className={css.authorOriginal}>
      <CommandRecord value={props.command} connected={props.connected} t={t}
        query={() => props.query(draft.commandKey as SimulationCommandKey)}
        retry={() => props.submit(draft.commandKey as SimulationCommandKey)} />
      {props.command.receipt?.kind === 'request' && <Button variant="primary" onClick={() => {
        if (props.command?.receipt?.kind === 'request') props.openRun(props.command.receipt.value.runId)
      }}>{t('world.create.open')}</Button>}
      {!commandUnresolved(props.command) && props.command.receipt?.kind !== 'request' && <Button variant="secondary"
        onClick={() => { store({ ...draft, commandKey: undefined, check: undefined }) }}>{t('world.create.newIntent')}</Button>}
    </div>}
    {!draft.syntax.ok && draft.view === 'form' && <div className={css.warning} role="alert">
      <span>{draft.syntax.line === undefined ? t('world.author.syntaxErrorNoLocation')
        : t('world.author.syntaxError', { line: draft.syntax.line, column: draft.syntax.column ?? 1 })}</span>
      <Button size="sm" variant="secondary" onClick={() => {
        store({ ...draft, view: 'source' })
        requestAnimationFrame(() => { if (!draft.syntax.ok && draft.syntax.line !== undefined)
          source.current?.locate(draft.syntax.line, draft.syntax.column ?? 1) })
      }}>{t('world.author.locateSource')}</Button>
    </div>}
    <div className={css.authorBody}>
      <nav className={css.sectionRail} aria-label={t('world.author.sections')}>
        <ol>{SECTIONS.map((section) => {
          const issues = sectionIssues(section), filled = sectionFilled(draft.model, specs[section])
          const reserved = !props.supportedSections.includes(section)
          return <li key={section}><button type="button" aria-current={current === section ? 'location' : undefined}
            data-reserved={reserved || undefined} onClick={() => {
              if (draft.view === 'source') store({ ...draft, view: 'form' })
              requestAnimationFrame(() => { goSection(section) })
            }}>
            <span className={css.railDot} data-state={issues > 0 ? 'issue' : filled ? 'filled' : 'empty'} aria-hidden="true">{issues > 0 ? '⚠' : ''}</span>
            <span className={css.railLabel}>{t(`world.section.${section}`)}</span>
            {issues > 0 && <span className={css.railCount}>{issues}</span>}
            <span className={css.srOnly}>{issues > 0 ? t('world.author.section.issues', { count: issues })
              : t(filled ? 'world.author.section.filled' : 'world.author.section.empty')}{reserved ? ` · ${t('world.author.section.reserved')}` : ''}</span>
          </button></li>
        })}</ol>
      </nav>
      <div ref={editor} className={css.authorEditor}>
        {draft.view === 'graph' ? <>
          {graphState !== 'idle' && <p role={graphState === 'rejected' ? 'alert' : 'status'}>{t(graphState === 'checking' ? 'world.author.graphChecking' : 'world.author.graphRejected')}</p>}
          {graphDefinition.success ? <WorldDraftGraph definition={graphDefinition.data} revision={draft.savedRevision}
            layout={draft.layout} changeLayout={(layout) => { store({ ...draft, layout }) }}
            disabled={formReadOnly || !props.connected || graphState === 'checking'} command={graphCommand} t={t} />
            : <p role="status">{t('world.author.graphInvalid')}</p>}
        </> : draft.view === 'form' ? SECTIONS.map(section => renderSection(specs[section])) : <div className={css.sourceView}>
          <div className={css.sourceToolbar}>
            <ViewSwitch label={t('world.author.format')} value={draft.source.format}
              options={[{ id: 'json', label: 'JSON' }, { id: 'yaml', label: 'YAML', disabled: !draft.syntax.ok }]}
              onChange={(format) => { store(switchFormat(draft, format)) }} />
            <span className={css.muted}><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> {t('world.author.check')} · <kbd>F8</kbd> {t('world.diag.next')}
              {' · '}<kbd>Esc</kbd> → <kbd>Tab</kbd> {t('world.author.leaveSource')}</span>
          </div>
          <DraftSourceEditor ref={source} text={draft.source.text} format={draft.source.format} readOnly={locked}
            markers={diagnostics.flatMap((item): SourceMarker[] => item.line === undefined || item.modified ? []
              : [{ line: item.line, severity: item.severity, message: item.message }])}
            change={(text) => { store(editSource(draft, text, props.undoDepth)) }}
            check={() => { void runCheck() }} stepDiagnostic={stepDiagnostic} t={t} />
        </div>}
      </div>
      {inspector}
    </div>
    <Button className={css.drawerToggle} variant="secondary" aria-expanded={drawer} onClick={() => { setDrawer(!drawer) }}>
      {t('world.author.inspectorToggle', { count: openDiagnostics.length })}</Button>
    {/* One footer bar: what leaving keeps, reopening a saved draft by id, and discard. */}
    <footer className={css.authorFooter}>
      <span className={css.muted}>{t(props.saveDraft === undefined ? 'world.author.leave' : 'world.author.savedLeave')}</span>
      {props.readDraft !== undefined && !locked && <div className={css.savedDraft}>
        <label htmlFor={`${id}-saved-draft`}>{t('world.author.savedDraftId')}</label>
        <Input id={`${id}-saved-draft`} value={savedId} onChange={(event) => { setSavedId(event.target.value) }} />
        <Button size="sm" variant="secondary" disabled={!props.connected || savedId.trim() === '' || draft.pendingSave !== undefined}
          onClick={() => { void loadSaved() }}>{t('world.author.openSavedDraft')}</Button>
        {loadError && <p role="alert">{t('world.author.savedDraftMissing')}</p>}
      </div>}
      {!locked && <Button size="sm" variant="ghost" onClick={() => { setDiscarding(true) }}>{t('world.author.discard')}</Button>}
    </footer>
    {pending !== undefined && <Modal open title={t('world.author.regenerateConfirm')} closeLabel={t('keepEditing')}
      onClose={() => { setPending(undefined) }} footer={<>
        <Button variant="secondary" onClick={() => { setPending(undefined) }}>{t('keepEditing')}</Button>
        <Button variant="primary" onClick={() => {
          const model = pending.model
          setPending(undefined); store(editModel({ ...draft, regenerateAcknowledged: true }, model, props.undoDepth))
        }}>{t('world.author.regenerateConfirm')}</Button></>}>
      <p>{t('world.author.regenerate')}</p></Modal>}
    {confirm && ready !== undefined && <Modal open size="form" title={t('world.create.confirmTitle')} closeLabel={t('world.close')}
      onClose={() => { setConfirm(false) }} footer={<>
        <Button variant="secondary" onClick={() => { setConfirm(false) }}>{t('keepEditing')}</Button>
        <Button variant="primary" disabled={!canCreate || runName.trim() === ''} onClick={create}>{t('world.create.confirm')}</Button></>}>
      <p className={`${css.notice} ${css.confirmNotice}`}>{t('world.create.confirmNotice')}</p>
      <div className={css.field}><label htmlFor={`${id}-run`}>{t('world.create.name')}</label>
        <Input id={`${id}-run`} value={runName} onChange={(event) => { setRunName(event.target.value) }} /></div>
      <h4>{t('world.create.models')}</h4>
      <ul className={css.previewList}>{[...new Set(ready.actors.map(actor => `${actor.model.provider}/${actor.model.name}@${actor.model.version}`))]
        .map(route => <li key={route}><code className={css.mono}>{route}</code></li>)}</ul>
      <h4>{t('world.create.allowances')}</h4>
      <dl className={css.keyValue}>{(['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval'] as const).map(key =>
        <div key={key}><dt>{t(`limit.${key}`)}</dt><dd className={css.figure}>{groupTime(String(ready.limits.native[key]))}</dd></div>)}</dl>
    </Modal>}
    {discarding && <Modal open title={t('world.author.discard')} closeLabel={t('keepEditing')} onClose={() => { setDiscarding(false) }} footer={<>
      <Button variant="secondary" onClick={() => { setDiscarding(false) }}>{t('keepEditing')}</Button>
      <Button variant="danger" onClick={() => { setDiscarding(false); props.discard() }}>{t('world.author.discard')}</Button></>}>
      <p>{t('discardDraftNotice')}</p></Modal>}
  </div>
}
