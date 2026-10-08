import type { Context } from '@clocky/cordis'
import base from '../styles/base.css?inline'
import tokens from '../styles/tokens.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import markdownType from '../styles/markdown-type.css?inline'
import shiki from '../styles/shiki.css?inline'
import transitions from '../styles/transitions.css?inline'

const PLUGIN_ID = '@clocky/clocky-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['tokens.css', tokens],
  ['scrollbar.css', scrollbar],
  ['markdown-type.css', markdownType],
  ['shiki.css', shiki],
  ['transitions.css', transitions],
] as const

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
