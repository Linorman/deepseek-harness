/** Simulation mode tile for the blank hero: loaded runs as a constellation and the latest one. */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'
import type { ObservableSnapshot, SimulationProductRunId, SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'
import { ConstellationGlyph, ModeTile, navigateWithTransition } from '@clocky/clocky-client-ui-viz'

/** Registrant-private inject share for the card. */
export interface ModeCardInjected {
  /** Open one run, or the run directory. */
  open: (runId?: SimulationProductRunId) => void
  /** Read the first bounded directory page. */
  readDirectory: () => Promise<void>
  hooks: { simulation: ObservableSnapshot<SimulationRuntimeState> }
}

type Props = PropsRuntime<'conversation.hero.modes'> & InjectFace<ModeCardInjected> & PropsLocale<'simulation'>

/**
 * Render the tile. When the directory has not been read yet and the tile is
 * on screen, it reads the first bounded page once; it never pages further.
 * @param props - Simulation runtime hook, read and open actions, and copy.
 * @returns a tile that opens the latest loaded run or the directory.
 */
export function ModeCard({ useSimulation, open, readDirectory, t }: Props) {
  const runs = useSimulation(state => state.directory.value?.items)
  const more = useSimulation(state => state.directory.value?.nextCursor !== undefined)
  const loading = useSimulation(state => state.directory.loading)
  const connected = useSimulation(state => state.connected)
  const requested = useRef(false)
  useEffect(() => {
    if (requested.current || runs !== undefined || loading || !connected) return
    requested.current = true
    void readDirectory()
  }, [runs, loading, connected, readDirectory])
  const loaded = runs ?? []
  const latest = loaded[0]
  return <ModeTile mode="simulation" eyebrow={t('mode.eyebrow')} title={t('mode.title')} tagline={t('mode.tagline')}
    label={`${t('mode.title')} · ${t('mode.open')}`} transitionName="clocky-mode-simulation"
    onOpen={() => { navigateWithTransition(() => { open() }, 'page') }}
    stats={runs === undefined ? [] : [{ id: 'runs', value: `${String(loaded.length)}${more ? '+' : ''}`, label: t('mode.stat.runs') }]}
    recent={runs === undefined ? t('mode.loading')
      : latest === undefined ? t('mode.none') : t('mode.recent', { name: latest.name.text })}
    preview={<ConstellationGlyph label={t('mode.preview', { count: loaded.length })} points={loaded.map(run => ({ id: run.id }))} />} />
}
