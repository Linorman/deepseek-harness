/** Keyless checks for the case referee; these do not simulate autonomous Agent business choices. */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createWorld, advanceWorld, applyDecision, actorView, assertWorld, fingerprint, replayWorld } from './engine.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(await readFile(resolve(root, 'seed.json'), 'utf8'))
const decision = (state, owner, actions, name = `d-${state.revision}`) => ({ id: name, actor: owner,
  viewId: 'environment-test-view', teamIdentity: 'environment-test-only',
  rationale: 'This test verifies referee mechanics without claiming autonomous Agent decisions.',
  observedRevision: state.revision, actions })
const act = (state, owner, actions, name) => applyDecision(state, decision(state, owner, actions, name))

test('transfers conserve owned assets and a rejected action array has no partial effects', () => {
  const before = createWorld(seed)
  const after = act(before, 'council', [{ kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 100 }])
  assert.equal(after.actors.council.cash, 4900)
  assert.equal(after.actors.clinic.cash, 400)
  assertWorld(after)
  const original = fingerprint(before)
  assert.throws(() => act(before, 'council', [
    { kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 100 },
    { kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 999999 },
  ]))
  assert.equal(fingerprint(before), original)
})

test('accepted trade reserves stock and escrow until real delivery settles exactly once', () => {
  let state = createWorld(seed)
  state = act(state, 'supplier', [{ kind: 'offer', id: 'food-a', to: 'coop', resource: 'food',
    quantity: 10, unitPrice: 5, leadDays: 0, expiresDay: 7 }])
  state = act(state, 'coop', [{ kind: 'accept', offerId: 'food-a' }])
  assert.equal(state.actors.coop.cash, 1750)
  assert.equal(state.orders['order-food-a'].escrow, 50)
  assert.throws(() => act(state, 'supplier', [{ kind: 'transfer', to: 'rival', resource: 'food', quantity: 241 }]))
  state = act(state, 'supplier', [{ kind: 'deliver', orderId: 'order-food-a' }])
  assert.equal(state.actors.coop.stocks.food, 60)
  assert.equal(state.actors.supplier.stocks.food, 240)
  assert.equal(state.orders['order-food-a'].phase, 'fulfilled')
  assert.equal(state.cashFlow.out, 4)
  assert.throws(() => act(state, 'supplier', [{ kind: 'deliver', orderId: 'order-food-a' }]))
  assertWorld(state)
})

test('overdue cancellation refunds escrow while preserving the failed responsibility', () => {
  let state = createWorld(seed)
  state = act(state, 'supplier', [{ kind: 'offer', id: 'food-b', to: 'coop', resource: 'food',
    quantity: 10, unitPrice: 5, leadDays: 0, expiresDay: 7 }])
  state = act(state, 'coop', [{ kind: 'accept', offerId: 'food-b' }])
  const amount = state.actors.coop.cash
  assert.throws(() => act(state, 'coop', [{ kind: 'cancel-order', orderId: 'order-food-b' }]))
  state = advanceWorld(state, 2)
  state = act(state, 'coop', [{ kind: 'cancel-order', orderId: 'order-food-b' }])
  assert.equal(state.orders['order-food-b'].phase, 'cancelled')
  assert.equal(state.orders['order-food-b'].breachedAt, 1)
  assert.equal(state.actors.coop.cash, amount - 20 + 50)
  assertWorld(state)
})

test('bilateral loans and funded new actors do not create cash or goods', () => {
  let state = createWorld(seed)
  state = act(state, 'council', [{ kind: 'loan-offer', id: 'bridge', to: 'coop', principal: 100, repayAmount: 110, dueDay: 30 }])
  state = act(state, 'coop', [{ kind: 'accept-loan', offerId: 'bridge' }])
  state = act(state, 'coop', [{ kind: 'repay', loanId: 'loan-bridge' }])
  assert.equal(state.loans['loan-bridge'].phase, 'fulfilled')
  assert.equal(state.actors.council.cash, 5010)
  state = act(state, 'mutual-aid', [{ kind: 'create-actor', id: 'new-group', name: 'New Group',
    actorKind: 'institution', purpose: 'A independently formed local group.', cash: 50,
    stocks: { food: 2, water: 3 }, dailyCost: 0 }])
  assert.equal(state.actors['mutual-aid'].cash, 150)
  assert.equal(state.actors['new-group'].cash, 50)
  assertWorld(state)
})

test('stale observations reject and exact decision retry cannot duplicate effects', () => {
  const initial = createWorld(seed)
  const request = decision(initial, 'council', [{ kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 100 }], 'one')
  const after = applyDecision(initial, request)
  assert.equal(applyDecision(after, request), after)
  assert.throws(() => applyDecision(after, { ...request, id: 'two' }), /stale/)
  assert.throws(() => applyDecision(after, { ...request, rationale: 'A changed decision under the same retained identity.' }), /payload changed/)
})

test('private messages and purposes remain actor-specific while organization consent is recorded', () => {
  let state = createWorld(seed)
  state = act(state, 'coop', [{ kind: 'message', to: ['clinic'], text: 'Private credit discussion', delayDays: 0, public: false },
    { kind: 'organization', id: 'network', name: 'Network', purpose: 'Negotiate common supplies' }])
  assert.equal(actorView(state, 'clinic').messages.length, 1)
  assert.equal(actorView(state, 'press').messages.length, 0)
  assert.ok(!JSON.stringify(actorView(state, 'press')).includes(state.actors.coop.privatePurpose))
  assert.deepEqual(Object.keys(state.organizations.network.members), ['coop'])
  state = act(state, 'clinic', [{ kind: 'join', organizationId: 'network', role: 'medical participant' }])
  assert.equal(state.organizations.network.members.clinic, 'medical participant')
})

test('a year of environment changes preserves conservation but does not fabricate actor decisions', () => {
  let state = createWorld(seed)
  while (state.day < 365) state = advanceWorld(state, Math.min(365, state.day + 7))
  assert.equal(state.day, 365)
  assert.equal(Object.keys(state.decisions).length, 0)
  assert.ok(state.notices.some(item => item.kind === 'season'))
  assert.ok(state.cashFlow.in > 0 && state.resourceFlow.food.in > 0)
  assertWorld(state)
})

test('event replay reconstructs the world and rejects an altered history fingerprint', () => {
  const initial = createWorld(seed)
  const request = decision(initial, 'council', [{ kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 100 }])
  const afterDecision = applyDecision(initial, request)
  const afterAdvance = advanceWorld(afterDecision, 7)
  const events = [
    { kind: 'init', revision: 0, day: 0, stateHash: fingerprint(initial) },
    { kind: 'decision', payload: request, revision: 1, day: 0, stateHash: fingerprint(afterDecision) },
    { kind: 'advance', payload: { targetDay: 7 }, revision: 2, day: 7, stateHash: fingerprint(afterAdvance) },
  ]
  assert.deepEqual(replayWorld(seed, events), afterAdvance)
  assert.throws(() => replayWorld(seed, [...events.slice(0, -1), { ...events.at(-1), stateHash: 'altered' }]))
})

test('the standalone CLI records exact views, reloads state and verifies a checkpoint in another process', async () => {
  await mkdir(resolve(root, 'output'), { recursive: true })
  const temporary = await mkdtemp(resolve(root, 'output/referee-test-'))
  try {
    const files = ['PROMPT.txt', 'START_HERE.txt', 'RULES.txt', 'GUIDE.txt', 'ACCEPTANCE.txt',
      'seed.json', 'engine.mjs', 'world.mjs', 'integrity.mjs', 'engine.test.mjs']
    const hashes = {}
    for (const file of files) {
      await copyFile(resolve(root, file), resolve(temporary, file))
      hashes[file] = createHash('sha256').update(await readFile(resolve(temporary, file))).digest('hex')
    }
    await writeFile(resolve(temporary, 'manifest.json'), JSON.stringify({ version: 1, files: hashes }))
    const call = (...args) => {
      const result = spawnSync(process.execPath, [resolve(temporary, 'world.mjs'), ...args], { cwd: temporary, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    }
    call('init')
    const observed = call('view', 'council')
    await writeFile(resolve(temporary, 'decision.json'), JSON.stringify({ id: 'cli-transfer', actor: 'council',
      viewId: observed.viewId, teamIdentity: 'referee-test-process', rationale: 'Testing one real persisted world transfer in a separate CLI process.',
      actions: [{ kind: 'transfer', to: 'clinic', resource: 'cash', quantity: 100 }] }))
    call('act', 'decision.json')
    call('act', 'decision.json')
    assert.equal(call('overview').revision, 1)
    call('advance', '7')
    await writeFile(resolve(temporary, 'memory.txt'), 'Test-only checkpoint memory: retain the exact transfer and its recipient, distinguish completed effects from open promises, and do not infer future outcomes.\n')
    call('checkpoint', 'week-one', 'memory.txt')
    const restored = call('restore-check', 'week-one')
    assert.equal(restored.valid, true)
    assert.equal(restored.checkpointDay, 7)
    const audit = spawnSync(process.execPath, [resolve(temporary, 'world.mjs'), 'audit'], { cwd: temporary, encoding: 'utf8' })
    assert.equal(audit.status, 1)
    const evidence = JSON.parse(audit.stdout)
    assert.equal(evidence.checks.worldIntegrity, true)
    assert.equal(evidence.checks.horizon, false)
    assert.equal(evidence.mechanicallyComplete, false)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
