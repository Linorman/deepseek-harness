// Empty-state launcher under the hero composer: where the Team will work,
// which preset its coordinator uses, and three suggested first messages.

import type { ConversationSlotProps } from '../contract/slots.ts'
import { IconAgentPresetOutline16, IconFolderOpenOutline16, IconSparkle16 } from '@clocky/clocky-client-ui-primitives'
import { useRef, type ReactNode } from 'react'
import { PointerLight, usePointerLight } from '@clocky/clocky-client-ui-viz'
import css from './HeroLauncher.module.css'

const STARTERS = ['launcher.starter.1', 'launcher.starter.2', 'launcher.starter.3'] as const

/** Last path segment for a compact chip label. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(part => part.length > 0)
  return parts[parts.length - 1] ?? path
}

/**
 * Render the launcher.
 * @param props.cwd - the draft's working folder, when chosen.
 * @param props.agentPreset - the draft's coordinator preset, when chosen.
 * @param props.pickFolder - open the Host folder picker; absent hides the action.
 * @param props.setDraftText - replace the composer draft with a starter.
 * @param props.focusComposer - return focus to the composer after a starter.
 * @param props.t - conversation copy.
 * @returns the launcher group.
 */
export function HeroLauncher({ cwd, agentPreset, pickFolder, setDraftText, focusComposer, t }: {
  cwd: string | undefined
  agentPreset: string | undefined
  pickFolder: (() => Promise<void>) | undefined
  setDraftText: (text: string) => void
  focusComposer: () => void
  t: ConversationSlotProps['t']
}) {
  return (
    <div className={css.launcher} role="group" aria-label={t('launcher.label')}>
      <div className={css.chips}>
        <button
          type="button"
          className={css.chip}
          disabled={pickFolder === undefined}
          title={cwd === undefined ? t('launcher.folder.choose') : t('launcher.folder.title', { path: cwd })}
          onClick={() => { void pickFolder?.() }}
        >
          <IconFolderOpenOutline16 size={14} />
          <span className={css.chipText}>{cwd === undefined ? t('launcher.folder.choose') : folderName(cwd)}</span>
        </button>
        <span className={css.chip} data-static title={t('launcher.preset.title')}>
          <IconAgentPresetOutline16 size={14} />
          <span className={css.chipText}>{agentPreset ?? t('launcher.preset.default')}</span>
        </span>
      </div>
      <ul className={css.starters} aria-label={t('launcher.starters')}>
        {STARTERS.map(key => (
          <li key={key}>
            <Starter onClick={() => { setDraftText(t(key)); focusComposer() }}>
              <IconSparkle16 size={14} />
              <span>{t(key)}</span>
            </Starter>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One suggested starter; a soft light follows a fine pointer across it. */
function Starter({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null)
  usePointerLight(button)
  return <button ref={button} type="button" className={css.starter} onClick={onClick}><PointerLight />{children}</button>
}
