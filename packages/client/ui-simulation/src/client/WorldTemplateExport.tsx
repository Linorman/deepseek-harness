/** Inert template distribution metadata and exact installed dependency inventory. */
import { useId, useState } from 'react'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { parseWorldTemplatePackage, worldScenarioV1Schema, worldTemplatePackageSchema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioTemplateManifest } from '@clocky/clocky-simulation-scenario'
import type { SimulationProductWorldPreflightResult } from '@clocky/clocky-client-runtime/client'
import type { WorldAuthorDraft } from './world-draft.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/**
 * Package a currently checked complete definition with an explicit license and implementation pins.
 * @param props - Private draft, current preview and caller-owned save/download callbacks.
 * @returns bounded metadata fields; exporting installs no code or world state.
 */
export function WorldTemplateExport({ draft, ready, disabled, change, download, t }: {
  draft: WorldAuthorDraft
  ready: Extract<SimulationProductWorldPreflightResult, { status: 'ready' }> | undefined
  disabled: boolean
  change: (manifest: ScenarioTemplateManifest | undefined) => boolean
  download: (name: string, text: string, format: 'json') => void
  t: WorldT
}) {
  const id = useId()
  const [invalid, setInvalid] = useState(false)
  const [packageId, setPackageId] = useState(draft.templateManifest?.id ?? '')
  const [version, setVersion] = useState(draft.templateManifest?.version ?? '1')
  const [license, setLicense] = useState(draft.templateManifest?.license.identifier ?? '')
  const [notice, setNotice] = useState(draft.templateManifest?.license.notice ?? '')
  const parsed = worldScenarioV1Schema.safeParse(draft.model)
  const available = !disabled && ready !== undefined && 'scope' in ready && 'domains' in ready.scope && parsed.success
  const exportPackage = () => {
    if (!available) return
    const definition = parsed.data
    const result = worldTemplatePackageSchema.safeParse({ apiVersion: 'clocky.world-template/v1', definition,
      manifest: { id: packageId, version, license: { identifier: license, notice }, attribution: draft.templateManifest?.attribution ?? [],
        dependencies: { domains: ready.scope.domains, policyVersion: ready.policyVersion,
          runtimeProfiles: definition.runtimeProfiles.allowed, templates: definition.runtimeProfiles.templates,
          normPolicies: [...new Set(definition.governance.norms.flatMap(norm => norm.enforcement.kind === 'validated'
            ? [norm.enforcement.policyRef] : []))] } } })
    setInvalid(!result.success)
    if (!result.success) return
    const text = `${JSON.stringify(result.data, null, 2)}\n`
    if (!parseWorldTemplatePackage(text).ok) { setInvalid(true); return }
    if (!change(result.data.manifest)) return
    download('world-template.json', text, 'json')
  }
  return <details className={css.notice}>
    <summary>{t('world.author.templatePackage')}</summary>
    <p>{t('world.author.templatePackageNotice')}</p>
    {invalid && <p role="alert" className={css.error}>{t('world.author.packageInvalid')}</p>}
    <fieldset disabled={disabled} className={css.fieldGrid} aria-label={t('world.author.templatePackage')}>
      <div className={css.field}><label htmlFor={`${id}-id`}>{t('world.author.packageId')}</label>
        <Input id={`${id}-id`} value={packageId} maxLength={256} onChange={(event) => { setPackageId(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-version`}>{t('world.author.packageVersion')}</label>
        <Input id={`${id}-version`} value={version} maxLength={256} onChange={(event) => { setVersion(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-license`}>{t('world.author.license')}</label>
        <Input id={`${id}-license`} value={license} maxLength={256} onChange={(event) => { setLicense(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-notice`}>{t('world.author.licenseNotice')}</label>
        <textarea className={`${css.textarea} ${css['resize-none']}`} rows={3} id={`${id}-notice`} value={notice} maxLength={8192}
          onChange={(event) => { setNotice(event.target.value) }} /></div>
      {draft.templateManifest !== undefined && <Button variant="secondary" onClick={() => { change(undefined) }}>
        {t('world.author.detachPackage')}</Button>}
      <Button disabled={!available || packageId.trim() === '' || version.trim() === '' || license.trim() === ''}
        onClick={exportPackage}>{t('world.author.exportPackage')}</Button>
    </fieldset>
  </details>
}
