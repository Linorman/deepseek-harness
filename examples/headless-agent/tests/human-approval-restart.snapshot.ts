/** A real Host approval retains its request history when terminal intent outlives the Host. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { createZstdFrameDecoder, scanZstdFrames } from '@clocky/clocky-session-persistence-jsonl/src/zstd.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configs = ['headless-human-approval.cordis.yml', 'headless-human-approval-restart.cordis.yml']
const drivers = ['headless-human-approval-driver.ts', 'headless-human-approval-restart-driver.ts']
type Backend = 'json' | 'sqlite'
type Outcome = 'failure' | 'cancellation'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Preserve the original lock/WAL for the new Loader while inspecting a separate copy. */
async function copyStore(root: string, backend: Backend): Promise<string> {
  const copy = join(root, 'crashed-store')
  const home = join(root, '.clocky')
  await mkdir(join(copy, '.clocky'), { recursive: true })
  if (backend === 'json') await cp(join(home, 'team-storage-json'), join(copy, '.clocky/team-storage-json'), { recursive: true })
  else {
    for (const file of (await readdir(home)).filter(name => name.startsWith('team-storage.sqlite'))) {
      await cp(join(home, file), join(copy, '.clocky', file))
    }
  }
  return copy
}

async function streams(root: string, kind: Backend) {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
    return await Promise.all(infos.map(async (info) => {
      const stream = await backend.log.open(info)
      try {
        const entries = await stream.read(-1, 128)
        expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
        return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
      } finally { await stream.close() }
    }))
  } finally { await backend.close() }
}

/** Read the old worker's exact persisted bytes without resuming or repairing its lost request. */
async function workerSession(root: string, sessionId: unknown) {
  const directory = join(root, '.clocky/sessions')
  const file = (await readdir(directory, { recursive: true })).find(path => basename(dirname(path)) === sessionId
    && (path.endsWith('session.jsonl.zstd') || path.endsWith('session.jsonl')))
  expect(file).toBeDefined()
  const bytes = await readFile(join(directory, file!))
  let text = ''
  if (file!.endsWith('.zstd')) {
    const scan = scanZstdFrames(bytes)
    expect(scan.tornStart).toBeUndefined()
    const decoder = createZstdFrameDecoder()
    try { for (const frame of decoder.decode(bytes, scan.frames)) text += frame.toString('utf8') }
    finally { decoder.close() }
  } else text = bytes.toString('utf8')
  return { bytes, records: text.split('\n').filter(Boolean).map(line => object(JSON.parse(line))) }
}

function bindings(entries: readonly { value: Record<string, unknown> }[]): Record<string, unknown>[] {
  const result = new Map<unknown, Record<string, unknown>>()
  for (const entry of entries) {
    if (entry.value.type !== 'activation/changed') continue
    const binding = object(entry.value.binding)
    result.set(object(binding.activation).id, binding)
  }
  return [...result.values()]
}

function launch(root: string, backend: Backend, outcome: Outcome, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', ...configs.flatMap(config => ['--patch', join(fixtures, config)])],
    tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
      CLOCKY_APPROVAL_BACKEND: backend, CLOCKY_PERMISSION_MODE: 'read-only', CLOCKY_APPROVAL_STAGE: stage, CLOCKY_APPROVAL_OUTCOME: outcome,
      ...(teamId === undefined ? {} : { CLOCKY_APPROVAL_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('pending Host approval cleanup after abrupt terminal intent', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const outcome of ['failure', 'cancellation'] as const) {
      it(`retains the real approval history after ${outcome} on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/har-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          await writeFile(join(work, 'approval.txt'), 'before\n')
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          for (const driver of drivers) await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const first = launch(root, backend, outcome, 'crash')
          const killed = await execa(first.command, first.args, { cwd: work, env: first.env, input: '',
            timeout: 30_000, killSignal: 'SIGKILL', reject: false })
          const diagnostic = JSON.stringify({ timedOut: killed.timedOut, exitCode: killed.exitCode,
            signal: killed.signal, stdout: killed.stdout, stderr: killed.stderr })
          expect(killed.timedOut, diagnostic).toBe(false)
          expect(killed.signal, diagnostic).toBe('SIGKILL')
          expect(killed.stderr).toBe('')
          const checkpoint = object(JSON.parse(killed.stdout))
          expect(checkpoint).toMatchObject({ stage: 'crash', outcome })
          const before = await streams(await copyStore(root, backend), backend)
          const teams = before.filter(stream => stream.name.startsWith('team/'))
          expect(teams).toHaveLength(1)
          const team = teams[0]!
          const teamId = team.name.slice('team/'.length)
          expect(checkpoint.stream).toBe(team.name)
          const approvals = team.entries.filter(entry => entry.value.type === 'human-action/changed')
            .map(entry => object(entry.value.action))
          expect(approvals).toHaveLength(outcome === 'failure' ? 1 : 2)
          const pending = approvals[0]!
          expect(pending).toEqual(checkpoint.approval)
          expect(pending).toMatchObject({ kind: 'approval', phase: 'pending' })
          expect(pending.id).toBe(`approval:${String(pending.sessionId)}:${String(pending.sourceId)}`)
          expect(object(pending.details).approvalId).toBe(pending.sourceId)
          expect(object(pending.details).rpcId).toBeTypeOf('string')
          expect(object(pending.details).toolName).toBe('write')
          expect(object(pending.details).callId).toBe('human-approval-escalated-write')
          const oldSession = await workerSession(root, pending.sessionId)
          expect(oldSession.records[0]).toMatchObject({ type: 'session', id: pending.sessionId,
            teamId: pending.teamId, participantId: pending.participantId })
          const asked = oldSession.records.filter(record => record.type === 'approval/asked')
          expect(asked).toEqual([checkpoint.asked])
          expect(object(asked[0]!.data)).toEqual({ id: pending.sourceId, toolName: 'write',
            callId: object(pending.details).callId, reason: object(pending.details).reason })
          expect(oldSession.records.filter(record => record.type === 'approval/decided')).toEqual([])
          const writes = oldSession.records.filter(record => record.type === 'tool/call')
            .map(record => object(record.data)).filter(call => call.name === 'write')
          expect(writes).toHaveLength(2)
          const initial = object(JSON.parse(String(writes[0]!.arguments)))
          expect(initial).toEqual({ file_path: join(work, 'approval.txt'), content: 'after\n' })
          expect(object(JSON.parse(String(writes[1]!.arguments)))).toEqual({ ...initial,
            sandbox_permissions: 'workspace-write',
            justification: 'Allow replacing approval.txt after the read-only sandbox denied this exact write.' })
          const results = oldSession.records.filter(record => record.type === 'tool/result').map(record => object(record.data))
          const denied = results.find(result => object(object(result.message).source).callId === writes[0]!.callId)
          expect(object(denied!.error).code).toBe('FS_SANDBOX_DENIED')
          expect(results.some(result => object(object(result.message).source).callId === writes[1]!.callId)).toBe(false)
          expect(await readFile(join(work, 'approval.txt'), 'utf8')).toBe('before\n')
          const taskEntries = team.entries.filter(entry => entry.value.type === 'task/changed')
          const task = object(taskEntries.at(-1)?.value.task)
          expect(task).toEqual(checkpoint.task)
          expect(task).toMatchObject({ id: pending.taskId, phase: 'running', attemptCount: 1, attemptHistory: [] })
          expect(object(task.lease).participantId).toBe(pending.participantId)
          const priorBindings = bindings(team.entries)
          expect(priorBindings).toHaveLength(2)
          expect(priorBindings.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined)).toBe(true)
          const worker = priorBindings.find(binding => binding.sessionId === pending.sessionId)!
          expect(object(worker.activation).id).toBe(object(task.lease).activationId)
          const allocation = team.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)!
          expect(object(allocation.value.allocation)).toMatchObject({ taskId: task.id,
            attemptId: object(task.lease).attemptId, sessionId: pending.sessionId, lifecycle: 'active' })
          const intents = team.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))
          expect(intents).toHaveLength(1)
          const intent = object(intents[0]!.value[outcome === 'failure' ? 'closure' : 'cancellation'])
          const expectedOutcome = outcome === 'failure' ? { kind: 'team-failed', reason: intent.reason } : { kind: 'team-cancelled' }
          if (outcome === 'cancellation') expect(approvals[1]).toEqual({ ...pending, phase: 'cancelled',
            outcome: expectedOutcome, updatedAt: approvals[1]!.updatedAt })
          expect(team.entries.filter(entry => entry.value.type === 'team/phase').at(-1)?.value.phase).toBe('quiescing')
          const second = launch(root, backend, outcome, 'recover', teamId)
          const recovered = await execa(second.command, second.args, { cwd: work, env: second.env, input: '',
            timeout: 30_000, killSignal: 'SIGKILL', reject: false })
          const recoveryDiagnostic = JSON.stringify({ timedOut: recovered.timedOut, exitCode: recovered.exitCode,
            signal: recovered.signal, stdout: recovered.stdout, stderr: recovered.stderr })
          expect(recovered.timedOut, recoveryDiagnostic).toBe(false)
          expect(recovered.exitCode, recoveryDiagnostic).toBe(0)
          expect(recovered.stderr).toBe('')
          const output = object(JSON.parse(recovered.stdout))
          expect(output.pid).not.toBe(checkpoint.pid)
          const recoveredSession = await workerSession(root, pending.sessionId)
          expect(recoveredSession.bytes).toEqual(oldSession.bytes)
          expect(recoveredSession.records.filter(record => record.type === 'approval/asked')).toEqual(asked)
          expect(recoveredSession.records.filter(record => record.type === 'approval/decided')).toEqual([])
          expect(await readFile(join(work, 'approval.txt'), 'utf8')).toBe('before\n')
          const after = await streams(root, backend)
          expect(after.map(stream => stream.name).sort()).toEqual(before.map(stream => stream.name).sort())
          for (const old of before) {
            expect(after.find(stream => stream.name === old.name)!.entries.slice(0, old.entries.length)).toEqual(old.entries)
          }
          const settled = after.find(stream => stream.name === team.name)!
          const finalApprovals = settled.entries.filter(entry => entry.value.type === 'human-action/changed')
            .map(entry => object(entry.value.action))
          expect(finalApprovals).toHaveLength(2)
          expect(finalApprovals[0]).toEqual(pending)
          expect(finalApprovals[1]).toEqual({ ...pending, phase: 'cancelled', outcome: expectedOutcome,
            updatedAt: finalApprovals[1]!.updatedAt })
          expect(settled.entries.filter(entry => entry.value.type === 'task/changed')).toEqual(taskEntries)
          expect(settled.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)).toEqual(allocation)
          expect(bindings(settled.entries)).toEqual(priorBindings)
          expect(settled.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))).toEqual(intents)
          expect(settled.entries.some(entry => entry.value.type === 'team/final-admitted')).toBe(false)
          const { pid: _pid, stage: _stage, outcome: _outcome, ...summary } = output
          const snapshot = `${JSON.stringify({ scenario: 'human-approval-restart', backend, outcome, independentHost: true,
            initialApproval: outcome === 'failure' ? 'pending' : 'cancelled', cleanupAt: outcome === 'failure' ? 'recovery' : 'intent',
            originalPendingRetained: true, approvalHistoryRecords: finalApprovals.length,
            sessionApprovalAsked: 1, sessionApprovalDecided: 0,
            lostPromiseOutcome: 'not-reconstructed', oldSessionBytesUnchanged: true, unapprovedWrites: 0, recovered: summary }, null, 2)}\n`
          const expected = join(import.meta.dirname, `snapshots/human-approval-restart/${backend}-${outcome}.expected.json`)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, snapshot) }
          else expect(snapshot).toBe(await readFile(expected, 'utf8'))
        } catch (error: unknown) {
          const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
          await cp(root, evidence, { recursive: true })
          throw new Error(`Human approval restart evidence: ${evidence}`, { cause: error })
        } finally { await rm(root, { recursive: true, force: true }) }
      }, 90_000)
    }
  }
})
