import type { RequestPayload, ResponseValue, RpcResponse } from '@clocky/clocky-host-apiproxy/api'
import { describe, expect, it } from 'vitest'
import { FakeApiClient as ConnectionFakeApiClient } from '../../connection/tests/fake-api.client.ts'
import { FakeApiClient as RuntimeFakeApiClient } from './fake-api.client.ts'

interface TeamFake {
  readonly teams: {
    list(payload: RequestPayload<'team.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.list'>>>
    get(payload: RequestPayload<'team.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.get'>>>
    create(payload: RequestPayload<'team.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.create'>>>
    start(payload: RequestPayload<'team.start'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.start'>>>
    postInput(payload: RequestPayload<'team.postInput'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.postInput'>>>
    waitFinal(payload: RequestPayload<'team.waitFinal'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.waitFinal'>>>
    cancel(payload: RequestPayload<'team.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'team.cancel'>>>
  }
  callsOf(method: string): unknown[]
}

const fakes: readonly { readonly name: string; readonly create: () => TeamFake }[] = [
  { name: 'connection', create: () => new ConnectionFakeApiClient() },
  { name: 'runtime', create: () => new RuntimeFakeApiClient() },
]

for (const fake of fakes) {
  describe(`${fake.name} FakeApiClient Team domain`, () => {
    it('returns deterministic default responses and records every Team request', async () => {
      const api = fake.create()
      const listed = await api.teams.list({})
      if (!listed.result.ok) throw new Error('fake Team list failed')
      expect(listed.result.value.items).toHaveLength(1)

      const created = await api.teams.create({ objective: 'Exercise the fake Team domain.' })
      if (!created.result.ok) throw new Error('fake Team create failed')
      const teamId = created.result.value.team.id

      const started = await api.teams.start({
        objective: 'Start the fake Team domain.',
        text: 'Start.',
        idempotencyKey: 'fake-team-start' as RequestPayload<'team.start'>['idempotencyKey'],
      })
      if (!started.result.ok) throw new Error('fake Team start failed')
      expect(started.result.value.state.team.id).toBeDefined()
      expect(started.result.value.envelopeId).toBeDefined()

      const read = await api.teams.get({ teamId })
      if (!read.result.ok) throw new Error('fake Team get failed')
      expect(read.result.value.team.id).toBe(teamId)

      const input = await api.teams.postInput({ teamId, text: 'Continue.' })
      if (!input.result.ok) throw new Error('fake Team postInput failed')
      expect(input.result.value.envelopeId).toBeDefined()

      const final = await api.teams.waitFinal({ teamId, afterCursor: 0 })
      if (!final.result.ok) throw new Error('fake Team waitFinal failed')
      expect(final.result.value.teamId).toBe(teamId)
      expect(final.result.value.text).toContain('Team final.')

      const cancelled = await api.teams.cancel({ teamId })
      expect(cancelled.result).toEqual({ ok: true, value: { accepted: true, phase: 'cancelled' } })
      expect(api.callsOf('team.list')).toEqual([{}])
      expect(api.callsOf('team.create')).toEqual([{ objective: 'Exercise the fake Team domain.' }])
      expect(api.callsOf('team.start')).toEqual([{
        objective: 'Start the fake Team domain.', text: 'Start.', idempotencyKey: 'fake-team-start',
      }])
      expect(api.callsOf('team.get')).toEqual([{ teamId }])
      expect(api.callsOf('team.postInput')).toEqual([{ teamId, text: 'Continue.' }])
      expect(api.callsOf('team.waitFinal')).toEqual([{ teamId, afterCursor: 0 }])
      expect(api.callsOf('team.cancel')).toEqual([{ teamId }])
    })
  })
}
