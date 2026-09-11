/**
 * Adaptive chooser of the directory-picker seam: resolves the host's
 * situation once at boot (bind host, SSH launch, display session, Linux
 * chooser binary) and mounts the matching host backend — `native` or `browse`
 * — as a real Loader entry in the in-memory root tree. It does not compose a
 * browser directory-picker interaction.
 * @module @clocky/clocky-host-directory-picker-auto
 */

import type { Context } from '@clocky/cordis'
// Empty type imports carry the `loader` and `webServer` Context merges for the reads below.
import type {} from '@clocky/cordis-plugin-loader'
import type {} from '@clocky/clocky-host-webserver'
import { canExecute, hasLinuxChooserBinary } from './probe.ts'
import type { DirectoryPickerBackendKind } from './resolve.ts'
import { resolveDirectoryPickerBackend } from './resolve.ts'

export { canExecute, hasLinuxChooserBinary } from './probe.ts'
export type { DirectoryPickerBackendKind, DirectoryPickerEnv, DirectoryPickerHostFacts } from './resolve.ts'
export { resolveDirectoryPickerBackend } from './resolve.ts'

/** Cordis plugin name. */
export const name = 'directory-picker-auto'
/** Required services: the effective bind host (`webServer`) and the entry tree the backend mounts into (`loader`). */
export const inject = ['webServer', 'loader']

/**
 * Host backend package per resolved kind — fixed composition vocabulary, not a
 * tunable. Exported because the reference is a runtime string the static
 * config gate cannot see in a yml row: `verify-cordis-config` requires every
 * app composing this chooser to declare both values as dependencies.
 */
export const BACKEND_PACKAGES: Record<DirectoryPickerBackendKind, string> = {
  native: '@clocky/clocky-host-directory-picker-native',
  browse: '@clocky/clocky-host-directory-picker-browse',
}

/**
 * Resolve the backend from one boot-time sample and mount it as a Loader entry.
 * The effect's disposer removes the entry and joins its teardown.
 * @param ctx - cordis context carrying the injected `webServer` and `loader`.
 */
export async function apply(ctx: Context): Promise<void> {
  const backend = resolveDirectoryPickerBackend({
    bindHost: ctx.webServer.host,
    platform: process.platform,
    env: process.env,
    linuxChooser: hasLinuxChooserBinary(process.env.PATH, canExecute),
  })
  await ctx.effect(async () => {
    const id = await ctx.loader.create({ name: BACKEND_PACKAGES[backend] })
    return async () => {
      if (ctx.loader.store[id] !== undefined) await ctx.loader.remove(id)
    }
  }, 'directory-picker-auto: backend entry')
}
