// ConnectionBanner: a top strip for connection loss or an expired product
// credential. The atom is pure: the owner reads connection state and passes
// it down. Connecting and connected states stay quiet.

import css from './ConnectionBanner.module.css'

/** Connection states the banner distinguishes; others render nothing. */
export type ConnectionBannerState = 'connecting' | 'connected' | 'reconnecting' | 'unauthorized'

/** Owner-supplied words. */
export interface ConnectionBannerLabels {
  reconnecting: string
  unauthorized: string
  /** How to recover from an expired credential, for example reopening from the terminal. */
  unauthorizedHint: string
  /** Explicit retry after the browser credential has been renewed. */
  retry?: string
}

/** Chinese product copy; owners pass English as needed. */
export const DEFAULT_CONNECTION_BANNER_LABELS: ConnectionBannerLabels = {
  reconnecting: '连接已断开，正在重连…',
  unauthorized: '本地访问凭据已失效。',
  unauthorizedHint: '请在终端重新运行 clocky web 打开新窗口。',
  retry: '重新检查访问',
}

/**
 * Render the banner for a reconnecting or unauthorized connection.
 * @param props.state - coarse connection state.
 * @param props.labels - localized words.
 * @param props.onRetry - one explicit authentication handshake after credentials are renewed.
 * @returns the banner, or null while connecting or connected.
 */
export function ConnectionBanner({ state, labels = DEFAULT_CONNECTION_BANNER_LABELS, onRetry }: {
  state: ConnectionBannerState
  labels?: ConnectionBannerLabels
  onRetry?: (() => void) | undefined
}) {
  if (state === 'reconnecting') {
    return <div className={css.banner} data-state="reconnecting" role="status">{labels.reconnecting}</div>
  }
  if (state === 'unauthorized') {
    return (
      <div className={css.banner} data-state="unauthorized" role="alert">
        <strong>{labels.unauthorized}</strong> {labels.unauthorizedHint}
        {onRetry !== undefined && <button type="button" className={css.retry} onClick={onRetry}>
          {labels.retry ?? DEFAULT_CONNECTION_BANNER_LABELS.retry}
        </button>}
      </div>
    )
  }
  return null
}
