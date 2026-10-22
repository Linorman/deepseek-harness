import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const project = resolve('.'), root = resolve('.local/world-completion/c15-external-actor')
const hash = async path => ({ path: relative(project, resolve(path)),
  sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const owned = ['packages/simulation/simulation-world/src/external-actor.ts',
  'examples/simulation-company/tests/world-external-actor-model.ts',
  'examples/simulation-company/tests/world-external-actor-scenario.ts',
  'examples/simulation-company/tests/world-external-actor.snapshot.ts',
  'examples/simulation-company/tests/fixtures/world-external-actor/cordis.yml']
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'tests', 'test'].includes(entry.name)) continue
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) result.push(...await files(child))
    else if (entry.isFile()) result.push(child)
  }
  return result
}
const sourceFiles = (await files('packages')).filter(path => path.includes('/src/') && /\.(ts|tsx|json)$/.test(path)).sort()
const libraries = (await files('packages')).filter(path => path.includes('/lib/') && path.endsWith('.js')).sort()
const inputs = { owned: await Promise.all(owned.map(hash)),
  sources: await Promise.all(sourceFiles.map(hash)), libraries: await Promise.all(libraries.map(hash)) }
if (process.argv.includes('--capture')) {
  await writeFile(resolve(root, 'final-input-hashes.json'), JSON.stringify(inputs, null, 2) + '\n')
  console.log(JSON.stringify({ owned: inputs.owned.length, sources: inputs.sources.length, libraries: inputs.libraries.length }))
  process.exit(0)
}
assert.deepEqual(inputs, await readJson(resolve(root, 'final-input-hashes.json')), 'Source and compiled inputs must stay frozen during final verification')
const matrix = [], artifacts = []
for (const mode of ['source', 'lib']) {
  const log = resolve(root, `${mode}-snapshot-final.log`)
  const text = await readFile(log, 'utf8')
  assert.match(text, /Tests\s+4 passed \(4\)/)
  artifacts.push(await hash(log))
  for (const scene of ['company', 'laboratory']) for (const backend of ['json', 'sqlite']) {
    const prefix = `${mode}-${scene}-${backend}`, paths = {}
    for (const name of ['original', 'input', 'session', 'model-inputs']) {
      paths[name] = resolve(root, `${prefix}-${name}.json`)
      artifacts.push(await hash(paths[name]))
    }
    const proof = await readJson(paths.original), input = await readJson(paths.input)
    const session = await readJson(paths.session), models = await readJson(paths['model-inputs'])
    const values = Object.values(proof.external.representatives)
    assert.equal(values.length, 1)
    const representative = values[0], entity = proof.representative
    assert.equal(representative.status, 'committed')
    assert.equal(entity.id, representative.identities.entityId)
    assert.equal(entity.readiness, 'ready')
    assert.equal(entity.cognition, 'agent')
    assert.deepEqual(entity.binding, representative.identities.binding)
    assert.equal(proof.represents.subject, entity.id)
    assert.equal(proof.represents.object, Object.values(proof.external.identities)[0].subjectRef)
    assert.equal(proof.represents.relation, 'represents')
    const persona = entity.profile.persona
    const allowedTemplate = input.world.templates.find(value => value.names.includes(persona.name)
      && ['skills', 'traits', 'goals'].every(key => persona[key].every(item => value[key].includes(item))))
    assert.ok(allowedTemplate)
    assert.deepEqual(entity.profile, { name: persona.name, description: allowedTemplate.description, persona })
    const originalSubject = input.entities.find(value => value.id === proof.represents.object)
    assert.equal(originalSubject.cognition, 'none')
    const contexts = session.filter(value => value.type === 'simulation/context-view')
    assert.equal(contexts.length, 1)
    const identity = JSON.parse(contexts[0].data.content.find(value => value.kind === 'identity').blocks[0].text)
    assert.deepEqual(identity, { entityId: entity.id, persona: entity.profile,
      organization: { name: originalSubject.profile.name, description: originalSubject.profile.description } })
    const background = JSON.parse(contexts[0].data.content.find(value => value.kind === 'input').blocks
      .find(value => value.type === 'text' && value.text.includes('world-background')).text)
    assert.equal(background.worldFacts.viewer, entity.id)
    assert.deepEqual(background.worldFacts.items, [])
    const incoming = session.filter(value => value.type === 'user/message' && value.data.source?.kind === 'team-envelope')
    assert.equal(incoming.length, 1)
    assert.equal(incoming[0].data.source.channelId, representative.identities.channels[1].channelId)
    const representativeModels = models.filter(value => value.entityId === entity.id)
    assert.equal(representativeModels.length, 3)
    for (const canary of ['PRIVATE-BUYER-FLOOR', 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE']) {
      assert.equal(JSON.stringify(session).includes(canary), false)
      assert.equal(JSON.stringify(representativeModels).includes(canary), false)
      assert.equal(JSON.stringify(proof.results).includes(canary), false)
    }
    assert.equal(models.some(value => value.entityId !== entity.id && value.input.includes('PRIVATE-BUYER-FLOOR')), true)
    assert.equal(proof.canonicalPosts.length, 3)
    const canonical = proof.canonicalPosts.map(value => {
      const post = proof.posts.find(post => post.id === value.operationId)
      assert.ok(post)
      assert.equal(value.accepted.type, 'channel/envelope')
      assert.equal(value.accepted.envelope.id, post.outbox.receipt.envelopeId)
      assert.equal(value.accepted.envelope.sequence, post.outbox.receipt.sequence)
      assert.equal(value.received.type, 'user/message')
      assert.equal(value.received.data.source.kind, 'team-envelope')
      assert.equal(value.received.data.source.envelopeId, value.accepted.envelope.id)
      assert.equal(value.received.data.source.senderId, value.accepted.envelope.senderId)
      assert.equal(value.received.data.source.channelId, value.accepted.envelope.channelId)
      assert.equal(post.delivery.receipt.envelopeId, value.accepted.envelope.id)
      return { operationId: post.id, sourceEntityId: post.entityId, recipientEntityId: post.action.recipient,
        channelId: value.accepted.envelope.channelId, envelopeId: value.accepted.envelope.id,
        canonicalSenderId: value.accepted.envelope.senderId, receivedSessionEventSequence: value.received.seq }
    })
    const independentReply = proof.posts.find(post => post.entityId === entity.id)
    assert.ok(independentReply)
    assert.equal(independentReply.action.kind, 'communication/post')
    assert.equal(independentReply.action.text, 'I represent the supplier. I received your inquiry about widget.')
    const processes = []
    for (const round of [0, 1, 2]) {
      const path = resolve(root, `${prefix}-process-${round}.json`), process = await readJson(path)
      artifacts.push(await hash(path))
      assert.equal(process.exitCode, 0)
      assert.equal(process.signal, null)
      const result = JSON.parse(process.stdout)
      assert.equal(result.phase, 'paused')
      assert.equal(result.modelCalls, round === 0 ? 15 : 0)
      assert.equal(result.canonicalSenders, 3)
      assert.equal(result.preparingDenied, true)
      assert.equal(result.privateInputsExcluded, true)
      assert.equal(result.checkpointComplete, true)
      assert.equal(process.args.includes('--import'), mode === 'source')
      processes.push({ evidence: relative(project, path), pid: process.pid, command: process.command, args: process.args,
        exitCode: process.exitCode, signal: process.signal, result })
    }
    matrix.push({ mode, scene, backend, independentSessionId: entity.binding.sessionId,
      identityId: representative.identityId, representativeEntityId: entity.id, canonical,
      facts: { personaEqualsOriginalAcceptedProfile: true, subjectCognition: originalSubject.cognition,
        approvedTemplateId: allowedTemplate.id, approvedTemplateVersion: allowedTemplate.version,
        permittedFactCount: background.worldFacts.items.length, newChannelInputs: incoming.length,
        representativeModelCalls: representativeModels.length, originalResourceAccounts: Object.keys(proof.resources).length,
        existingCommitments: Object.keys(proof.commitments).length },
      evidence: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, relative(project, path)])), processes })
  }
}
const reportPath = resolve(root, 'verification-report.json')
const createdAt = (await readdir(root)).includes('verification-report.json')
  ? (await readJson(reportPath)).createdAt : new Date().toISOString()
const report = { format: 'c15.external-actor-verification/1', createdAt, cwd: project,
  commands: [
    { mode: 'source', command: 'pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-actor.snapshot.ts',
      log: '.local/world-completion/c15-external-actor/source-snapshot-final.log', tests: 4 },
    { mode: 'lib', command: 'CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-actor.snapshot.ts',
      log: '.local/world-completion/c15-external-actor/lib-snapshot-final.log', tests: 4 } ],
  inputs, artifactHashes: artifacts, matrix,
  totals: { cases: matrix.length, processes: matrix.reduce((sum, value) => sum + value.processes.length, 0),
    coldRestoresWithoutInference: matrix.length * 2, canonicalPosts: matrix.length * 3,
    rawArtifacts: matrix.length * 7, logArtifacts: 2, hashedArtifacts: artifacts.length },
  scope: { X06: 'Actual noncognitive original subject, independent Person/Participant/Session and represents; 3 nonempty resource accounts preserved. Existing commitments are empty, so nonempty supplier-contract inheritance is not proved by this fixture.',
    X07: 'Real maintained preparing rejects connection activation by readiness and direct controller by exact active-maintenance admission. Native committed representation/ready/result and requester interaction wake are covered by the root Native test; the representative starts from the later actual Channel receipt, with no synthetic first-action wake.',
    X08: 'Exact permitted Persona/profile and external public subject, empty authorized fact projection, sole new requester Channel input, independent persisted Session and actual model requests; both private canaries excluded from Session, recorded context, representative inference inputs and public results.',
    X09: 'Three actual accepted ChannelEnvelopeRecord and recipient Session message source/body pairs; independent representative ordinary communication. Fixture also rejects sender fields for original subject/representative/director before Native append.',
    X11: 'Account creation or source/sink capability is not implemented. The contact path preserves its 3 original nonempty accounts; this does not prove installed grant/source/sink accounting.' },
  deferred: ['X03 director-mediated adjudication is not implemented by the actor contact path.',
    'X04 authoritative inventory/contract/fact adjudication and report-only offers remain pending.',
    'X05 concurrent same-key caller reuse/waiting is not implemented; Native refuses a second representative.',
    'X10 complete auxiliary-model/expansion quota fault matrix is not proved by this fixture.',
    'X12 preparation/unknown IO/cancellation and all crash boundaries are not implemented or covered by completed-checkpoint cold restore.'],
  checkboxChanges: false }
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ report: '.local/world-completion/c15-external-actor/verification-report.json', totals: report.totals,
  inputs: { owned: inputs.owned.length, sources: inputs.sources.length, libraries: inputs.libraries.length } }))
