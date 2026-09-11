import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@clocky/clocky-loader-smoke'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@clocky/clocky-session-persistence-jsonl/src/zstd.ts'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { describe, expect, it } from 'vitest'

const FINAL_TEXT = 'HEADLESS_TEAM_RUN_FINAL'
const UPDATED_OBJECTIVE = 'Use the durable Team objective.'
const TASK_FINAL_TEXT = 'HEADLESS_TEAM_TASK_FINAL'
const TASK_SUBJECT = 'Complete the deterministic Team task.'
const TASK_INSTRUCTIONS = 'Return the deterministic worker summary.'
const TASK_SUMMARY = 'HEADLESS_TEAM_TASK_WORKER_SUMMARY'
const WORKFLOW_FINAL_TEXT = 'HEADLESS_TEAM_WORKFLOW_FINAL'
const WORKFLOW_TASK_SUMMARY = 'HEADLESS_TEAM_WORKFLOW_TASK_SUMMARY'
const MULTI_WORKFLOW_TASK = 'Compile one deterministic multi-worker workflow.'
const MULTI_WORKFLOW_FINAL_TEXT = 'HEADLESS_TEAM_MULTI_WORKFLOW_FINAL'
const OWNER_PROPOSAL_TASK = 'Propose one deterministic owner hint.'
const OWNER_PROPOSAL_FINAL_TEXT = 'HEADLESS_TEAM_OWNER_PROPOSAL_FINAL'
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const teamRunOverlayPath = join(fixturesDir, 'headless-team-run.cordis.yml')
const teamTaskOverlayPath = join(fixturesDir, 'headless-team-task.cordis.yml')
const teamWorkflowOverlayPath = join(fixturesDir, 'headless-team-workflow.cordis.yml')
const teamTemplateOverlayPath = join(fixturesDir, 'headless-team-template.cordis.yml')
const teamMultiWorkerOverlayPath = join(fixturesDir, 'headless-team-multi-worker.cordis.yml')
const teamOwnerProposalOverlayPath = join(fixturesDir, 'headless-team-owner-proposal.cordis.yml')
const teamRunLlmPluginPath = join(fixturesDir, 'headless-team-run-llm.ts')
const clockyBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface StoredLog {
  readonly stream: { readonly name: string }
  readonly entries: readonly { readonly sequence: number; readonly value: Record<string, unknown> }[]
}

interface SessionLog {
  readonly header: Record<string, unknown>
  readonly records: readonly Record<string, unknown>[]
}

function valueRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function valueString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function valueArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function parseJsonl(content: string): Record<string, unknown>[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => valueRecord(JSON.parse(line), 'session JSONL record'))
}

async function storedLogs(cwd: string): Promise<StoredLog[]> {
  const backend = new SqliteStorageBackend({ path: join(cwd, '.clocky', 'team-storage.sqlite') })
  try {
    const streams = await backend.log.list()
    return await Promise.all(streams.map(async (info) => {
      const stream = await backend.log.open({ name: info.name, version: info.version })
      try {
        const entries: StoredLog['entries'][number][] = []
        let afterSequence = -1
        for (;;) {
          const page = await stream.read(afterSequence, 256)
          if (page.length === 0) break
          entries.push(...page.map(entry => ({ sequence: entry.sequence, value: valueRecord(entry.value, 'Team log value') })))
          afterSequence = page.at(-1)?.sequence ?? afterSequence
        }
        return { stream: { name: info.name }, entries }
      } finally {
        await stream.close()
      }
    }))
  } finally {
    await backend.close()
  }
}

async function persistedSessionLogs(cwd: string): Promise<SessionLog[]> {
  const root = join(cwd, '.clocky', 'sessions')
  const files = (await readdir(root, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  return await Promise.all(files.map(async (file) => {
    const path = join(root, file)
    const content = await readFile(path)
    if (!path.endsWith('.zstd')) {
      const records = parseJsonl(content.toString('utf8'))
      const [header, ...rest] = records
      if (header === undefined) throw new Error(`session log '${path}' has no header`)
      return { header, records: rest }
    }
    const scan = scanZstdFrames(content)
    if (scan.tornStart !== undefined) throw new Error(`session log '${path}' has a torn Zstandard frame`)
    const decoded = Buffer.concat(await Promise.all(scan.frames.map(async frame =>
      await decompressZstdFrame(content.subarray(frame.start, frame.end)),
    )))
    const records = parseJsonl(decoded.toString('utf8'))
    const [header, ...rest] = records
    if (header === undefined) throw new Error(`session log '${path}' has no header`)
    return { header, records: rest }
  }))
}

function participant(records: readonly Record<string, unknown>[], role: string): Record<string, unknown> {
  const snapshots = records
    .filter(record => record['type'] === 'participant/changed')
    .map(record => valueRecord(record['participant'], 'participant snapshot'))
  const member = [...snapshots].reverse().find(snapshot => snapshot['role'] === role)
  if (member === undefined) throw new Error(`Team journal has no ${role} participant`)
  return member
}

function envelope(
  records: readonly Record<string, unknown>[],
  kind: string,
): Record<string, unknown> {
  const envelopeRecord = records.find(record => record['type'] === 'channel/envelope'
    && valueRecord(record['envelope'], 'channel Envelope')['kind'] === kind)
  if (envelopeRecord === undefined) throw new Error(`channel WAL has no ${kind} Envelope`)
  return valueRecord(envelopeRecord['envelope'], 'channel Envelope')
}

function channelLog(logs: readonly StoredLog[], adapterType: string): StoredLog {
  const channel = logs.find((log) => {
    if (!log.stream.name.startsWith('channel/')) return false
    const opened = log.entries.find(entry => entry.value['type'] === 'channel/opened')
    if (opened === undefined) return false
    const manifest = valueRecord(opened.value['manifest'], 'channel manifest')
    return valueRecord(manifest['adapter'], 'channel adapter')['type'] === adapterType
  })
  if (channel === undefined) throw new Error(`TeamRun did not persist a ${adapterType} channel WAL`)
  return channel
}

function activationBinding(records: readonly Record<string, unknown>[], participantId: string): Record<string, unknown> {
  const record = records.find(candidate => candidate['type'] === 'activation/changed'
    && valueRecord(valueRecord(candidate['binding'], 'activation binding')['activation'], 'activation')['participantId'] === participantId)
  if (record === undefined) throw new Error(`Team journal has no activation for participant '${participantId}'`)
  return valueRecord(record['binding'], 'activation binding')
}

function taskSnapshots(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return records
    .filter(record => record['type'] === 'task/changed')
    .map(record => valueRecord(record['task'], 'Team task snapshot'))
}

function sessionToolCall(session: SessionLog, name: string): Record<string, unknown> {
  const record = session.records.find(candidate => candidate['type'] === 'tool/call'
    && valueRecord(candidate['data'], 'tool call data')['name'] === name)
  if (record === undefined) throw new Error(`Session did not call ${name}`)
  return valueRecord(record['data'], 'tool call data')
}

function sessionToolResultText(session: SessionLog, callId: string): string {
  const record = session.records.find((candidate) => {
    if (candidate['type'] !== 'tool/result') return false
    const message = valueRecord(valueRecord(candidate['data'], 'tool result data')['message'], 'tool result message')
    return valueRecord(message['source'], 'tool result source')['callId'] === callId
  })
  if (record === undefined) throw new Error(`Session has no result for tool call '${callId}'`)
  const message = valueRecord(valueRecord(record['data'], 'tool result data')['message'], 'tool result message')
  const result = valueArray(message['content'], 'tool result blocks')
    .map(block => valueRecord(block, 'tool result block'))
    .find(block => block['type'] === 'tool-result')
  if (result === undefined) throw new Error(`Session result '${callId}' has no tool-result block`)
  const text = valueArray(result['content'], 'tool result content')
    .map(block => valueRecord(block, 'tool result content block'))
    .find(block => block['type'] === 'text')
  if (text === undefined) throw new Error(`Session result '${callId}' has no text content`)
  return valueString(text['text'], 'tool result text')
}

/** Install the deterministic model inside the isolated temporary headless profile. */
async function prepareTeamRunFixture(cwd: string): Promise<void> {
  const fixtureDir = join(cwd, '.clocky', 'profiles', 'headless', 'snapshot-fixtures')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(teamRunLlmPluginPath, join(fixtureDir, 'headless-team-run-llm.ts')),
    writeFile(join(fixtureDir, 'package.json'), '{"type":"module"}\n'),
  ])
}

describe('headless TeamRun snapshot', () => {
  it('runs the assembled headless profile through the direct-v4 final and durable human receipt', async () => {
    const task = 'Return the deterministic TeamRun final.'
    const result = await runLoaderSmoke({
      label: 'headless TeamRun profile snapshot',
      tempDirPrefix: 'headless-team-run-profile-',
      binScript: clockyBinScript,
      configPath: teamRunOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', teamRunOverlayPath, task],
      tsconfigPath,
      env: {
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareTeamRunFixture,
      inspect: async (cwd) => {
        const logs = await storedLogs(cwd)
        const team = logs.find(log => log.stream.name.startsWith('team/'))
        const channel = logs.find(log => log.stream.name.startsWith('channel/'))
        if (team === undefined || channel === undefined) {
          throw new Error('headless TeamRun did not persist both a Team journal and a channel WAL')
        }
        const teamId = team.stream.name.slice('team/'.length)
        const teamRecords = team.entries.map(entry => entry.value)
        const phases = teamRecords
          .filter(record => record['type'] === 'team/phase')
          .map(record => record['phase'])
        expect(phases).toEqual(['active', 'quiescing', 'completed'])
        expect(teamRecords.map(record => record['type'])).toEqual(expect.arrayContaining([
          'team/created',
          'participant/changed',
          'channel/attached',
          'activation/changed',
          'goal/changed',
        ]))

        const human = participant(teamRecords, 'human')
        const coordinator = participant(teamRecords, 'coordinator')
        const humanId = valueString(human['id'], 'human participant id')
        const coordinatorId = valueString(coordinator['id'], 'coordinator participant id')
        const objectiveChange = teamRecords.find(record => record['type'] === 'goal/changed')
        if (objectiveChange === undefined) throw new Error('headless TeamRun did not persist the objective edit')
        expect(valueRecord(objectiveChange['goal'], 'Team objective')).toMatchObject({
          teamId,
          revision: 2,
          objective: UPDATED_OBJECTIVE,
        })
        const channelId = channel.stream.name.slice('channel/'.length)
        const channelRecords = channel.entries.map(entry => entry.value)
        expect(channelRecords[0]).toMatchObject({
          type: 'channel/opened',
          manifest: { teamId, id: channelId, adapter: { type: 'direct', version: 4 } },
        })
        const input = envelope(channelRecords, 'message')
        expect(input).toMatchObject({
          teamId,
          channelId,
          senderId: humanId,
          audience: [coordinatorId],
          delivery: 'turn',
          payload: { content: [{ type: 'text', text: task }] },
        })
        const final = envelope(channelRecords, 'final')
        expect(final).toMatchObject({
          teamId,
          channelId,
          senderId: coordinatorId,
          audience: [humanId],
          delivery: 'turn',
          payload: { text: FINAL_TEXT },
        })
        const finalId = valueString(final['id'], 'final Envelope id')
        expect(channelRecords).toContainEqual(expect.objectContaining({
          type: 'channel/receipt',
          participantId: humanId,
          envelopeId: finalId,
        }))

        const sessions = await persistedSessionLogs(cwd)
        const coordinatorSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === coordinatorId)
        if (coordinatorSession === undefined) {
          throw new Error('headless TeamRun did not persist the coordinator Session Team provenance')
        }
        const goalRead = sessionToolCall(coordinatorSession, 'get_goal')
        expect(JSON.parse(valueString(goalRead['arguments'], 'get_goal arguments'))).toEqual({})
        const goalUpdate = sessionToolCall(coordinatorSession, 'update_goal')
        expect(JSON.parse(valueString(goalUpdate['arguments'], 'update_goal arguments'))).toEqual({
          revision: 1,
          objective: UPDATED_OBJECTIVE,
        })
        expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(goalUpdate['callId'], 'update_goal call id'))))
          .toMatchObject({ revision: 2, objective: UPDATED_OBJECTIVE })
        const finalCall = coordinatorSession.records.find(record => record['type'] === 'tool/call'
          && valueRecord(record['data'], 'tool call data')['name'] === 'team_final')
        if (finalCall === undefined) throw new Error('coordinator Session did not call team_final')
        const finalArguments = JSON.parse(valueString(
          valueRecord(finalCall['data'], 'tool call data')['arguments'],
          'team_final arguments',
        )) as Record<string, unknown>
        expect(finalArguments).toEqual({ channel_id: channelId, text: FINAL_TEXT })
      },
    })

    expect(result.stdout).toBe(`${FINAL_TEXT}\n`)
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('delegates one default-worker task through the assembled headless profile before final receipt', async () => {
    const task = 'Delegate one deterministic Team task.'
    const result = await runLoaderSmoke({
      label: 'headless Team task delegation snapshot',
      tempDirPrefix: 'headless-team-task-profile-',
      binScript: clockyBinScript,
      configPath: teamTaskOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', teamTaskOverlayPath, task],
      tsconfigPath,
      env: {
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareTeamRunFixture,
      inspect: async (cwd) => {
        const logs = await storedLogs(cwd)
        const team = logs.find(log => log.stream.name.startsWith('team/'))
        if (team === undefined) throw new Error('headless Team task run did not persist a Team journal')
        const teamId = team.stream.name.slice('team/'.length)
        const records = team.entries.map(entry => entry.value)
        expect(records.filter(record => record['type'] === 'team/phase').map(record => record['phase']))
          .toEqual(['active', 'quiescing', 'completed'])

        const coordinator = participant(records, 'coordinator')
        const worker = participant(records, 'worker')
        const coordinatorId = valueString(coordinator['id'], 'coordinator participant id')
        const workerId = valueString(worker['id'], 'worker participant id')
        const coordinatorBinding = activationBinding(records, coordinatorId)
        const workerBinding = activationBinding(records, workerId)
        const coordinatorActivation = valueRecord(coordinatorBinding['activation'], 'coordinator activation')
        const workerActivation = valueRecord(workerBinding['activation'], 'worker activation')

        const changes = taskSnapshots(records)
        const created = changes[0]
        if (created === undefined) throw new Error('Team journal has no default-worker task')
        const taskId = valueString(created['id'], 'Team task id')
        const phases = changes.map(change => change['phase'])
        expect(phases).toEqual(['pending', 'assigned', 'running', 'completed'])
        expect(created).toMatchObject({
          subject: TASK_SUBJECT,
          description: TASK_INSTRUCTIONS,
          readScopes: ['examples/headless-agent'],
          writeScopes: [],
          requiredCapabilities: ['team-default-worker'],
          workspaceMode: 'shared',
          reviewPolicy: { kind: 'none' },
          maxAttempts: 1,
        })
        const createCommand = valueRecord(created['createCommand'], 'Team task create command')
        const creator = valueRecord(createCommand['creator'], 'Team task creator')
        expect(creator).toEqual({
          teamId,
          participantId: coordinatorId,
          activationId: coordinatorActivation['id'],
          sessionId: coordinatorBinding['sessionId'],
          provider: coordinatorBinding['provider'],
        })
        expect(JSON.parse(valueString(createCommand['idempotencyKey'], 'Team task create key')))
          .toEqual(['team_task_start', 'headless-team-task-start', 'headless-team-task-start'])
        expect(changes.at(-1)).toMatchObject({
          id: taskId,
          phase: 'completed',
          attemptHistory: [{ outcome: { kind: 'completed', result: { summary: TASK_SUMMARY } } }],
        })

        const assignmentChannel = channelLog(logs, 'task-assignment')
        const assignmentChannelId = assignmentChannel.stream.name.slice('channel/'.length)
        const assignmentRecords = assignmentChannel.entries.map(entry => entry.value)
        expect(assignmentRecords[0]).toMatchObject({
          type: 'channel/opened',
          manifest: {
            teamId,
            id: assignmentChannelId,
            adapter: { type: 'task-assignment', version: 1 },
            participants: [{ id: workerId }],
            limits: {
              taskId,
              activationId: workerActivation['id'],
              sessionId: workerBinding['sessionId'],
            },
          },
        })
        const assignment = envelope(assignmentRecords, 'assignment')
        expect(assignment).toMatchObject({
          teamId,
          channelId: assignmentChannelId,
          senderId: workerId,
          audience: [workerId],
          delivery: 'turn',
          taskId,
          payload: {
            taskId,
            activationId: workerActivation['id'],
            sessionId: workerBinding['sessionId'],
          },
        })
        const assignmentId = valueString(assignment['id'], 'assignment Envelope id')
        expect(assignmentRecords).toContainEqual(expect.objectContaining({
          type: 'channel/receipt', participantId: workerId, envelopeId: assignmentId,
        }))

        const sessions = await persistedSessionLogs(cwd)
        const coordinatorSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === coordinatorId)
        const workerSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === workerId)
        if (coordinatorSession === undefined || workerSession === undefined) {
          throw new Error('headless Team task run did not persist both coordinator and worker Session provenance')
        }
        const coordinatorHeaderRecord = coordinatorSession.records.find(record => record['type'] === 'request/header')
        if (coordinatorHeaderRecord === undefined) throw new Error('coordinator Session did not persist a model request header')
        const coordinatorHeader = valueRecord(valueRecord(coordinatorHeaderRecord['data'], 'coordinator request data')['header'], 'coordinator request header')
        expect(valueString(coordinatorHeader['system'], 'coordinator system prompt'))
          .toContain('at least two independent worker tasks')
        expect(valueString(coordinatorHeader['system'], 'coordinator system prompt'))
          .toContain('research, analysis, writing or editing')
        expect(workerSession.header['id']).toBe(workerBinding['sessionId'])
        const workerAssignment = workerSession.records.find(record => record['type'] === 'user/message'
          && valueRecord(valueRecord(record['data'], 'worker assignment data')['source'], 'worker assignment source')['kind'] === 'team-task-assignment')
        if (workerAssignment === undefined) throw new Error('worker Session did not persist its task assignment source')
        const running = changes[2]
        if (running === undefined) throw new Error('Team journal has no running task snapshot')
        expect(valueRecord(workerAssignment['data'], 'worker assignment data')).toMatchObject({
          source: {
            teamId,
            channelId: assignmentChannelId,
            envelopeId: assignmentId,
            taskId,
            activationId: workerActivation['id'],
            runningRevision: running['revision'],
          },
        })
        const report = sessionToolCall(workerSession, 'team_task_report')
        const reportArguments = JSON.parse(valueString(report['arguments'], 'team_task_report arguments')) as Record<string, unknown>
        expect(reportArguments).toMatchObject({ task_id: taskId, outcome: 'completed', summary: TASK_SUMMARY })
        expect(typeof reportArguments['attempt_id']).toBe('string')

        const start = sessionToolCall(coordinatorSession, 'team_task_start')
        expect(JSON.parse(valueString(start['arguments'], 'team_task_start arguments'))).toEqual({
          subject: TASK_SUBJECT,
          instructions: TASK_INSTRUCTIONS,
          read_scopes: ['examples/headless-agent'],
          write_scopes: [],
        })
        const wait = sessionToolCall(coordinatorSession, 'team_task_wait')
        expect(JSON.parse(valueString(wait['arguments'], 'team_task_wait arguments'))).toEqual({ task_id: taskId })
        expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(wait['callId'], 'team_task_wait call id'))))
          .toEqual({ task_id: taskId, phase: 'completed', summary: TASK_SUMMARY,
            review_policy: { kind: 'none' }, review_result: null, cancellation: null })

        const directChannel = channelLog(logs, 'direct')
        const directChannelId = directChannel.stream.name.slice('channel/'.length)
        const directRecords = directChannel.entries.map(entry => entry.value)
        const final = envelope(directRecords, 'final')
        const humanId = valueString(participant(records, 'human')['id'], 'human participant id')
        expect(final).toMatchObject({
          teamId,
          channelId: directChannelId,
          senderId: coordinatorId,
          audience: [humanId],
          payload: { text: TASK_FINAL_TEXT },
        })
        const finalId = valueString(final['id'], 'final Envelope id')
        expect(directRecords).toContainEqual(expect.objectContaining({
          type: 'channel/receipt', participantId: humanId, envelopeId: finalId,
        }))
        const finalCall = sessionToolCall(coordinatorSession, 'team_final')
        expect(JSON.parse(valueString(finalCall['arguments'], 'team_final arguments')))
          .toEqual({ channel_id: directChannelId, text: TASK_FINAL_TEXT })
      },
    })

    expect(result.stdout).toBe(`${TASK_FINAL_TEXT}\n`)
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  for (const executionRole of ['worker', 'researcher']) {
    it(`executes a declarative workflow through the assembled ${executionRole} template`, async () => {
      const task = 'Compile one deterministic workflow.'
      const result = await runLoaderSmoke({
        label: 'headless Team workflow plan snapshot',
        tempDirPrefix: 'headless-team-workflow-profile-',
        binScript: clockyBinScript,
        configPath: teamWorkflowOverlayPath,
        binArgs: ['--profile', 'headless', '--patch', teamWorkflowOverlayPath,
          ...executionRole === 'worker' ? [] : ['--patch', teamTemplateOverlayPath], task],
        tsconfigPath,
        env: {
          CLOCKY_TELEMETRY_DISABLED: '1',
          CLOCKY_WORKFLOW_MEMBER_ROLE: executionRole,
          TSX_DISABLE_CACHE: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
        prepare: prepareTeamRunFixture,
        inspect: async (cwd) => {
          const logs = await storedLogs(cwd)
          const team = logs.find(log => log.stream.name.startsWith('team/'))
          if (team === undefined) throw new Error('headless Team workflow run did not persist a Team journal')
          const teamId = team.stream.name.slice('team/'.length)
          const records = team.entries.map(entry => entry.value)
          const planChanges = records.filter(record => record['type'] === 'workflow-plan/changed')
          expect(planChanges.map(record => valueRecord(record['plan'], 'workflow plan')['phase']))
            .toEqual(['compiling', 'compiling', 'compiling', 'ready', 'completed'])
          const finalPlan = valueRecord(planChanges.at(-1)?.['plan'], 'completed workflow plan')
          const planId = valueString(finalPlan['id'], 'workflow plan id')
          expect(finalPlan).toMatchObject({
            teamId,
            phase: 'completed',
            result: { kind: 'task-results', tasks: [{ templateId: 'research', phase: 'completed' }] },
          })
          const changes = taskSnapshots(records)
          const created = changes.find(change => change['workflowPlanId'] === planId)
          if (created === undefined) throw new Error('workflow plan did not create a workflow-owned task')
          const taskId = valueString(created['id'], 'workflow task id')
          expect(created).toMatchObject({
            workflowPlanId: planId,
            workflowTemplateId: 'research',
            subject: 'Compile the workflow task.',
          })
          expect(changes.at(-1)).toMatchObject({
            id: taskId,
            phase: 'completed',
            attemptHistory: [{ participantId: participant(records, executionRole)['id'],
              outcome: { kind: 'completed', result: { summary: WORKFLOW_TASK_SUMMARY } } }],
          })

          const workflowChannel = channelLog(logs, 'workflow')
          const workflowChannelId = workflowChannel.stream.name.slice('channel/'.length)
          const workflowRecords = workflowChannel.entries.map(entry => entry.value)
          expect(workflowRecords[0]).toMatchObject({
            type: 'channel/opened',
            manifest: {
              teamId,
              id: workflowChannelId,
              workflowPlanId: planId,
              adapter: { type: 'workflow', version: 1 },
            },
          })

          const sessions = await persistedSessionLogs(cwd)
          const coordinatorId = valueString(participant(records, 'coordinator')['id'], 'coordinator participant id')
          const coordinatorSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === coordinatorId)
          if (coordinatorSession === undefined) throw new Error('workflow run did not persist coordinator Session provenance')
          const start = sessionToolCall(coordinatorSession, 'team_workflow_start')
          expect(JSON.parse(valueString(start['arguments'], 'workflow start arguments'))).toMatchObject({
            plan: { version: 1, name: 'headless-workflow' },
          })
          const wait = sessionToolCall(coordinatorSession, 'team_workflow_wait')
          expect(JSON.parse(valueString(wait['arguments'], 'workflow wait arguments'))).toEqual({ plan_id: planId })
          expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(wait['callId'], 'workflow wait call id'))))
            .toMatchObject({ plan_id: planId, phase: 'completed', result: { kind: 'task-results' } })
          const final = envelope(channelLog(logs, 'direct').entries.map(entry => entry.value), 'final')
          expect(final).toMatchObject({ payload: { text: WORKFLOW_FINAL_TEXT } })
        },
      })
      expect(result.stdout).toBe(`${WORKFLOW_FINAL_TEXT}\n`)
      expect(result.stderr).toBe('')
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
  }

  it('compiles and executes independent workflow tasks across a configured worker pool', async () => {
    const result = await runLoaderSmoke({
      label: 'headless Team multi-worker workflow snapshot',
      tempDirPrefix: 'headless-team-multi-worker-profile-',
      binScript: clockyBinScript,
      configPath: teamMultiWorkerOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', teamMultiWorkerOverlayPath, MULTI_WORKFLOW_TASK],
      tsconfigPath,
      env: {
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareTeamRunFixture,
      inspect: async (cwd) => {
        const logs = await storedLogs(cwd)
        const team = logs.find(log => log.stream.name.startsWith('team/'))
        if (team === undefined) throw new Error('headless multi-worker workflow run did not persist a Team journal')
        const teamId = team.stream.name.slice('team/'.length)
        const records = team.entries.map(entry => entry.value)
        const planChanges = records.filter(record => record['type'] === 'workflow-plan/changed')
        expect(planChanges.at(-2) && valueRecord(planChanges.at(-2)?.['plan'], 'ready workflow plan')['phase']).toBe('ready')
        const finalPlan = valueRecord(planChanges.at(-1)?.['plan'], 'completed multi-worker workflow plan')
        const planId = valueString(finalPlan['id'], 'multi-worker workflow plan id')
        expect(finalPlan).toMatchObject({
          teamId,
          phase: 'completed',
          result: {
            kind: 'task-results',
            tasks: [
              { templateId: 'research-a', phase: 'completed' },
              { templateId: 'research-b', phase: 'completed' },
            ],
          },
        })

        const workers = records
          .filter(record => record['type'] === 'participant/changed')
          .map(record => valueRecord(record['participant'], 'worker participant'))
          .filter(participant => participant['role'] === 'worker' || participant['role'] === 'worker-2')
        const workerIds = new Set(workers.map(worker => valueString(worker['id'], 'worker participant id')))
        expect(workerIds).toHaveLength(2)
        const latestTasks = new Map<string, Record<string, unknown>>()
        for (const task of taskSnapshots(records).filter(task => task['workflowPlanId'] === planId)) {
          latestTasks.set(valueString(task['id'], 'multi-worker task id'), task)
        }
        expect(latestTasks).toHaveLength(2)
        expect([...latestTasks.values()].map(task => task['phase'])).toEqual(['completed', 'completed'])
        const attemptWorkerIds = new Set([...latestTasks.values()].flatMap(task =>
          valueArray(task['attemptHistory'], 'multi-worker attempt history')
            .map(attempt => valueString(valueRecord(attempt, 'multi-worker attempt')['participantId'], 'attempt participant id'))))
        expect(attemptWorkerIds).toEqual(workerIds)

        const sessions = await persistedSessionLogs(cwd)
        const coordinatorId = valueString(participant(records, 'coordinator')['id'], 'coordinator participant id')
        const coordinatorSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === coordinatorId)
        if (coordinatorSession === undefined) throw new Error('multi-worker run did not persist coordinator Session provenance')
        const start = sessionToolCall(coordinatorSession, 'team_workflow_start')
        expect(JSON.parse(valueString(start['arguments'], 'multi-worker start arguments'))).toMatchObject({
          plan: { version: 1, name: 'headless-multi-worker-workflow', bounds: { maxParallelism: 2 } },
        })
        const wait = sessionToolCall(coordinatorSession, 'team_workflow_wait')
        expect(JSON.parse(valueString(wait['arguments'], 'multi-worker wait arguments'))).toEqual({ plan_id: planId })
        expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(wait['callId'], 'multi-worker wait call id'))))
          .toMatchObject({ plan_id: planId, phase: 'completed', result: { kind: 'task-results' } })
        for (const workerId of workerIds) {
          const workerSession = sessions.find(session => session.header['teamId'] === teamId
            && session.header['participantId'] === workerId)
          if (workerSession === undefined) throw new Error(`multi-worker Session '${workerId}' was not persisted`)
          expect(sessionToolCall(workerSession, 'team_task_report')).toBeDefined()
        }
        const final = envelope(channelLog(logs, 'direct').entries.map(entry => entry.value), 'final')
        expect(final).toMatchObject({ payload: { text: MULTI_WORKFLOW_FINAL_TEXT } })
      },
    })
    expect(result.stdout).toBe(`${MULTI_WORKFLOW_FINAL_TEXT}\n`)
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('exercises the coordinator owner-proposal and pending-cancellation tools through a keyless custom composition', async () => {
    const result = await runLoaderSmoke({
      label: 'headless Team owner proposal snapshot',
      tempDirPrefix: 'headless-team-owner-proposal-profile-',
      binScript: clockyBinScript,
      configPath: teamOwnerProposalOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', teamOwnerProposalOverlayPath, OWNER_PROPOSAL_TASK],
      tsconfigPath,
      env: {
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareTeamRunFixture,
      inspect: async (cwd) => {
        const logs = await storedLogs(cwd)
        const team = logs.find(log => log.stream.name.startsWith('team/'))
        if (team === undefined) throw new Error('headless owner-proposal run did not persist a Team journal')
        const teamId = team.stream.name.slice('team/'.length)
        const records = team.entries.map(entry => entry.value)
        expect(records.filter(record => record['type'] === 'team/phase').map(record => record['phase']))
          .toEqual(['active', 'quiescing', 'completed'])
        const changes = taskSnapshots(records)
        expect(changes.map(change => change['phase'])).toEqual(['pending', 'pending', 'cancelled'])
        const taskId = valueString(changes[0]?.['id'], 'owner-proposal task id')
        expect(changes[1]).toMatchObject({ id: taskId, phase: 'pending' })
        expect(changes[1]).not.toHaveProperty('proposedOwnerId')
        expect(changes.at(-1)).toMatchObject({ id: taskId, phase: 'cancelled' })

        const coordinatorId = valueString(participant(records, 'coordinator')['id'], 'coordinator participant id')
        const sessions = await persistedSessionLogs(cwd)
        const coordinatorSession = sessions.find(session => session.header['teamId'] === teamId
          && session.header['participantId'] === coordinatorId)
        if (coordinatorSession === undefined) throw new Error('owner-proposal run did not persist coordinator Session provenance')
        const start = sessionToolCall(coordinatorSession, 'team_task_start')
        expect(JSON.parse(valueString(start['arguments'], 'owner-proposal start arguments'))).toMatchObject({
          subject: 'Reserve a task for owner proposal.',
        })
        const proposal = sessionToolCall(coordinatorSession, 'team_task_propose_owner')
        expect(JSON.parse(valueString(proposal['arguments'], 'owner-proposal arguments'))).toEqual({ task_id: taskId })
        expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(proposal['callId'], 'owner-proposal call id'))))
          .toEqual({ task_id: taskId, phase: 'pending' })
        const cancel = sessionToolCall(coordinatorSession, 'team_task_cancel')
        expect(JSON.parse(valueString(cancel['arguments'], 'owner-proposal cancel arguments'))).toEqual({ task_id: taskId })
        expect(JSON.parse(sessionToolResultText(coordinatorSession, valueString(cancel['callId'], 'owner-proposal cancel call id'))))
          .toEqual({ task_id: taskId, phase: 'cancelled', review_policy: { kind: 'none' }, review_result: null,
            cancellation: { requested_revision: 2, attempt_id: null, expired: false } })
        const final = envelope(channelLog(logs, 'direct').entries.map(entry => entry.value), 'final')
        expect(final).toMatchObject({ payload: { text: OWNER_PROPOSAL_FINAL_TEXT } })
      },
    })
    expect(result.stdout).toBe(`${OWNER_PROPOSAL_FINAL_TEXT}\n`)
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
