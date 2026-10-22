/** Frozen preflight preview grouped for review; an edited draft dims it instead of clearing it. */
import { useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductWorldPreflightResult } from '@clocky/clocky-client-runtime/client'
import type { Json } from './world-draft.ts'
import { asObject, getPath } from './world-draft.ts'
import { CopyId } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { OccupancyMeter } from './WorldTracks.tsx'
import css from './World.module.css'

/** Ready preflight result. */
export type ReadyPreview = Extract<SimulationProductWorldPreflightResult, { status: 'ready' }>

/**
 * Review the resolved definition: roles and models, director authority, governance, sources, allowances, fingerprint.
 * @param props.value - Ready preflight result.
 * @param props.model - Current draft model, used to label overrides versus installed defaults.
 * @param props.outdated - Draft changed since this preview.
 * @param props.recheck - Explicit re-check.
 * @returns collapsible groups; the first three start open.
 */
export function PreviewPanel({ value, model, outdated, recheck, t }: {
  value: ReadyPreview
  model: Json
  outdated: boolean
  recheck: () => void
  t: WorldT
}) {
  const [allLimits, setAllLimits] = useState(false)
  const limits = (['native', 'team', 'world'] as const).flatMap(group => Object.entries(value.limits[group] as Record<string, unknown>)
    .map(([key, limit]) => ({ group, key, value: String(limit),
      override: getPath(model, ['limits', group, key]) !== undefined })))
  const shown = allLimits ? limits : limits.slice(0, 12)
  const v1 = 'apiVersion' in value ? value : undefined
  const director = value.actors.find(actor => actor.role === 'director')
  const draftGovernance = Object.keys(asObject(model)).filter(key => key === 'committees' || key === 'norms')
  return <section className={css.preview} data-outdated={outdated || undefined} aria-label={t('world.preview.title')}>
    <h3>{t('world.preview.title')}{outdated && <span className={css.staleTag}>{t('world.preview.outdated')}</span>}</h3>
    <PreflightCapabilities value={value} t={t} />
    {outdated && <div className={css.warning} role="status"><span>{t('world.preview.outdated')}</span>
      <Button size="sm" variant="secondary" onClick={recheck}>{t('world.preview.recheck')}</Button></div>}
    <div className={css.previewBody}>
      <p className={css.previewOrg}><strong>{value.organization.name}</strong><span>{value.organization.description}</span></p>
      <p className={css.simNotice} role="note" data-world-simulated-only>
        <span aria-hidden="true">◎</span><span>{t('world.ext.notice')}</span></p>
      <details open><summary>{t('world.preview.actors')} <span className={css.figure}>{value.actors.length}</span></summary>
        <ul className={css.previewList}>{value.actors.map(actor => <li key={actor.entityId}>
          <span className={css.previewName}>{actor.name}
            {actor.role === 'director' && <span className={css.badge} data-tone="accent">{t('world.preview.director')}</span>}</span>
          <code className={css.mono}>{actor.model.provider}/{actor.model.name}@{actor.model.version}</code>
          <small>{actor.template.id} v{actor.template.version}</small>
        </li>)}</ul>
      </details>
      <details open><summary>{t('world.preview.authority')}</summary>
        {director !== undefined && <p>{director.name} · <code>{director.entityId}</code></p>}
        <p className={css.notice}>{t('world.preview.authorityNotice')}</p>
        {v1 !== undefined && <>
          <h5>{t('world.field.domain')}</h5>
          <ul className={css.previewList}>{v1.scope.domains.map(pin => <li key={`${pin.domain}/${pin.operation}/${pin.version}`}>
            <code>{pin.domain}.{pin.operation}/v{pin.version}</code><small>{pin.implementationRef} · {pin.generation}</small>
          </li>)}</ul>
          <h5>{t('world.field.permissions')}</h5>
          <ul className={css.previewList}>{v1.permissions.map(grant => <li key={grant.id}>
            <code>{grant.personId}</code><span>{grant.domain}.{grant.operation}/v{grant.version}</span>
            <small>{grant.scopeId} → {grant.targetId} · [{grant.validFrom}, {grant.validUntil ?? '∞'})</small>
          </li>)}</ul>
          {v1.positionPermissions.filter(value => value.permissions.length > 0).map(position => <div key={position.positionEntityId}>
            <code>{position.positionEntityId}</code><ul className={css.previewList}>{position.permissions.map((permission, index) =>
              <li key={index}><span>{permission.domain}.{permission.operation}/v{permission.version}</span>
                <small>{permission.scopeId} → {permission.targetId}</small></li>)}</ul>
          </div>)}
        </>}
        <h5>{t('world.preview.authorizations')}</h5>
        {value.authorizations.length === 0 ? <p className={css.muted}>{t('world.preview.none')}</p>
          : <ul className={css.previewList}>{value.authorizations.map(grant => <li key={`${grant.requesterEntityId}/${grant.positionEntityId}`}>
            <code>{grant.requesterEntityId}</code> → <code>{grant.positionEntityId}</code></li>)}</ul>}
      </details>
      <details open><summary>{t('world.preview.governance')}</summary>
        <h5>{t('world.preview.positions')}</h5>
        <ul className={css.previewList}>{value.positions.map(position => <li key={position.entityId}>
          <span className={css.previewName}>{position.name}</span>
          <OccupancyMeter occupied={position.occupied} reserved={0} capacity={position.capacity} t={t} /></li>)}</ul>
        {v1 !== undefined && <>
          <h5>{t('world.section.committees')}</h5>
          <ul className={css.previewList}>{v1.committees.map(committee => <li key={committee.id}>
            <span className={css.previewName}>{committee.name}</span>
            <small>{committee.scopeId} · {t('world.field.quorum')}: {committee.quorum} · {committee.rule.kind}</small>
            {committee.members.map(member => <small key={member.id}>{member.personId} · [{member.validFrom}, {member.validUntil ?? '∞'})</small>)}
          </li>)}</ul>
          <h5>{t('world.section.norms')}</h5>
          <ul className={css.previewList}>{v1.institutions.map(norm => <li key={norm.id}>
            <code>{norm.id}</code><span>{norm.enforcement.kind}</span>
            <small>{norm.scopeId} · [{norm.effectiveFrom}, {norm.effectiveUntil ?? '∞'}) · {t('world.field.knowable')}: {norm.availableAt}</small>
            {norm.enforcement.kind === 'validated' && <small>{norm.enforcement.policyRef} · {norm.enforcement.params.committeeId}</small>}
          </li>)}</ul>
        </>}
        {v1 === undefined && draftGovernance.length === 0 && <p className={css.muted}>{t('world.section.committees')} · {t('world.preview.none')}</p>}
      </details>
      <details><summary>{t('world.preview.sources')}</summary>
        <p className={css.notice}>{t('world.preview.sourcesNotice')}</p>
        {v1 === undefined ? <p className={css.muted}>{t('world.preview.none')}</p> : <dl className={css.keyValue}>
          {([
            ['facts', 'world.field.facts'], ['privateBeliefs', 'world.section.knowledge'], ['resources', 'world.section.resources'],
            ['externalIdentities', 'world.section.external'], ['initialGoals', 'world.field.goals'], ['calendars', 'world.field.calendar'],
            ['directorEvents', 'world.field.directorEvents'],
          ] as const).map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd>{v1.sources[key]}</dd></div>)}
        </dl>}
      </details>
      <details><summary>{t('world.preview.allowances')} <span className={css.figure}>{limits.length}</span></summary>
        <dl className={css.keyValue}>{shown.map(item => <div key={`${item.group}.${item.key}`}>
          <dt><code>{item.group}.{item.key}</code></dt>
          <dd><span className={css.figure}>{item.value}</span>
            <small>{t(item.override ? 'world.preview.allowanceSource.override' : 'world.preview.allowanceSource.default')}</small></dd>
        </div>)}</dl>
        <p className={css.muted}>{t('limit.maxTime')}: {value.maxTime} · {value.tickUnit} · {t('budgetInterval')}: {value.budgetInterval}</p>
        {!allLimits && limits.length > 12 && <Button size="sm" variant="ghost" onClick={() => { setAllLimits(true) }}>
          {t('world.preview.showAll', { count: limits.length })}</Button>}
      </details>
      <details><summary>{t('world.preview.fingerprint')}</summary>
        <dl className={css.keyValue}>
          <div><dt>{t('world.preview.fingerprint')}</dt><dd><CopyId value={value.preview.hash} t={t} /></dd></div>
          <div><dt>{t('world.preview.catalog')}</dt><dd><CopyId value={value.preview.catalogGeneration} t={t} /></dd></div>
        </dl>
      </details>
    </div>
  </section>
}

/**
 * Deployment fit of a ready preflight: provable violations first (dimension, actual and required values), then backup
 * coverage, stop clocks, model capacity and the per-request allowance; unmeasured values say so instead of showing zero.
 * @param props.value - Ready preflight result; peers without capability data say so.
 * @returns a review section.
 */
export function PreflightCapabilities({ value, t }: { value: ReadyPreview; t: WorldT }) {
  const capabilities = value.capabilities
  if (capabilities === undefined) return <p className={css.muted} data-preflight-capabilities="unavailable">{t('world.fit.unavailable')}</p>
  const grouped = (count: number) => String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return <section className={css.preflightFit} aria-label={t('world.fit.title')} data-preflight-capabilities>
    <h4>{t('world.fit.title')}</h4>
    {capabilities.violations.length > 0 && <ul role="alert" className={css.fitViolations}>{capabilities.violations.map(violation =>
      <li key={`${violation.dimension}:${violation.model}`} data-violation={violation.dimension}>{t('world.fit.violation.context-window', {
        model: violation.model, actual: grouped(violation.actual), required: grouped(violation.required) })}</li>)}</ul>}
    <dl className={css.keyValue}>
      <div><dt>{t('world.fit.backup')}</dt><dd data-backup={capabilities.backup}>{t(`world.fit.backup.${capabilities.backup}`)}</dd></div>
      <div><dt>{t('world.fit.clock')}</dt><dd>{t('world.fit.clock.native', { unit: capabilities.clocks.native.unit,
        maxTime: capabilities.clocks.native.maxTime })}{capabilities.clocks.domains.map(clock =>
        <span key={`${clock.domain}:${clock.name}`}> · <code>{clock.domain}/{clock.name}</code></span>)}</dd></div>
      <div><dt>{t('world.fit.allowance')}</dt><dd>{grouped(capabilities.tokensPerRequest)}</dd></div>
      {capabilities.models.map(model => <div key={`${model.provider}/${model.name}`}><dt><code>{model.provider}/{model.name}</code></dt>
        <dd>{model.contextWindow === null ? t('world.fit.contextUnknown') : t('world.fit.context', { tokens: grouped(model.contextWindow) })}
          {model.maxOutputTokens !== null && ` · ${t('world.fit.output', { tokens: grouped(model.maxOutputTokens) })}`}</dd></div>)}
      <div><dt>{t('world.fit.initialContext')}</dt><dd>{t('world.fit.initialContext.unknown')}</dd></div>
      <div><dt>{t('world.fit.longRun')}</dt><dd>{t('world.fit.longRun.unknown')}</dd></div>
    </dl>
  </section>
}
