// Button: token-styled button atom. Variants map to ui-theme role tokens
// (accent, surface, border, failure); no framework imports, all behavior via props.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Button.module.css'

/**
 * Visual variant, each backed by ui-theme role tokens: `primary` is the one
 * accent action on a surface, `secondary` a bordered alternative, `ghost` a
 * quiet inline action, `danger` a destructive action, and `toolbar` a control
 * floating over media.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'toolbar'

/** Control height: `sm` 28px for dense rows, `md` 36px default, `lg` 44px for prominent single actions. */
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Props shared by {@link Button} and {@link IconButton}. */
interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /**
   * Show progress and refuse activation while keeping the label, so a pending
   * action never changes its name under the pointer or screen reader.
   */
  loading?: boolean
  className?: string | undefined
}

function Spinner() {
  return <span className={css.spinner} aria-hidden="true" />
}

/**
 * Render a labeled button.
 * @param props.variant - visual family (default `ghost`).
 * @param props.size - control height (default `md`).
 * @param props.icon - optional leading 16px icon node.
 * @param props.loading - pending state: spinner, `aria-busy`, and no activation.
 * @returns the button element; native button attributes pass through.
 */
export function Button({
  variant = 'ghost', size = 'md', icon, loading = false, disabled, className, children, ...rest
}: ButtonBaseProps & { icon?: ReactNode; children?: ReactNode }) {
  return (
    <button
      type="button"
      className={clsx(css.button, css[variant], css[size], className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon != null && <span className={css.icon}>{icon}</span>}
      {children}
    </button>
  )
}

/**
 * Render a square icon-only button. The accessible name is required by the
 * type, because an icon alone announces nothing.
 * @param props.label - accessible name, also shown as the native tooltip.
 * @param props.icon - the 16px icon node.
 * @returns the button element; native button attributes pass through.
 */
export function IconButton({
  label, icon, variant = 'ghost', size = 'md', loading = false, disabled, className, title, ...rest
}: ButtonBaseProps & { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      className={clsx(css.button, css.iconOnly, css[variant], css[size], className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : <span className={css.icon}>{icon}</span>}
    </button>
  )
}
