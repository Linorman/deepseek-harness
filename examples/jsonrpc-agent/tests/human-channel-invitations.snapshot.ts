/** Real authenticated SDK discovery and consent followed by a durable Agent Session receipt. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { Clocky } from '@clocky/clocky-sdk-client'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
it('accepts an ordinary invitation through the authenticated TypeScript SDK', async () => {
  await mkdir(join(repo, '.tmp'), { recursive: true })
  const cwd = await mkdtemp(join(repo, '.tmp/human-invitation-sdk-'))
  const launch = resolveExampleLaunch({
    srcBin: join(repo, 'packages/examples/jsonrpc-demo/src/bin.ts'),
    configArgs: [fileURLToPath(new URL('./fixtures/human-invitations/cordis.yml', import.meta.url))],
    tsconfigPath: join(repo, 'tsconfig.json'),
  })
  const harness = new Clocky({ launch: { command: launch.command, args: launch.args, cwd,
    env: { ...process.env, ...launch.env, TSX_DISABLE_CACHE: '1', CLOCKY_SESSION_ROOT: join(cwd, 'sessions'),
      CLOCKY_TEAM_STORAGE_ROOT: join(cwd, 'team-storage') }, requestTimeoutMs: 20_000 },
  credential: 'explicit-human-invitation', cwd, provider: 'sdk-subagent-team-snapshot', model: 'sdk-subagent-team-snapshot' })
  let stage = 'create'
  try {
    const team = await harness.createTeam('Keep the Team active for explicit invitations.')
    stage = 'wait-initial-turn'
    await vi.waitFor(async () => {
      const current = (await harness.client.getTeam({ teamId: team.id })).state
      expect(current.usage?.outputTokens).toBeGreaterThan(0)
      expect(current.activations.every(binding => binding.activation.status === 'idle')).toBe(true)
    })
    const state = await harness.client.getTeam({ teamId: team.id })
    expect(state.state.team, 'Team remains open for ordinary invitation').toMatchObject({ phase: 'active' })
    const human = state.state.participants.find(p => p.role === 'human')!
    const coordinator = state.state.participants.find(p => p.role === 'coordinator')!
    stage = 'open'
    const opened = await team.openChannel({ expectedCursor: state.state.team.cursor,
      adapter: { type: 'direct', version: 4 }, viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: human.id, role: 'owner' }, { id: coordinator.id, role: 'member' }], limits: {} })
    const channelId = opened.value.manifest.id
    stage = 'query'
    const own = (await team.invitation({ channelId })).value
    expect(own.channel.phase).toBe('pending')
    expect(own.invitation.status).toBe('pending')
    const acceptance = { channelId, revision: own.invitation.revision,
      manifestFingerprint: own.invitation.manifestFingerprint, idempotencyKey: 'sdk-explicit-acceptance' }
    await expect(team.acknowledgeInvitation({ ...acceptance, revision: acceptance.revision + 1 })).rejects.toThrow()
    stage = 'ack'
    const accepted = (await team.acknowledgeInvitation(acceptance)).value
    expect(accepted.invitation.status).toBe('acknowledged')
    await vi.waitFor(async () => { expect((await team.invitation({ channelId })).value.channel.phase).toBe('active') })
    const current = (await team.invitation({ channelId })).value.channel
    stage = 'post'
    const posted = await team.postChannel({ channelId, expectedCursor: current.cursor, audience: null,
      kind: 'message', payload: { content: [{ type: 'text', text: 'Explicit SDK invitation accepted.' }] }, delivery: 'context' })
    await vi.waitFor(async () => {
      const page = await team.channel(channelId)
      expect(page.value.records.some(record => record.type === 'channel/receipt' && record.envelopeId === posted.value.id)).toBe(true)
    })
    expect({ queried: own.invitation.status, accepted: accepted.invitation.status,
      manifest: own.channel.manifest.adapter, recipient: accepted.invitation.participantId === human.id }).toEqual({
      queried: 'pending', accepted: 'acknowledged', manifest: { type: 'direct', version: 4 }, recipient: true,
    })
  } catch (error) {
    throw new Error(`SDK invitation ${stage}: ${String(error)}`, { cause: error })
  } finally {
    await harness.close()
    await rm(cwd, { recursive: true, force: true })
  }
}, 40_000)
