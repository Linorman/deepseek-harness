/**
 * The agent-preset settings controller: it derives both the options and the
 * current default from one roster call, writes only the `default` field, and
 * treats an empty roster as "this deployment composes no presets" rather than
 * as a failure.
 */

import { describe, expect, it } from 'vitest'
import type { IApiClient } from '@clocky/clocky-api-remotes/client'
import { SettingsDescribeMirror } from '@clocky/clocky-client-ui-settings/src/client/settings-mirror.ts'
import {
  AGENT_PRESET_SETTINGS_NS, AgentPresetSettingsController, messageOf,
} from '../src/client/settings-store.ts'

/** Controller over a real mirror derived from the same fake wire. */
function derivedController(api: IApiClient) {
  return new AgentPresetSettingsController(api, new SettingsDescribeMirror(api))
}
interface Recorded { ns: string; patch: unknown }

/** A client whose roster and write outcome the test controls. */
function fakeApi(
  presets: { id: string; trust: 'system' | 'user'; isDefault: boolean }[],
  options: {
    writes?: Recorded[]
    failWrite?: string
    failList?: string
    failWriteWith?: Error
    readOnly?: boolean
  } = {},
): IApiClient {
  return {
    agentPresets: {
      list: () => Promise.resolve(options.failList === undefined
        ? { rpcId: 'r', result: { ok: true as const, value: { presets } } }
        : { rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message: options.failList, details: {} } } }),
    },
    settings: {
      // Loopback-only in production; a read-only provider answers writable:false
      // and the row disables its control instead of offering a refused write.
      describe: () => Promise.resolve({
        rpcId: 'r',
        result: {
          ok: true as const,
          value: { writable: options.readOnly !== true, hasDocument: true, namespaces: [] },
        },
      }),
      update: (payload: { ns: string; patch: unknown }) => {
        options.writes?.push({ ns: payload.ns, patch: payload.patch })
        if (options.failWriteWith !== undefined) return Promise.reject(options.failWriteWith)
        if (options.failWrite !== undefined) {
          return Promise.resolve({ rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message: options.failWrite, details: {} } } })
        }
        // A committed write moves the roster's default, exactly as the host does.
        for (const preset of presets) {
          preset.isDefault = preset.id === (payload.patch as { default?: string }).default
        }
        return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } })
      },
    },
  } as unknown as IApiClient
}

describe('the agent-preset settings controller', () => {
  it('disables the control when this browser may not write settings', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
    ], { readOnly: true }))

    await controller.load()

    // `settings.describe` is loopback-only and reports a read-only provider;
    // offering a control whose write answers `settings-rejected` would promise
    // a switch the host refuses.
    expect(controller.store.getSnapshot().writable).toBe(false)
    expect(controller.store.getSnapshot().currentValue).toBe('standard')
  })

  it('derives options and the current default from one roster call', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'mine', trust: 'user', isDefault: false },
    ]))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.currentValue).toBe('standard')
    expect(state.options).toEqual([
      { id: 'standard', trust: 'system' },
      { id: 'mine', trust: 'user' },
    ])
  })

  it('offers no broken preset: the pickers choose the NEXT session\'s composition', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'damaged', trust: 'user', isDefault: false, broken: 'the composition is not valid YAML' },
    ] as never))

    await controller.load()

    // A broken preset cannot compose a session; listing it here would defer
    // that discovery to a failed session start. The management section shows
    // (and deletes) it from its own store instead.
    expect(controller.store.getSnapshot().options.map(option => option.id)).toEqual(['standard'])
  })

  it('carries the display metadata a preset published', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    ] as never))

    await controller.load()

    // Surfaces beyond this row read the same options; the id alone never said
    // what a preset does.
    expect(controller.store.getSnapshot().options).toEqual([
      { id: 'standard', trust: 'system', name: '标准模式', description: '完整的编码 agent。' },
    ])
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    const controller = derivedController(fakeApi([]))

    await controller.load()

    // A deployment composing no presets is valid: every session shares the
    // host composition and the row renders nothing.
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    expect(controller.store.getSnapshot().error).toBeNull()
  })

  it('writes only the default field, into the agent-presets namespace', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ], { writes }))
    await controller.load()

    await controller.select('minimal')

    expect(writes).toEqual([{ ns: AGENT_PRESET_SETTINGS_NS, patch: { default: 'minimal' } }])
    expect(controller.store.getSnapshot().currentValue).toBe('minimal')
  })

  it('restores the previous value and surfaces the message when the write fails', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'minimal', trust: 'system', isDefault: false },
    ], { failWrite: 'read-only settings' }))
    await controller.load()

    await controller.select('minimal')

    const state = controller.store.getSnapshot()
    expect(state.currentValue).toBe('standard')
    expect(state.error).toBe('read-only settings')
    expect(state.status).toBe('ready')
  })

  it('ignores a pick that is already the default', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
    ], { writes }))
    await controller.load()

    await controller.select('standard')

    expect(writes).toEqual([])
  })

  it('surfaces a roster failure without claiming the deployment has no presets', async () => {
    const controller = derivedController(fakeApi([], { failList: 'host down' }))

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('host down')
  })

  it('shows the first preset when the roster marks none default', async () => {
    // Settings can name a preset that was since deleted; the picker still has
    // to show something rather than an empty control.
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'mine', trust: 'user', isDefault: false },
    ]))

    await controller.load()

    expect(controller.store.getSnapshot().currentValue).toBe('standard')
  })

  it('ignores a load while one is already in flight', async () => {
    const writes: Recorded[] = []
    const controller = derivedController(fakeApi(
      [{ id: 'standard', trust: 'system', isDefault: true }], { writes }))

    await Promise.all([controller.load(), controller.load()])

    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('reads an Error\'s message and stringifies anything else', () => {
    // A transport rejects with an Error, but a host or a runtime can reject
    // with anything and the surface still has to say something.
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf({ code: 7 })).toBe('[object Object]')
  })

  it('reports a transport that rejects rather than answering', async () => {
    const controller = derivedController({
      agentPresets: { list: () => Promise.reject(new Error('socket closed')) },
    } as unknown as IApiClient)

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'socket closed' })
  })

  it('reports a transport that rejects mid-write and keeps the old default showing', async () => {
    const controller = derivedController(fakeApi([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'mine', trust: 'user', isDefault: false },
    ], { failWriteWith: new Error('socket closed') }))
    await controller.load()

    await controller.select('mine')

    // The value snaps back because the host never took it; a picker still
    // showing "mine" would be claiming a default that does not exist.
    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'standard', error: 'socket closed' })
  })
})
