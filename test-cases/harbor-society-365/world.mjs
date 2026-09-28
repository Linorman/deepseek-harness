/** Standalone case CLI: passive environment, durable decisions, replay and coverage audit. */
import assert from 'node:assert/strict'
import { appendFile, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorld, advanceWorld, applyDecision, actorView, assertWorld, fingerprint, replayWorld } from './engine.mjs'
import { verifyIntegrity } from './integrity.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(root, 'output')
const journalPath = resolve(output, 'journal.jsonl')
const seed = JSON.parse(await readFile(resolve(root, 'seed.json'), 'utf8'))
const [command, ...args] = process.argv.slice(2)
const emit = value => console.log(JSON.stringify(value, null, 2))
const withinCase = path => {
  const absolute = resolve(root, path)
  const part = relative(root, absolute)
  assert.ok(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), 'file must be inside this case')
  return absolute
}
const label = value => {
  assert.match(value ?? '', /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, 'invalid file identity')
  return value
}
const exists = async path => {
  try { await readFile(path); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
const save = async (path, value) => {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}
const readJournal = async () => {
  const raw = await readFile(journalPath, 'utf8')
  assert.ok(raw.endsWith('\n'), 'journal has an incomplete tail; do not invent missing history')
  const lines = raw.trimEnd().split('\n')
  return { raw, lines, events: lines.map(line => JSON.parse(line)) }
}
const load = async () => {
  const journal = await readJournal()
  const last = journal.events.at(-1)
  let state
  if (await exists(resolve(output, 'state.json'))) {
    const cached = JSON.parse(await readFile(resolve(output, 'state.json'), 'utf8'))
    if (cached.seedHash === fingerprint(seed) && cached.revision === last.revision && fingerprint(cached) === last.stateHash) state = cached
  }
  state ??= replayWorld(seed, journal.events)
  return { state, journal }
}
const commit = async (kind, payload, state) => {
  const entry = { kind, payload, revision: state.revision, day: state.day, stateHash: fingerprint(state) }
  await appendFile(journalPath, `${JSON.stringify(entry)}\n`)
  await save(resolve(output, 'state.json'), state)
}
const overview = state => ({ name: state.name, day: state.day, revision: state.revision, horizon: state.horizon,
  actors: Object.values(state.actors).map(({ id, name, kind, operating, wellbeing, trust }) => ({ id, name, kind, operating, wellbeing, trust })),
  roadClosureUntil: state.roadClosureUntil, notices: state.notices.filter(item => item.day >= state.day - 30),
  openOrders: Object.values(state.orders).filter(item => item.phase === 'open').length,
  openLoans: Object.values(state.loans).filter(item => item.phase === 'open').length,
  organizations: Object.values(state.organizations) })
const viewPath = viewId => {
  assert.match(viewId ?? '', /^view-[a-f0-9]{64}$/)
  return resolve(output, 'views', `${viewId}.json`)
}
const readView = async viewId => {
  const view = JSON.parse(await readFile(viewPath(viewId), 'utf8'))
  const { viewId: retained, ...body } = view
  assert.equal(retained, viewId)
  assert.equal(`view-${fingerprint(body)}`, viewId, 'actor view was modified')
  return view
}
const readCheckpoint = async checkpointId => {
  const cp = JSON.parse(await readFile(resolve(output, 'checkpoints', `${label(checkpointId)}.json`), 'utf8'))
  const { seal, ...body } = cp
  assert.equal(fingerprint(body), seal, 'checkpoint was modified')
  assert.equal(cp.seedHash, fingerprint(seed), 'checkpoint belongs to another seed')
  return cp
}

async function audit(state, journal) {
  await verifyIntegrity(root)
  let replayed = createWorld(seed)
  assert.equal(fingerprint(replayed), journal.events[0].stateHash)
  for (const entry of journal.events.slice(1)) {
    if (entry.kind === 'decision') {
      const view = await readView(entry.payload.viewId)
      const { viewId, worldHash, ...observed } = view
      assert.equal(worldHash, fingerprint(replayed), 'decision used a view from another world state')
      assert.deepEqual(observed, actorView(replayed, entry.payload.actor), 'decision context contains foreign or altered facts')
      replayed = applyDecision(replayed, entry.payload)
    } else if (entry.kind === 'advance') replayed = advanceWorld(replayed, entry.payload.targetDay)
    else throw new Error(`unknown journal event: ${entry.kind}`)
    assert.equal(fingerprint(replayed), entry.stateHash)
    assert.equal(replayed.revision, entry.revision)
    assert.equal(replayed.day, entry.day)
  }
  assert.equal(fingerprint(replayed), fingerprint(state))
  const balances = assertWorld(replayed)
  const decisions = Object.values(state.decisions)
  const material = decisions.filter(item => item.material)
  const checkpoints = []
  for (const file of await readdir(resolve(output, 'checkpoints'))) {
    if (!file.endsWith('.json')) continue
    const cp = await readCheckpoint(file.slice(0, -5))
    assert.ok(cp.eventCount > 0 && cp.eventCount <= journal.events.length)
    assert.equal(cp.prefixHash, fingerprint(journal.lines.slice(0, cp.eventCount).join('\n') + '\n'))
    assert.equal(cp.stateHash, journal.events[cp.eventCount - 1].stateHash)
    assert.equal(cp.day, journal.events[cp.eventCount - 1].day)
    assert.ok(cp.memory.length >= 80)
    checkpoints.push(cp)
  }
  checkpoints.sort((a, b) => a.day - b.day)
  const dates = [0, ...checkpoints.map(cp => cp.day), state.day]
  const maxCheckpointGap = Math.max(...dates.slice(1).map((day, index) => day - dates[index]))
  let recovered = false
  for (const file of await readdir(resolve(output, 'recovery-checks'))) {
    if (!file.endsWith('.json')) continue
    const probe = JSON.parse(await readFile(resolve(output, 'recovery-checks', file), 'utf8'))
    const cp = await readCheckpoint(probe.checkpointId)
    if (probe.valid === true && cp.day >= 180 && probe.checkpointSeal === cp.seal && probe.stateHash === cp.stateHash) recovered = true
  }
  const coverage = { decisions: decisions.length, materialDecisions: material.length,
    activeWeeks: new Set(material.map(item => Math.floor(item.day / 7))).size,
    actors: new Set(material.map(item => item.actor)).size,
    teamIdentities: new Set(material.map(item => item.teamIdentity)).size,
    checkpoints: checkpoints.length, checkpointDays: new Set(checkpoints.map(cp => cp.day)).size, maxCheckpointGap }
  const checks = { worldIntegrity: true, horizon: state.day === state.horizon,
    decisionCoverage: coverage.materialDecisions >= 120 && coverage.activeWeeks >= 40 && coverage.actors >= 8 && coverage.teamIdentities >= 4,
    checkpointCoverage: coverage.checkpointDays >= 12 && coverage.maxCheckpointGap <= 45,
    recoveryCheck: recovered }
  return { checks, mechanicallyComplete: Object.values(checks).every(Boolean), day: state.day, coverage, balances,
    openOrders: Object.values(state.orders).filter(item => item.phase === 'open'),
    openLoans: Object.values(state.loans).filter(item => item.phase === 'open'),
    unpaidCosts: Object.values(state.actors).filter(item => item.unpaidCosts > 0).map(({ id, unpaidCosts }) => ({ id, unpaidCosts })),
    requiresHumanReview: '核对 Team 身份、独立决策、记忆质量与长期因果；机械审计不证明模型自主性。' }
}

async function execute() {
  switch (command) {
    case 'init': {
      if (await exists(journalPath)) { emit(overview((await load()).state)); return }
      const state = createWorld(seed)
      await commit('init', { seedHash: fingerprint(seed) }, state)
      emit(overview(state)); return
    }
    case 'overview': emit(overview((await load()).state)); return
    case 'view': {
      const { state } = await load()
      const body = { ...actorView(state, args[0]), worldHash: fingerprint(state) }
      const viewId = `view-${fingerprint(body)}`
      await save(viewPath(viewId), { ...body, viewId })
      emit({ viewId, file: `output/views/${viewId}.json`, ...body }); return
    }
    case 'act': {
      const raw = JSON.parse(await readFile(withinCase(args[0]), 'utf8'))
      assert.deepEqual(Object.keys(raw).sort(), ['actions', 'actor', 'id', 'rationale', 'teamIdentity', 'viewId'])
      const view = await readView(raw.viewId)
      assert.equal(view.actor, raw.actor, 'view belongs to another actor')
      const { state } = await load()
      const request = { ...raw, observedRevision: view.revision }
      if (!Object.hasOwn(state.decisions, request.id)) {
        assert.equal(view.worldHash, fingerprint(state), 'stale view; refresh before deciding')
      }
      const next = applyDecision(state, request)
      if (next !== state) await commit('decision', request, next)
      emit({ day: next.day, revision: next.revision, decision: next.decisions[request.id] }); return
    }
    case 'advance': {
      const { state } = await load()
      const targetDay = Number(args[0])
      const next = advanceWorld(state, targetDay)
      if (next !== state) await commit('advance', { targetDay }, next)
      emit(overview(next)); return
    }
    case 'checkpoint': {
      const checkpointId = label(args[0])
      const memory = await readFile(withinCase(args[1]), 'utf8')
      assert.ok(memory.length >= 80 && memory.length <= 50000, 'checkpoint requires an 80–50000 character memory note')
      const { state, journal } = await load()
      const file = resolve(output, 'checkpoints', `${checkpointId}.json`)
      assert.ok(!(await exists(file)), 'checkpoint ID already exists')
      const cp = { id: checkpointId, day: state.day, revision: state.revision, seedHash: state.seedHash,
        eventCount: journal.events.length, prefixHash: fingerprint(journal.raw), stateHash: fingerprint(state), memory }
      await save(file, { ...cp, seal: fingerprint(cp) })
      emit({ checkpointId, day: state.day, file }); return
    }
    case 'restore-check': {
      const cp = await readCheckpoint(args[0])
      const { state, journal } = await load()
      assert.ok(cp.eventCount <= journal.events.length)
      const prefix = journal.lines.slice(0, cp.eventCount).join('\n') + '\n'
      assert.equal(fingerprint(prefix), cp.prefixHash)
      const restored = replayWorld(seed, journal.events.slice(0, cp.eventCount))
      assert.equal(fingerprint(restored), cp.stateHash)
      const probe = { checkpointId: cp.id, checkpointSeal: cp.seal, stateHash: cp.stateHash,
        checkpointDay: cp.day, observedCurrentDay: state.day, valid: true }
      await save(resolve(output, 'recovery-checks', `${cp.id}.json`), probe)
      emit(probe); return
    }
    case 'audit': {
      let report
      try { const { state, journal } = await load(); report = await audit(state, journal) }
      catch (error) { report = { checks: { worldIntegrity: false }, mechanicallyComplete: false, error: error.message } }
      await save(resolve(output, 'audit.json'), report)
      emit(report)
      if (!report.mechanicallyComplete) process.exitCode = 1
      return
    }
    default: throw new Error('Unknown command; use node world.mjs help')
  }
}

if (command === 'help' || command === undefined) {
  console.log('init | overview | view <actor> | act <json> | advance <day> | checkpoint <id> <memory> | restore-check <id> | audit | unlock\nSee GUIDE.txt for action fields. No command chooses actor policies.')
} else {
  await mkdir(output, { recursive: true })
  for (const directory of ['views', 'checkpoints', 'recovery-checks']) await mkdir(resolve(output, directory), { recursive: true })
  const lockPath = resolve(output, 'writer.lock')
  if (command === 'unlock') {
    const owner = JSON.parse(await readFile(lockPath, 'utf8'))
    let alive = true
    try { process.kill(owner.pid, 0) }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error }
    assert.ok(!alive, 'lock owner is still alive; do not remove its lock')
    await unlink(lockPath)
    emit({ unlockedDeadPid: owner.pid })
  } else {
    let lock
    try {
      lock = await open(lockPath, 'wx')
      await lock.writeFile(JSON.stringify({ pid: process.pid }))
      await execute()
    } catch (error) {
      console.error(error.code === 'EEXIST' ? 'World writer is busy. Retry after it exits; use unlock only for a dead owner.' : error.message)
      process.exitCode = 1
    } finally {
      if (lock) { await lock.close(); await unlink(lockPath) }
    }
  }
}
