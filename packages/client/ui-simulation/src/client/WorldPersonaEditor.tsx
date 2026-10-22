/** Finite Persona choices use the retained management command; preview and commit remain Host-owned. */
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { parsePersonaManagementCommand } from '@clocky/clocky-simulation-product/world-management-schema'
import type { PersonaField } from './world-domain.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** @param props - Current authorized options and original command. @returns finite, keyboard-accessible authoring controls. */
export function PersonaEditor({ field, value, id, change, t }: {
  field: PersonaField
  value: string
  id: string
  change: (value: string) => void
  t: WorldT
}) {
  const update = (command: object) => { change(JSON.stringify(command)) }
  const initial = () => {
    const template = field.templates[0]
    if (template === undefined) return
    update({ kind: 'draft', id: crypto.randomUUID(), expectedRevision: 0, organizationEntityId: field.organizationEntityId,
      positionEntityId: field.positionEntityId, validUntil: field.maxTime,
      body: { templateId: template.id, templateVersion: template.version,
        persona: { name: template.names[0], skills: [], traits: [], goals: [] } } })
  }
  if (value === '') return <div className={css.field}>
    <p>{t('world.market.createNotice')}</p>
    <Button id={id} variant="secondary" onClick={initial}>{t('world.market.createDraft')}</Button>
  </div>
  let raw: unknown
  try { raw = JSON.parse(value) }
  catch { return <p role="alert">{t('world.market.invalidDraft')}</p> }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return <p role="alert">{t('world.market.invalidDraft')}</p>
  let command: ReturnType<typeof parsePersonaManagementCommand>
  try { command = parsePersonaManagementCommand(JSON.stringify('kind' in raw && raw.kind === 'draft'
    ? { ...raw, validUntil: field.maxTime } : { ...raw, reason: 'Review' })) }
  catch { return <p role="alert">{t('world.market.invalidDraft')}</p> }
  if (command.kind === 'review') return <div className={css.field}>
    <p>{command.id} · r{command.revision} · {command.bodyHash}</p>
    <label htmlFor={id}>{t('world.market.reason')}</label>
    <Input id={id} value={'reason' in raw && typeof raw.reason === 'string' ? raw.reason : ''}
      onChange={(event) => { update({ ...command, reason: event.target.value }) }} />
  </div>
  const validUntil = 'validUntil' in raw && typeof raw.validUntil === 'string' ? raw.validUntil : ''
  const template = field.templates.find(item => item.id === command.body.templateId && item.version === command.body.templateVersion)
  if (template === undefined) return <p role="alert">{t('world.market.templateUnavailable')}</p>
  const setBody = (body: typeof command.body) => { update({ ...command, validUntil, body }) }
  return <div className={css.field}>
    <p>{command.id} · {t('world.market.revisionsRemaining', { count: field.maxRevisions - command.expectedRevision })}</p>
    <fieldset className={css.choiceGroup}><legend>{t('world.market.template')}</legend>
      {field.templates.map(item => <label key={`${item.id}/${item.version}`} className={css.choice}>
        <input type="radio" name={`${id}-template`} checked={item.id === template.id && item.version === template.version}
          onChange={() => { setBody({ templateId: item.id, templateVersion: item.version,
            persona: { name: item.names[0] ?? '', skills: [], traits: [], goals: [] } }) }} />{item.id} · {item.version}
      </label>)}
    </fieldset>
    <fieldset className={css.choiceGroup}><legend>{t('world.author.nodeName')}</legend>
      {template.names.map((name, index) => <label key={name} className={css.choice}>
        <input id={index === 0 ? id : undefined} type="radio" name={`${id}-name`} checked={command.body.persona.name === name}
          onChange={() => { setBody({ ...command.body, persona: { ...command.body.persona, name } }) }} />{name}
      </label>)}
    </fieldset>
    {(['skills', 'traits', 'goals'] as const).map(key => <fieldset key={key} className={css.choiceGroup}>
      <legend>{t(`world.market.${key}`)}</legend>
      {template[key].map(option => <label key={option} className={css.choice}>
        <input type="checkbox" checked={command.body.persona[key].includes(option)} onChange={(event) => {
          const selected = event.target.checked ? [...command.body.persona[key], option]
            : command.body.persona[key].filter(item => item !== option)
          setBody({ ...command.body, persona: { ...command.body.persona, [key]: selected } })
        }} />{option}
      </label>)}
    </fieldset>)}
    <label htmlFor={`${id}-deadline`}>{t('world.market.reviewDeadline')}</label>
    <Input id={`${id}-deadline`} inputMode="numeric" value={validUntil}
      onChange={(event) => { update({ ...command, validUntil: event.target.value }) }} />
    <p className={css.notice}>{t('world.market.regenerateNotice')}</p>
    <Button variant="secondary" onClick={() => {
      const next = (template.names.indexOf(command.body.persona.name) + 1) % template.names.length
      setBody({ ...command.body, persona: { name: template.names[next] ?? '', skills: [...template.skills],
        traits: [...template.traits], goals: [...template.goals] } })
    }}>{t('world.market.regenerate')}</Button>
  </div>
}
