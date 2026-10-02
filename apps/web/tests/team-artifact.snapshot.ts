/**
 * A real worker model stream is held at a deterministic fixture barrier; runtime setup retains provider-backed task artifacts.
 * Browser plugin not available; the repository Playwright lane exercises real Loader, Host and local bytes.
 * This proves artifact reading rather than a complete model publishing tool chain.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { addAbortListener } from 'node:events'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { ParticipantSnapshot, TeamArtifactReference, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-artifact'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('reads and downloads persisted Team artifact bytes, retains a failed same-target read and clears them on Team change', async () => {
  const output = join(process.cwd(), '.tmp/team-artifact-browser')
  const objects = join(output, 'objects')
  await mkdir(join(output, 'downloads'), { recursive: true })
  const override = join(output, 'coordinator.json')
  await writeFile(override, JSON.stringify([{ kind: 'hang' }]))
  const worker = join(output, 'worker.jsonl')
  const chunks = [
    { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'The artifact is ready for its owning task.' } } },
    { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  await writeFile(worker, [JSON.stringify({ type: 'session', version: 0, id: 'artifact-worker', createdAt: 1 }),
    ...chunks.map(data => JSON.stringify({ type: 'assistant/chunk', data })),
  ].join('\n') + '\n')
  const overlay = join(output, 'routes.yml')
  await writeFile(overlay, `- id: team-placement-default
  config:
    routes:
      - provider: in-process
        roles: [artifact-worker]
        model: test-provider/test-model
        modelProvider: test-provider
        modelId: test-model
        preset: minimal
        cwd: !!js process.cwd()
        maxTokens: 1000
    maxActivationsPerDrive: 1
    maxCursorRetries: 3
- id: team-artifact-local
  config:
    root: ${JSON.stringify(objects)}
`)
  const scaffold = await launchWebScaffold({ tempRoot: output,
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override, replayChildFixtures: [worker], extraOverlayPath: overlay })
  let workerParticipant: ParticipantSnapshot['id'] | undefined
  const modelBlocked = Promise.withResolvers<undefined>()
  const removeModelBarrier = scaffold.ctx.on('llm/stream', (options, next) => {
    const stream = next()
    const session = options.sessionId === undefined ? undefined : scaffold.ctx.sessions.get(options.sessionId)
    if (workerParticipant === undefined || session?.header.participantId !== workerParticipant) return stream
    return (async function* () {
      const signal = options.signal
      if (signal === undefined) throw new Error('Worker model fixture requires its actual cancellation lifetime')
      const cancelled = Promise.withResolvers<undefined>()
      const listener = addAbortListener(signal, () => { cancelled.resolve(undefined) })
      try {
        for await (const chunk of stream) {
          yield chunk
          // The actual provider call is consumed, but no terminal model output or automatic task result can escape this barrier.
          modelBlocked.resolve(undefined)
          await cancelled.promise
          signal.throwIfAborted()
        }
      } finally { listener[Symbol.dispose]() }
    })()
  }, { prepend: true })
  const browser = await chromium.launch({ downloadsPath: join(output, 'downloads') })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true })
  const errors = watchConsole(page)
  const reads: Promise<{ result: { ok: boolean; value?: { data: string; bytes: number } } }>[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/team.artifact.read') {
      reads.push(response.json() as Promise<{ result: { ok: boolean; value?: { data: string; bytes: number } } }>)
    }
  })
  const teamIds: TeamStateSnapshot['team']['id'][] = []
  let failure: unknown
  let moved: { object: string; held: string } | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '团队产物读取', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    teamIds.push(teamId)
    const state = async () => await rpc<TeamStateSnapshot>('team.get', { teamId })
    const member = await rpc<ParticipantSnapshot>('team.member.invite', { teamId, expectedCursor: (await state()).team.cursor,
      kind: 'local-agent', role: 'artifact-worker', displayName: '产物执行成员', capabilities: ['artifact-browser'],
      provider: 'in-process', preset: 'minimal', model: 'test-provider/test-model' })
    workerParticipant = member.id
    await rpc('team.member.activate', { teamId, participantId: member.id, expectedCursor: (await state()).team.cursor })
    await rpc('team.postInput', { teamId, text: '等待产物字节验证。' })
    await expect.poll(async () => (await state()).activations.some(binding => binding.activation.status === 'running')).toBe(true)
    const create = async () => await scaffold.authenticatedRpc<TeamTaskSnapshot>('team.task.create', { teamId,
      expectedCursor: (await state()).team.cursor, idempotencyKey: 'artifact-browser-task', subject: '产物报告',
      description: 'Prepare the report for this assigned task.', blockedBy: [], requiredCapabilities: ['artifact-browser'],
      placement: { participantIds: [member.id] }, priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    let reply = await create()
    for (let attempt = 0; attempt < 3 && !reply.result.ok && reply.result.error.code === 'team-cursor-conflict'; attempt++) reply = await create()
    if (!reply.result.ok) throw new Error(`Artifact task refused: ${JSON.stringify(reply.result.error)}`)
    const taskId = reply.result.value.id
    await expect.poll(async () => (await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId })).phase,
      { timeout: 30_000 }).toBe('running')
    await modelBlocked.promise
    const task = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId })
    const lease = task.lease
    if (lease?.activationId === undefined) throw new Error('Real artifact worker did not retain its assignment activation')
    const binding = (await state()).activations.find(value => value.activation.id === lease.activationId)
    if (binding === undefined) throw new Error('Artifact attempt has no current binding')
    expect(task.phase).toBe('running')
    expect(scaffold.ctx.agents.get(binding.sessionId)?.status).toBe('running')
    expect(scaffold.ctx.sessions.get(binding.sessionId)?.events.some(event => event.type === 'assistant/chunk')).toBe(true)
    const body = '# 团队报告\n\n原始字节：中文与 emoji 🧪。\nThis content belongs only to the first Team.\n'
    const reference = await scaffold.ctx.teamArtifacts.save('local', { teamId, taskId, sourceAttemptId: lease.attemptId,
      kind: 'report', visibility: 'team', data: body })
    const issuer = scaffold.ctx.teams.openActivationActorProofIssuer()
    const proof = issuer.issue(binding)
    try {
      await scaffold.ctx.teams.settleTaskAttempt({ actor: proof.proof, taskId, attemptId: lease.attemptId,
        expectedRevision: task.revision, outcome: { kind: 'completed', result: { summary: 'Persisted provider-backed report.', artifacts: [reference] } } })
    } finally { proof.revoke(); issuer.close() }
    const completed = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId })
    expect(completed.phase).toBe('completed')
    expect(completed.attemptHistory[0]?.outcome).toMatchObject({ kind: 'completed', result: { artifacts: [reference] } })
    const persisted = await rpc<{ items: TeamArtifactReference[] }>('team.artifact.list', { teamId })
    expect(persisted.items).toContainEqual(reference)

    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=artifacts`, { waitUntil: 'load' })
    const workspace = page.locator('[data-team-workspace-page]')
    const artifacts = workspace.getByRole('region', { name: '产物', exact: true })
    await artifacts.getByText(reference.id, { exact: true }).waitFor()
    await artifacts.getByRole('button', { name: '读取产物', exact: true }).click()
    const preview = artifacts.locator('[aria-label="读取产物"]')
    await expect.poll(async () => preview.locator('pre').textContent()).toBe(body)
    const expectedBytes = Buffer.from(body)
    await preview.getByText(`${expectedBytes.byteLength} 字节`, { exact: true }).waitFor()
    const download = page.waitForEvent('download')
    await preview.getByRole('button', { name: '下载', exact: true }).click()
    const saved = join(output, 'downloaded-report.bin')
    await (await download).saveAs(saved)
    expect(await readFile(saved)).toEqual(expectedBytes)
    await page.screenshot({ path: join(output, '01-artifact-read.png') })

    const digest = reference.contentHash
    if (digest === undefined) throw new Error('Local artifact omitted its content-addressed identity')
    const object = join(objects, digest.slice(0, 2), digest.slice(2)), held = join(output, 'temporarily-missing-object')
    await rename(object, held)
    moved = { object, held }
    await artifacts.getByRole('button', { name: '读取产物', exact: true }).click()
    await artifacts.getByRole('alert').waitFor()
    await artifacts.getByText('产物内容尚未重新验证，请重试读取。', { exact: true }).waitFor()
    expect(await preview.locator('pre').textContent()).toBe(body)
    expect(await preview.getByRole('button', { name: '下载', exact: true }).isEnabled()).toBe(true)
    await page.screenshot({ path: join(output, '02-artifact-failed-read.png') })
    await rename(held, object)
    moved = undefined
    await artifacts.getByRole('button', { name: '读取产物', exact: true }).click()
    await expect.poll(async () => artifacts.getByText('产物内容尚未重新验证，请重试读取。', { exact: true }).count()).toBe(0)
    await expect.poll(async () => artifacts.getByRole('alert').count()).toBe(0)
    await expect.poll(async () => preview.locator('pre').textContent()).toBe(body)
    expect(await artifacts.getByText('产物内容尚未重新验证，请重试读取。', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(output, '03-artifact-retried.png') })

    const other = await rpc<TeamStateSnapshot>('team.create', { objective: '空团队产物', cwd: scaffold.workspaceCwd })
    teamIds.push(other.team.id)
    await page.getByRole('button', { name: /^空团队产物 / }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('team')).toBe(other.team.id)
    await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '产物', exact: true }).click()
    await workspace.getByText('暂无产物，任务发布结果后会出现在这里。', { exact: true }).waitFor()
    expect(await workspace.locator('[aria-label="读取产物"]').count()).toBe(0)
    expect(await workspace.getByText(reference.id, { exact: true }).count()).toBe(0)
    expect(await workspace.getByText('This content belongs only to the first Team.', { exact: false }).count()).toBe(0)
    const foreign = await scaffold.authenticatedRpc('team.artifact.read', { teamId: other.team.id, artifactId: reference.id })
    expect(foreign.result).toMatchObject({ ok: false, error: { code: 'team-artifact-not-found' } })
    await page.screenshot({ path: join(output, '04-other-team-cleared.png') })
    const observedReads = await Promise.all(reads)
    expect(observedReads.filter(value => value.result.ok)).toHaveLength(2)
    expect(observedReads.filter(value => !value.result.ok)).toHaveLength(1)
    expect(observedReads.filter(value => value.result.ok).every(value => value.result.value?.data === expectedBytes.toString('base64'))).toBe(true)
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    try {
      if (moved !== undefined) await rename(moved.held, moved.object)
      await browser.close()
      for (const teamId of teamIds) await rpc('team.cancel', { teamId })
    } finally {
      removeModelBarrier()
      try { await scaffold.close() }
      catch (error: unknown) {
        const describe = (value: unknown): unknown => value instanceof AggregateError
          ? { message: value.message, errors: value.errors.map(describe) } : value instanceof Error ? value.message : String(value)
        await writeFile(join(output, 'cleanup-failure.json'), JSON.stringify(describe(error)))
        if (failure !== undefined) throw new AggregateError([failure, error], 'Artifact browser scenario and cleanup failed')
        throw error
      }
    }
  }
})
