/** Artifact rendering consumes one runtime-owned byte window; navigation never owns source data. */
import type { TeamArtifactDetailState, TeamArtifactReadResult, TeamArtifactReference, TeamCollectionsState, TeamCollectionKind } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

/**
 * @param props - Current references, authoritative read state and exact read/collection callbacks.
 * @returns accessible list, empty/error feedback and bounded provider-approved preview with download.
 */
export function ArtifactsWorkspace({ artifacts, collections, detail, read: readArtifact, readCollections, t }: {
  artifacts: readonly TeamArtifactReference[]
  collections?: TeamCollectionsState | undefined
  detail?: TeamArtifactDetailState | undefined
  read?: ((id: string) => Promise<void>) | undefined
  readCollections?: ((collection: TeamCollectionKind, mode?: 'first' | 'next' | 'refresh') => Promise<void>) | undefined
  t: (key: TeamKey) => string
}) {
  const read = readArtifact
  const loadingId = detail?.loading ? detail.artifactId : undefined
  const artifact = detail?.value
  const artifactError = detail?.error
  return (
    <section className={css.section} aria-label={t('detail.artifacts')}>
      <div className={css.sectionHeader}><h2>{t('detail.artifacts')}</h2>
        {collections?.artifacts.startCursor !== undefined && collections.artifacts.startCursor >= 0 && readCollections !== undefined && <button type="button"
          disabled={collections.artifacts.loading || collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts', 'first') }}>
          {t('detail.firstPage')}
        </button>}
        {collections?.artifacts.nextCursor !== undefined && readCollections !== undefined && <button type="button"
          disabled={collections.artifacts.loading || collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts', 'next') }}>
          {t('detail.loadArtifacts')}
        </button>}
        {readCollections !== undefined && <button type="button"
          disabled={collections?.artifacts.loading || collections?.artifacts.loadingMore} onClick={() => { void readCollections('artifacts') }}>
          {t('detail.refreshArtifacts')}
        </button>}
      </div>
      {artifacts.length > 0 && (
        <ul className={css.list}>{artifacts.map(artifact => (
          <li key={artifact.id} className={css.record}>
            <strong>{artifact.id}</strong>
            <small>{artifact.kind}</small>
            {readArtifact !== undefined && artifact.provider !== undefined && (
              <button
                type="button"
                disabled={loadingId !== undefined || detail?.disconnected}
                onClick={() => { void read?.(artifact.id) }}
              >
                {loadingId === artifact.id ? t('detail.artifactLoading') : t('detail.artifactRead')}
              </button>
            )}
            {(readArtifact === undefined || artifact.provider === undefined) && (
              <span className={css.muted}>{t('detail.artifactUnavailable')}</span>
            )}
          </li>
        ))}</ul>
      )}
      {loadingId !== undefined && <p className={css.muted} role="status">{t('detail.artifactLoading')}</p>}
      {detail?.disconnected && <p className={css.muted} role="status">{t('detail.artifactDisconnected')}</p>}
      {!detail?.disconnected && detail?.stale && <p className={css.muted} role="status">{t('detail.artifactStale')}</p>}
      {artifactError !== undefined && <p className={css.error} role="alert">{artifactError}</p>}
      {readCollections !== undefined && <p className={css.muted}>{t('detail.pageWindow')}</p>}
      {collections?.artifacts.loading && <p className={css.muted} role="status">{t('detail.artifactsLoading')}</p>}
      {collections?.artifacts.error !== undefined && <p className={css.error} role="alert">{collections.artifacts.error}</p>}
      {artifacts.length === 0 && !collections?.artifacts.loading && collections?.artifacts.error === undefined
              && <p className={css.muted} role="status">{t('detail.artifactsEmpty')}</p>}
      {artifact !== undefined && <div className={css.result} aria-label={t('detail.artifactRead')}>
        <strong>{artifact.artifact.id}</strong>
        <p className={css.muted} role="status">{artifact.bytes} {t('detail.artifactBytes')}</p>
        {artifact.artifact.kind === 'screenshot' || artifact.artifact.kind === 'file'
          ? <p className={css.muted}>{t('detail.artifactBinary')}</p>
          : <pre className={css.json}>{previewArtifactText(artifact.data)}</pre>}
        <button type="button" onClick={() => { downloadArtifact(artifact) }}>{t('detail.artifactDownload')}</button>
      </div>}
    </section>
  )
}

/** Cap text rendering while retaining the complete provider bytes for download. */
const MAX_ARTIFACT_PREVIEW_BYTES = 128 * 1024

function previewArtifactText(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const preview = new TextDecoder().decode(bytes.subarray(0, MAX_ARTIFACT_PREVIEW_BYTES))
  return bytes.length > MAX_ARTIFACT_PREVIEW_BYTES ? `${preview}\n…` : preview
}

function downloadArtifact(result: TeamArtifactReadResult): void {
  const binary = atob(result.data)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `artifact-${result.artifact.id.replace(/[^A-Za-z0-9._-]+/g, '-') || 'download'}`
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}
