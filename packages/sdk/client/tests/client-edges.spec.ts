/** Public SDK boundaries retain exact Team command identities and never echo handshake credentials. */
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { HarnessClient, JsonRpcResponseError, RequestTimeoutError, SdkProtocolError, TransportClosedError } from '../src/index.ts'

function client(): HarnessClient { return new HarnessClient({ command: process.execPath }) }

it('discovers and acknowledges only the authenticated human channel invitation', async () => {
  const sdk = client()
  const fingerprint = `sha256:${'a'.repeat(64)}`
  const invitation = { channel: { manifest: { id: 'channel', teamId: 'team', adapter: { type: 'direct', version: 4 },
    participants: [{ id: 'human', role: 'human' }], limits: {} }, phase: 'pending', cursor: 1 },
  invitation: { participantId: 'human', role: 'human', visibility: 'channel', required: true, deadline: 100,
    endpoint: { kind: 'human' }, revision: 1, manifestFingerprint: fingerprint, status: 'pending' } }
  const request = vi.spyOn(sdk, 'request').mockResolvedValue({ value: invitation })
  await expect(sdk.getTeamChannelInvitation({ channelId: 'channel' })).resolves.toEqual({ value: invitation })
  expect(request).toHaveBeenLastCalledWith('team/channel-invitation', { channelId: 'channel' })
  const accepted = { ...invitation, invitation: { ...invitation.invitation, status: 'acknowledged', acknowledgementKey: 'accept', settledAt: 101 } }
  request.mockResolvedValue({ value: accepted })
  const command = { channelId: 'channel', revision: 1, manifestFingerprint: fingerprint, idempotencyKey: 'accept' }
  await expect(sdk.acknowledgeTeamChannelInvitation(command)).resolves.toEqual({ value: accepted })
  expect(request).toHaveBeenLastCalledWith('team/channel-invitation-acknowledge', command)
  await expect(sdk.getTeamChannelInvitation({ channelId: 'channel', actor: 'forged' } as never)).rejects.toThrow(SdkProtocolError)
  await expect(sdk.acknowledgeTeamChannelInvitation({ ...command, participantId: 'forged' } as never))
    .rejects.toThrow(SdkProtocolError)
  request.mockResolvedValue({ value: { private: 'untrusted' } })
  await expect(sdk.getTeamChannelInvitation({ channelId: 'channel' })).rejects.toThrow(SdkProtocolError)
  await expect(sdk.acknowledgeTeamChannelInvitation(command)).rejects.toThrow(SdkProtocolError)
})

function task(teamId = 'team', id = 'task', revision = 2) {
  return { id, teamId, createdAt: 1, revision, execution: { kind: 'participant' },
    createCommand: { creator: { teamId, participantId: 'human' }, idempotencyKey: 'create-task' },
    subject: 'Updated subject', description: 'Original description', phase: 'pending', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
    reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] }
}

it('accepts an original task update receipt and rejects valid receipts from other commands', async () => {
  const sdk = client()
  const params = { teamId: 'team', taskId: 'task', commandId: 'update-task', expectedRevision: 1, subject: 'Updated subject' }
  const receipt = { teamId: 'team', taskId: 'task', commandId: 'update-task', expectedRevision: 1, appliedRevision: 2, appliedAt: 3 }
  const request = vi.spyOn(sdk, 'request').mockResolvedValue({ value: { receipt, task: task() } })
  await expect(sdk.updateTeamTask(params)).resolves.toMatchObject({ value: { receipt } })
  expect(request).toHaveBeenLastCalledWith('team/task-update', params)
  for (const value of [
    { receipt: { ...receipt, teamId: 'foreign' }, task: task('foreign') },
    { receipt: { ...receipt, taskId: 'foreign' }, task: task('team', 'foreign') },
    { receipt: { ...receipt, commandId: 'foreign' }, task: task() },
    { receipt: { ...receipt, expectedRevision: 2, appliedRevision: 3 }, task: task('team', 'task', 3) },
  ]) {
    request.mockResolvedValue({ value })
    await expect(sdk.updateTeamTask(params)).rejects.toThrow('Task update receipt does not match its original command identity')
  }
})

it('redacts a handshake credential from typed, generic and structured transport failures', async () => {
  const sdk = client()
  vi.spyOn(sdk, 'start').mockImplementation(() => {})
  const secret = 'secret-for-client-edges'
  const request = vi.spyOn(sdk, 'request')
  const params = { credential: secret, cwd: process.cwd(), provider: 'test', model: 'test' }
  const cases: Array<[unknown, new (message: string) => Error]> = [
    [new TransportClosedError(`closed: ${secret}`), TransportClosedError],
    [new RequestTimeoutError(`timed out: ${secret}`), RequestTimeoutError],
    [new SdkProtocolError(`invalid: ${secret}`), SdkProtocolError],
    [new Error(`failed: ${secret}`), Error],
  ]
  for (const [failure, expectedType] of cases) {
    request.mockRejectedValueOnce(failure)
    const result = await sdk.initialize(params).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(expectedType)
    expect(String(result)).not.toContain(secret)
    expect(String(result)).toContain('[REDACTED]')
  }
  request.mockRejectedValueOnce(secret)
  const nonError = await sdk.initialize(params).catch((error: unknown) => error)
  expect(nonError).toBeInstanceOf(Error)
  expect(String(nonError)).toBe('Error: [REDACTED]')
  request.mockRejectedValueOnce(new JsonRpcResponseError(7, `denied ${secret}`, { nested: [secret, { reason: secret }], count: 2 }))
  const structured = await sdk.initialize(params).catch((error: unknown) => error)
  expect(structured).toBeInstanceOf(JsonRpcResponseError)
  expect(structured).toMatchObject({ code: 7, message: 'denied [REDACTED]',
    data: { nested: ['[REDACTED]', { reason: '[REDACTED]' }], count: 2 } })
  expect(JSON.stringify(structured)).not.toContain(secret)
})

it('rejects a late credential on a runtime started without one and hides a terminated process id', async () => {
  const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
  const sdk = new HarnessClient({ command: process.execPath, args: [fakeRuntime] })
  expect(sdk.pid).toBeUndefined()
  sdk.start()
  try {
    expect(sdk.pid).toBeGreaterThan(0)
    expect(() => { sdk.start('late-secret') }).toThrow('started before its product credential was supplied')
  } finally {
    await sdk.close()
  }
  expect(sdk.pid).toBeUndefined()
})

it('rejects malformed initialization credentials and command-line credential disclosure before launch', async () => {
  const sdk = client()
  await expect(sdk.initialize({ credential: 1, cwd: process.cwd(), provider: 'test', model: 'test' } as never))
    .rejects.toThrow('initialize params is invalid')
  expect(sdk.pid).toBeUndefined()
  const secret = 'secret-in-command'
  const unsafe = new HarnessClient({ command: `/runtime/${secret}` })
  await expect(unsafe.initialize({ credential: secret, cwd: process.cwd(), provider: 'test', model: 'test' }))
    .rejects.toThrow('command and arguments must not contain the product credential')
  expect(unsafe.pid).toBeUndefined()
})

it('starts a credentialed runtime command without positional arguments', async () => {
  const sdk = client()
  sdk.start('credential-not-on-command-line')
  try {
    expect(sdk.pid).toBeGreaterThan(0)
  } finally {
    await sdk.close()
  }
})
