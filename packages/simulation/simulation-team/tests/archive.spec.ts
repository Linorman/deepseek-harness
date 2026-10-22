import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { EvolutionNativeWorldDomain } from '../../simulation-local/src/world-environment-domain.ts'
import Loader from '@clocky/cordis-plugin-loader'
import Include from '@clocky/cordis-plugin-include'
import Presets from '@clocky/clocky-agent-presets'
import * as Tools from '@clocky/clocky-tool-simulation'
import * as Role from '@clocky/clocky-tool-simulation/role'
import { SimulationWorldExecutions } from '@clocky/clocky-simulation-world'
import { pathToFileURL } from 'node:url'
import { archiveLogFacet, captureLogArchive, acquireLocalFileOwner } from '@clocky/clocky-storage'
import { boot } from '@clocky/clocky-app-boot'
import { simulationEntityIdSchema, simulationCheckpointRequestSchema, simulationWorldDomainPinSchema, WORLD_ENVIRONMENT_PIN, WORLD_ENVIRONMENT_DEFINITION } from '@clocky/clocky-simulation'
import AttachmentLocal from '@clocky/clocky-attachment-local'
import { createUserMessage } from '@clocky/clocky-llm'
/** Empty-storage backup/restore and reference-preserving archive evidence using real owner implementations. */
import * as Direct from '@clocky/clocky-team-channel-direct'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { assertArchiveTeamClosure, publishWorldArchive, readWorldArchive, verifyWorldArchive, importArchiveLogs, planWorldArchive } from '../src/archive.ts'
import { createWorldBackup, verifyWorldBackup, publishWorldBackup, readWorldBackup, restoreWorldBackup, planWorldBackupMigration, migrateWorldBackup } from '../src/backup.ts'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import { createContext } from './harness.ts'

const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
it.each(['json', 'sqlite'] as const)('archives a full %s closure and restores without source storage', async (backend) => {
  const parent = resolve('.tmp/world-post-mvp/b2'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `${backend}-`))
  const sourceCwd = join(root, 'source', 'workspace'); await mkdir(sourceCwd, { recursive: true })
  const oldRoot = process.env.SIMULATION_COMPANY_ROOT, oldBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = join(root, 'source'); process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('world-archive', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: join(root, 'source'), additionalDormantCwd: sourceCwd,
    loadedContext: { ctx, serviceFiber: ctx.fiber } })
  try {
    // Actual canonical Session request and accepted responsibility are retained, including an unexecuted plan.
    await h.ctx.plugin(AttachmentLocal, { clockyHome: join(root, 'source', 'attachments-home') })
    const image = await h.ctx.attachments.saveImage({ mediaType: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64') })
    const cwdBinding = h.run.snapshot().entities[simulationEntityIdSchema.parse('cwd-person')]!.binding!
    await h.start(); await h.plan()
    const actor = h.ctx.agents.get(h.run.snapshot().entities[h.requester]!.binding!.sessionId)!
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: image }] }), { surfaceOp: 'append' })
    await h.ctx.sessions.flush(actor.session)
    const originalCheckpoint = simulationCheckpointRequestSchema.parse({ id: 'original-before-archive', implementationVersion: 'archive-test/1', maxDrainRounds: 8, maxAttempts: 3 })
    expect((await h.connection.checkpoint(originalCheckpoint)).status).toBe('completed')
    const collection = await h.connection.collectCheckpointCandidate(8, 3)
    const sourceTeam = await h.ctx.teams.getTeam({ teamId: h.run.snapshot().teamReservation!.teamId })
    expect(() =>{  assertArchiveTeamClosure({ ...sourceTeam, team: { ...sourceTeam.team,
      workspacePath: sourceCwd } }) }).toThrow(/workspaces/)
    expect(() =>{  assertArchiveTeamClosure({ ...sourceTeam, team: { ...sourceTeam.team,
      parentTeamId: sourceTeam.team.id } }) }).toThrow(/child-Team/)
    const body = await collection.exportArchive(limits)
    expect(body.attachments).toHaveLength(1)
    const missingImage = { ...body, attachments: [] }; expect(() => verifyWorldArchive(JSON.stringify(missingImage),
      limits)).toThrow(/attachment closure/)
    const changedImage = structuredClone(body)
    Object.assign(changedImage.attachments[0]!.ref!, { width: image.width + 1 })
    expect(() => verifyWorldArchive(JSON.stringify(changedImage), limits)).toThrow(/image metadata differs/)
    const invalidCwd = structuredClone(body)
    Object.assign(invalidCwd.sessions[0]!.header!, { cwd: 7 })
    const invalidReferences = invalidCwd.references as { sessions: { kind: string; header?: { id: string; cwd?: unknown } }[] }
    const changedId = (invalidCwd.sessions[0]!.header as { id: string }).id
    const invalidReference = invalidReferences.sessions.find(ref => ref.kind === 'materialized' && ref.header?.id === changedId)
    Object.assign(invalidReference!.header!, { cwd: 7 })
    expect(() => verifyWorldArchive(JSON.stringify(invalidCwd), limits)).toThrow()
    const changedHeader = structuredClone(body)
    Object.assign(changedHeader.sessions[0]!.header!, { cwd: join(sourceCwd, 'different') })
    expect(() => verifyWorldArchive(JSON.stringify(changedHeader), limits)).toThrow(/Session header differs/)
    await expect(collection.exportArchive({ ...limits, maxEntries: 1 })).rejects.toThrow(/budget|bounded/)
    expect(planWorldArchive(body, limits)).toMatchObject({ destructive: false, reclaimableBytes: 0, attachments: 1 })
    expect((body.references as { sessions: { kind: string }[] }).sessions.some(ref => ref.kind === 'unmaterialized')).toBe(true)
    const archiveRoot = join(root, 'archive'), hash = await publishWorldArchive(archiveRoot, body, limits)
    expect(await publishWorldArchive(archiveRoot, body, limits)).toBe(hash)
    const pointerPath = join(archiveRoot, `${hash}.location.json`)
    await rename(pointerPath, `${pointerPath}.interrupted`)
    await expect(readWorldArchive(archiveRoot, hash, limits)).rejects.toThrow()
    expect(await publishWorldArchive(archiveRoot, body, limits)).toBe(hash)
    const saved = await readWorldArchive(archiveRoot, hash, limits)
    const bundle = createWorldBackup(saved, limits), backupRoot = join(root, 'backups')
    const bundleText = JSON.stringify(bundle)
    expect(verifyWorldBackup(bundleText, limits)).toEqual(bundle)
    expect(bundle.manifest.unmaterializedSessions.length).toBeGreaterThan(0)
    expect(bundle.manifest.attachments).toHaveLength(1)
    const backupHash = await publishWorldBackup(backupRoot, bundle, limits)
    expect(await Promise.all([publishWorldBackup(backupRoot, bundle, limits),
      publishWorldBackup(backupRoot, bundle, limits)])).toEqual([backupHash, backupHash])
    expect(await readWorldBackup(backupRoot, backupHash, limits)).toEqual(bundle)
    const originalBytes = await readFile(join(archiveRoot, `${hash}.json`), 'utf8')
    const migration = planWorldBackupMigration(originalBytes, limits)
    expect(migration.losses).toEqual([])
    expect(await migrateWorldBackup(originalBytes, migration, backupRoot, limits)).toBe(backupHash)
    expect(await readFile(join(archiveRoot, `${hash}.json`), 'utf8')).toBe(originalBytes)
    await expect(migrateWorldBackup(originalBytes + ' ', migration, backupRoot, limits)).rejects.toThrow(/exact input/)
    const wrongManifest = structuredClone(bundle)
    wrongManifest.manifest.sessions[0]!.sha256 = '0'.repeat(64)
    expect(() => verifyWorldBackup(JSON.stringify(wrongManifest), limits)).toThrow(/manifest differs/)
    await writeFile(join(backupRoot, `${backupHash}.backup.json`), 'corrupt')
    await expect(publishWorldBackup(backupRoot, bundle, limits)).rejects.toThrow(/conflicting bytes/)
    await writeFile(join(backupRoot, `${backupHash}.backup.json`), bundleText)
    expect(saved).toEqual(body)
    const archiveReader = archiveLogFacet([saved.native], limits)
    const originalStream = await archiveReader.open({ name: saved.native.name, version: saved.native.version })
    try {
      expect(await captureLogArchive(originalStream, saved.native.entries.length - 1, limits)).toEqual(saved.native)
      await expect(originalStream.compact({ throughSequence: 0, expectedCheckpointSequence: 1 })).rejects.toThrow(/read-only/)
    } finally { await originalStream.close() }
    await expect(archiveReader.open({ name: 'missing', version: 1 })).rejects.toThrow(/missing/)
    const missing = structuredClone(saved); missing.owners.pop()
    expect(() => verifyWorldArchive(JSON.stringify(missing), limits)).toThrow(/closure/)
    const branch = structuredClone(body); Object.assign(branch.snapshot!, { parentRunId: 'unexported-parent' })
    expect(() => verifyWorldArchive(JSON.stringify(branch), limits)).toThrow()
    const duplicatedOwners = structuredClone(saved)
    const ownerRefs = duplicatedOwners.references as { team: unknown; channels: unknown[] }
    ownerRefs.channels[0] = structuredClone(ownerRefs.team)
    expect(() => verifyWorldArchive(JSON.stringify(duplicatedOwners), limits)).toThrow(/duplicate references/)
    const duplicatedSessions = structuredClone(saved)
    const sessionRefs = (duplicatedSessions.references as { sessions: { kind: string }[] }).sessions
    const materialized = sessionRefs.flatMap((ref, index) => ref.kind === 'materialized' ? [index] : [])
    sessionRefs[materialized[1]!] = structuredClone(sessionRefs[materialized[0]!]!)
    expect(() => verifyWorldArchive(JSON.stringify(duplicatedSessions), limits)).toThrow(/duplicate references/)
    const foreignParent = structuredClone(saved)
    Object.assign(foreignParent.sessions[0]!.header!, { parentSession: 'outside-archive' })
    expect(() => verifyWorldArchive(JSON.stringify(foreignParent), limits)).toThrow(/outside the protected closure/)
    const wrongVersion = { ...saved, version: 2 }
    expect(() => verifyWorldArchive(JSON.stringify(wrongVersion), limits)).toThrow()
    collection.release()
    await expect(collection.exportArchive(limits)).rejects.toThrow()
    const before = h.run.snapshot()
    await h.connection.close(); await h.run.close(); await h.ctx.fiber.dispose()
    // The complete source tree becomes inaccessible under its former path before target owners start.
    await rename(join(root, 'source'), join(root, 'offline-source'))
    const targetRoot = join(root, 'target'), targetCwd = join(targetRoot, 'workspace')
    const importedCheckpoint = simulationCheckpointRequestSchema.parse({ ...originalCheckpoint, id: `archive-import/${hash}` })
    let failValidation = true
    const prepare = async (staging: string) => {
      const target = await createContext(staging, backend)
      await target.ctx.plugin(Direct)
      await target.ctx.plugin(SimulationWorldExecutions)
      await target.ctx.plugin(AttachmentLocal, { clockyHome: join(staging, 'attachments-home') })
      await mkdir(join(staging, 'workspace'), { recursive: true })
      const nativeRoot = join(staging, 'simulation', createHash('sha256').update(h.selection.spec.runId).digest('hex'))
      await mkdir(nativeRoot, { recursive: true })
      const native = backend === 'json' ? new JsonStorageBackend(join(nativeRoot, 'journal'))
        : new SqliteStorageBackend({ path: join(nativeRoot, 'journal.sqlite'), journalMode: 'wal' })
      return { ctx: target.ctx, owners: target.ctx.storage.backend.get(backend).log!, native: native.log,
        async validate() {
          await native.close()
          if (failValidation) throw new Error('Injected exit before publication')
          await expect(target.ctx.simulationTeams.restore({ ...h.selection, mode: 'open' }, { id: originalCheckpoint.id, implementationVersion: originalCheckpoint.implementationVersion, maxAttempts: 3 })).rejects.toThrow(/Session prefix does not match/)
          const restored = await target.ctx.simulations.open({ ...h.selection, mode: 'open' })
          try {
            const observed = await target.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec,
              includeRecords: true })
            expect(observed?.records?.slice(0, saved.native.entries.length)).toEqual(saved.native.entries)
            if (restored.snapshot().checkpoints?.[importedCheckpoint.id] === undefined) expect(restored.snapshot()).toEqual(before)
            const team = await target.ctx.teams.getTeam({ teamId: before.teamReservation!.teamId })
            const attached = await target.ctx.simulationTeams.attach(restored, team.team.id, 'simulation/company-product')
            try {
              const rechecked = await attached.collectCheckpointCandidate(8, 3)
              try {
                expect(rechecked.team.fingerprint).toBe(collection.team.fingerprint)
                expect(rechecked.channels.map(ref => ref.fingerprint)).toEqual(collection.channels.map(ref => ref.fingerprint))
              } finally { rechecked.release() }
              const anchor = await attached.checkpoint(importedCheckpoint)
              expect(anchor.status).toBe('completed')
              expect(restored.snapshot().checkpoints?.[originalCheckpoint.id]).toEqual(before.checkpoints?.[originalCheckpoint.id])
              return { checkpointId: importedCheckpoint.id, implementationVersion: importedCheckpoint.implementationVersion }
            } finally { await attached.close() }
          } finally { await restored.close() }
        },
        async close() { await native.close(); await target.ctx.fiber.dispose() },
      }
    }
    await expect(restoreWorldBackup(bundleText, targetRoot, limits, { [sourceCwd]: targetCwd },
      prepare)).rejects.toThrow(/Injected/)
    await expect(readFile(join(targetRoot, 'archive-restore.json'))).rejects.toThrow()
    failValidation = false
    const ownerPath = `${targetRoot}.restore-owner.sqlite`
    const child = spawn(process.execPath, ['--import', 'tsx/esm', resolve('packages/simulation/simulation-team/tests/archive-owner-process.ts'), ownerPath],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, TMPDIR: parent } })
    const exited = once(child, 'exit'); let stderr = ''
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const deadline = setTimeout(() => child.kill('SIGKILL'), 15000)
    try {
      const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })]) as unknown[]
      expect(message[0]).toEqual({ event: 'archive-publication-held' })
      expect(() => acquireLocalFileOwner(ownerPath)).toThrow()
      child.kill('SIGKILL')
      expect(await exited).toEqual([null, 'SIGKILL'])
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exited }
    // The stable owner database remains, but process death releases its kernel lock before the actual restore retries.
    await restoreWorldBackup(bundleText, targetRoot, limits, { [sourceCwd]: targetCwd }, prepare)
    await restoreWorldBackup(bundleText, targetRoot, limits, { [sourceCwd]: targetCwd }, prepare)
    const receipt = JSON.parse(await readFile(join(targetRoot, 'archive-restore.json'), 'utf8')) as Record<string, unknown>
    expect(receipt.sourceHash).toBe(hash)
    expect(receipt.anchor).toEqual({ checkpointId: importedCheckpoint.id, implementationVersion: importedCheckpoint.implementationVersion })
    expect(receipt.cwdMappings).toEqual([{ sessionId: cwdBinding.sessionId, sourceCwd, targetCwd }])
    const target = await createContext(targetRoot, backend)
    try {
      await target.ctx.plugin(Direct)
      await target.ctx.plugin(SimulationWorldExecutions)
      await target.ctx.plugin(AttachmentLocal, { clockyHome: join(targetRoot, 'attachments-home') })
      await target.ctx.plugin(Loader)
      target.ctx.baseUrl = pathToFileURL(targetRoot).href + '/'
      target.ctx.loader.builtins.include = Include; target.ctx.loader.builtins['company-role'] = Role
      const presets = join(targetRoot, 'presets'); await mkdir(join(presets, 'simulation'), { recursive: true })
      await writeFile(join(presets, 'simulation', 'agent.cordis.yml'), '[{"name":"cordis:company-role"}]\n')
      await target.ctx.plugin(Presets, { default: 'simulation', includeUserRoot: false, roots: [{ path: presets, trust: 'system' }] })
      await target.ctx.plugin(Tools)
      target.ctx.llm.registerAdapter(['company'], h.adapter)
      const restored = await target.ctx.simulationTeams.restore({ ...h.selection, mode: 'open' }, { id: importedCheckpoint.id, implementationVersion: importedCheckpoint.implementationVersion, maxAttempts: 3 })
      try {
        expect(restored.run.snapshot().phase).toBe('paused')
        await restored.run.setPhase('running', restored.run.snapshot().revision)
        const resumed = await restored.connection.ensureResident(h.requester, { activation: { provider: 'in-process', seed: { kind: 'resume' },
          agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [] })
        expect(resumed.status).toBe('resident')
        const resumedTeam = await target.ctx.teams.getTeam({ teamId: before.teamReservation!.teamId })
        expect(resumedTeam.participants.length).toBe(sourceTeam.participants.length)
        expect(resumedTeam.activations.length).toBeGreaterThanOrEqual(sourceTeam.activations.length)
        expect(restored.run.snapshot().entities[h.requester]!.binding!.sessionId).toBe(before.entities[h.requester]!.binding!.sessionId)
      } finally { await restored.connection.close(); await restored.run.close() }
      expect((await target.ctx.attachments.readImage(image)).data.length).toBe(image.bytes)
      expect((await target.ctx.sessionPersistence.readFrom(cwdBinding.sessionId, 0)).meta.cwd).toBe(targetCwd)
      const unmaterialized = before.entities[h.candidate]!.binding!.sessionId
      expect(await target.ctx.sessionPersistence.isUnmaterialized(unmaterialized)).toBe(true)
      for (const session of saved.sessions) {
        const header = session.header as { id: import('@clocky/clocky-session').SessionId }
        expect((await target.ctx.sessionPersistence.readFrom(header.id, 0)).events.slice(0, session.events.length)).toEqual(session.events)
      }
      await expect(importArchiveLogs(target.ctx.storage.backend.get(backend).log!, saved.owners)).rejects.toThrow(/already exists/)
    } finally { await target.ctx.fiber.dispose() }
    const original = await readFile(join(archiveRoot, `${hash}.json`), 'utf8')
    await writeFile(join(archiveRoot, `${hash}.json`), original + ' ')
    await expect(readWorldArchive(archiveRoot, hash, limits)).rejects.toThrow(/hash/)
    await writeFile(join(archiveRoot, `${hash}.json`), original)
    expect(await readWorldArchive(archiveRoot, hash, limits)).toEqual(saved)
  } finally {
    await h.close()
    if (oldRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = oldRoot
    if (oldBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = oldBackend
  }
}, 60000)

it('refuses an actually installed custom domain without a declared complete-reference export contract', async () => {
  const parent = resolve('.tmp/world-post-mvp/b2'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'custom-domain-'))
  const oldRoot = process.env.SIMULATION_COMPANY_ROOT, oldBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = root; process.env.SIMULATION_COMPANY_BACKEND = 'json'
  const ctx = await boot('world-archive-custom', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
  const pin = simulationWorldDomainPinSchema.parse({ ...WORLD_ENVIRONMENT_PIN, domain: 'custom-environment',
    schemaRef: 'custom.environment/schema/1', implementationRef: 'custom.environment/provider/1' })
  class CustomEnvironment extends EvolutionNativeWorldDomain {
    override readonly definition = { ...WORLD_ENVIRONMENT_DEFINITION, domain: pin.domain, schemaRef: pin.schemaRef }
    override readonly ref = pin.implementationRef
    constructor() { super('supply') }
  }
  const provider = new CustomEnvironment()
  ctx.effect(() => ctx.simulations.domains('local').register(provider.definition, provider))
  const h = await hiringResourceHarness('json', 'hire-existing', { evidenceRoot: root, installedPins: [pin], loadedContext: { ctx, serviceFiber: ctx.fiber } })
  try {
    expect(h.run.snapshot().world!.definition.operations).toContainEqual(pin)
    const collection = await h.connection.collectCheckpointCandidate(8, 3)
    try { await expect(collection.exportArchive(limits)).rejects.toMatchObject({ code: 'SIMULATION_ARCHIVE_UNSUPPORTED' }) }
    finally { collection.release() }
  } finally {
    await h.close()
    if (oldRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = oldRoot
    if (oldBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = oldBackend
  }
}, 60000)
