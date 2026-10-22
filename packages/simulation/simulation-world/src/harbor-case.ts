/** Original CLI execution and idempotent receipts for a private, unchanged copy of the Harbor case. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { SimulationWorldJsonValue } from '@clocky/clocky-simulation'
import { harborAuditSchema, harborResultSchema } from './harbor-protocol.ts'
import type { HarborCommand, HarborResult } from './harbor-protocol.ts'

const executeFile = promisify(execFile)
const manifestSchema = z.strictObject({ version: z.literal(1),
  files: z.record(z.string().regex(/^[a-zA-Z0-9_.-]+$/), z.string().regex(/^[a-f0-9]{64}$/)) })
const overviewSchema = z.object({ day: z.number().int().min(0).max(365), revision: z.number().int().nonnegative() })
const viewSchema = overviewSchema.extend({ actor: z.string(), viewId: z.string().regex(/^view-[a-f0-9]{64}$/) })

/** Stable filename component; never interpolate a model value into a command or path.
 * @param value - Original canonical identity.
 * @returns SHA-256 hexadecimal filename component. */
export function harborHash(value: string): string { return createHash('sha256').update(value).digest('hex') }

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    // Absence means the original operation has not published a receipt; other IO failures remain unknown.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function save(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

/** Project only the public fields declared by the adapter, preserving the original judge's verdict. */
function auditReceipt(raw: unknown): z.infer<typeof harborAuditSchema> {
  const error = z.object({ checks: z.object({ worldIntegrity: z.literal(false) }), error: z.string() }).safeParse(raw)
  if (error.success) return { kind: 'error', message: error.data.error.slice(0, 4000) }
  const report = harborAuditSchema.options[1]
  const shape = report.shape
  const parsed = report.omit({ kind: true }).strip().extend({
    balances: shape.balances.strip(),
    openOrders: z.array(shape.openOrders.element.strip().extend({ breachedAt: z.number().int().nonnegative().nullable().default(null) })),
    openLoans: z.array(shape.openLoans.element.strip().extend({ breachedAt: z.number().int().nonnegative().nullable().default(null) })),
  }).parse(raw)
  return harborAuditSchema.parse({ kind: 'report', ...parsed })
}

function publicReceipt(command: HarborCommand, raw: unknown, ok: boolean): HarborResult['receipt'] {
  const receipt: HarborResult['receipt'] = { error: null, decisionId: null, checkpointId: null, checkpointDay: null,
    restored: null, audit: null, report: null, wakeActors: [] }
  if (!ok) {
    receipt.error = z.object({ error: z.string() }).parse(raw).error
    if (command.kind === 'finish') receipt.audit = auditReceipt(z.object({ audit: z.unknown() }).parse(raw).audit)
    return receipt
  }
  switch (command.kind) {
    case 'act': receipt.decisionId = z.object({ decision: z.object({ id: z.string() }) }).parse(raw).decision.id; break
    case 'checkpoint': {
      const checkpoint = z.object({ checkpointId: z.string(), day: z.number() }).parse(raw)
      receipt.checkpointId = checkpoint.checkpointId; receipt.checkpointDay = checkpoint.day
      break
    }
    case 'restore-check': {
      const restored = z.object({ checkpointId: z.string(), checkpointDay: z.number(), valid: z.boolean() }).parse(raw)
      receipt.checkpointId = restored.checkpointId; receipt.checkpointDay = restored.checkpointDay; receipt.restored = restored.valid
      break
    }
    case 'wake': receipt.wakeActors = command.actors; break
    case 'audit': receipt.audit = auditReceipt(raw); break
    case 'finish':
      receipt.report = 'output/final-report.md'
      receipt.audit = auditReceipt(z.object({ audit: z.unknown() }).parse(raw).audit)
      break
    case 'advance': break
    default: assertNever(command)
  }
  return harborResultSchema.shape.receipt.parse(receipt)
}

/** One run owns one interpreter directory; the Native callback owner serializes its commands. */
export class HarborCase {
  /** Private copy and journal directory for the original run. */
  readonly directory: string
  private prepared: Promise<void> | undefined

  /** @param source - Trusted original case directory.
   * @param root - Private run storage root.
   * @param runId - Native-assigned run identity.
   * @param signal - Owning execution lifetime.
   * @param requireExisting - Retained Native observations forbid silently replacing a missing case with a fresh world. */
  constructor(private readonly source: string, root: string, runId: string, private readonly signal: AbortSignal,
    private readonly requireExisting = false) {
    this.directory = join(resolve(root), harborHash(runId))
  }

  /** Verify every original source before creating or reopening an isolated case. */
  ready(): Promise<void> {
    this.prepared ??= this.prepare()
    return this.prepared
  }

  private async prepare(): Promise<void> {
    const raw = await readFile(join(this.source, 'manifest.json'), 'utf8')
    if (harborHash(raw) !== 'fe07e4c2b255468d111711fff3011d94300b9ba90d65f18b3c84183f38f8b4d7')
      throw new Error('Harbor source is not the original pinned case')
    const manifest = manifestSchema.parse(JSON.parse(raw))
    if (this.requireExisting && await readOptional(join(this.directory, 'output', 'journal.jsonl')) === undefined)
      throw new Error('The original Harbor journal is missing; refusing to create a replacement world')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (const [file, hash] of Object.entries(manifest.files)) {
      const original = await readFile(join(this.source, file), 'utf8')
      if (harborHash(original) !== hash) throw new Error(`Harbor source integrity failed: ${file}`)
      const path = join(this.directory, file), retained = await readOptional(path)
      if (retained === undefined) await writeFile(path, original, { flag: 'wx', mode: 0o600 })
      else if (harborHash(retained) !== hash) throw new Error(`Harbor retained source integrity failed: ${file}`)
    }
    const target = join(this.directory, 'manifest.json'), retained = await readOptional(target)
    if (retained === undefined) await writeFile(target, raw, { flag: 'wx', mode: 0o600 })
    else if (retained !== raw) throw new Error('Harbor original manifest changed')
    await mkdir(join(this.directory, '.bridge'), { recursive: true, mode: 0o700 })
    if (await readOptional(join(this.directory, 'output', 'writer.lock')) !== undefined) await this.cli('unlock')
    await this.cli('init')
  }

  private async cli(...args: string[]): Promise<SimulationWorldJsonValue> {
    let stdout: string
    try {
      ;({ stdout } = await executeFile(process.execPath, [join(this.directory, 'world.mjs'), ...args], {
        cwd: this.directory, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
        signal: this.signal, timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      }))
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: unknown }
      // The original audit deliberately exits one for an incomplete experiment while returning its actual report.
      if (args[0] !== 'audit' || failure.code !== 1 || typeof failure.stdout !== 'string') throw error
      const report: unknown = JSON.parse(failure.stdout)
      z.object({ mechanicallyComplete: z.literal(false), checks: z.object({ worldIntegrity: z.boolean() }) }).parse(report)
      return z.json().parse(report)
    }
    return z.json().parse(JSON.parse(stdout))
  }

  /** Public revision probe performs no model call and creates no business action.
   * @returns current original day and revision. */
  async overview(): Promise<{ day: number; revision: number }> {
    await this.ready()
    return overviewSchema.parse(await this.cli('overview'))
  }

  /** Read and retain the exact current view of one actor, without exposing the seed or another actor's private state.
   * @param actor - Case identity whose authority is validated by the caller.
   * @returns current role view including its revision-specific view identity. */
  async view(actor: string): Promise<SimulationWorldJsonValue> {
    await this.ready()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_:/-]{0,99}$/.test(actor)) throw new Error('Harbor view has an invalid actor')
    const value = await this.cli('view', actor)
    if (viewSchema.parse(value).actor !== actor) throw new Error('Harbor view returned another actor')
    return value
  }

  /** Current public overview, without private accounts or motivations.
   * @returns public facts and bounded delivered public messages. */
  async publicOverview(): Promise<SimulationWorldJsonValue> {
    await this.ready()
    const value = await this.cli('overview')
    const publicState = overviewSchema.parse(value)
    const observed = z.object({ day: z.number(), revision: z.number(), viewId: z.string(),
      messages: z.array(z.object({ id: z.string(), sender: z.string(), text: z.string(), public: z.boolean(),
        createdDay: z.number(), deliverDay: z.number(), decisionId: z.string() })) }).parse(await this.view('press'))
    if (observed.day !== publicState.day || observed.revision !== publicState.revision)
      throw new Error('Harbor public messages crossed a concurrent case revision')
    return { ...z.record(z.string(), z.json()).parse(value),
      publicMessages: observed.messages.filter(message => message.public && message.deliverDay <= publicState.day),
      publicMessagesCoverage: 'Delivered public subset of the original bounded 60-day/100-message view; not complete history.',
      publicMessageSourceView: observed.viewId }
  }

  /** Read only the original case instructions; the seed and acceptance rubric never enter model context.
   * @returns original task, rules and command guide. */
  async instructions(): Promise<{ prompt: string; rules: string; guide: string }> {
    await this.ready()
    const [prompt, rules, guide] = await Promise.all([
      readFile(join(this.directory, 'PROMPT.txt'), 'utf8'),
      readFile(join(this.directory, 'RULES.txt'), 'utf8'),
      readFile(join(this.directory, 'GUIDE.txt'), 'utf8'),
    ])
    return { prompt, rules, guide }
  }

  /**
   * Read an existing exact receipt without initializing, unlocking or executing the judge.
   * @param key - Original Native intent identity.
   * @param actor - Original case actor.
   * @param teamIdentity - Host-bound original Team/Session identity.
   * @param command - Original strictly parsed command.
   * @returns validated recorded outcome, or undefined when execution remains unproven.
   */
  async recordedResult(key: string, actor: string, teamIdentity: string, command: HarborCommand): Promise<HarborResult | undefined> {
    this.signal.throwIfAborted()
    const journal = await stat(join(this.directory, 'output', 'journal.jsonl')).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    })
    if (journal === undefined || !journal.isFile()) throw new Error('The original Harbor journal is missing during reconciliation')
    const manifest = await readFile(join(this.directory, 'manifest.json'), 'utf8')
    if (harborHash(manifest) !== 'fe07e4c2b255468d111711fff3011d94300b9ba90d65f18b3c84183f38f8b4d7')
      throw new Error('Harbor retained source manifest changed during reconciliation')
    const id = harborHash(key), input = await readOptional(join(this.directory, '.bridge', `${id}.input.json`))
    if (input !== undefined && input !== JSON.stringify({ actor, teamIdentity, command }))
      throw new Error('Harbor command identity changed its original input')
    const result = await readOptional(join(this.directory, '.bridge', `${id}.result.json`))
    if (result === undefined) return undefined
    if (input === undefined) throw new Error('Harbor receipt has no original input identity')
    return harborResultSchema.parse(JSON.parse(result))
  }

  /** Execute an exact accepted command, recovering its original receipt after a repeated callback.
   * @param key - Native intent identity.
   * @param actor - Native requester identity.
   * @param teamIdentity - Canonical Team/Session attribution, never model text.
   * @param command - Strictly parsed original request.
   * @param authorize - Optional live Native guard, rechecked immediately before each new judge mutation.
   * @returns retained public outcome; unknown IO rejects. */
  async execute(key: string, actor: string, teamIdentity: string, command: HarborCommand,
    authorize: () => void = () => {}): Promise<HarborResult> {
    await this.ready()
    const id = harborHash(key), receiptPath = join(this.directory, '.bridge', `${id}.result.json`)
    const input = JSON.stringify({ actor, teamIdentity, command })
    const inputPath = join(this.directory, '.bridge', `${id}.input.json`), priorInput = await readOptional(inputPath)
    if (priorInput !== undefined && priorInput !== input) throw new Error('Harbor command identity changed its original input')
    if (priorInput === undefined) await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 })
    const priorResult = await readOptional(receiptPath)
    if (priorResult !== undefined) return harborResultSchema.parse(JSON.parse(priorResult))
    const before = await this.overview()
    const dispatch = (...args: string[]) => { authorize(); return this.cli(...args) }
    let ok = true, receipt: SimulationWorldJsonValue
    switch (command.kind) {
      case 'act': {
        const file = `.bridge/${id}.decision.json`
        const decision = { id: `decision-${id}`, actor, teamIdentity, viewId: command.viewId,
          rationale: command.rationale, actions: command.actions }
        await save(join(this.directory, file), JSON.stringify(decision))
        try { receipt = await dispatch('act', file) }
        catch (error) {
          const failure = error as { code?: unknown; stderr?: unknown }
          // A normal CLI rejection with an unchanged authoritative revision proves that no case action committed.
          if (failure.code !== 1 || (await this.overview()).revision !== before.revision) throw error
          ok = false
          receipt = { error: typeof failure.stderr === 'string' ? failure.stderr.trim().slice(0, 2000) : 'Case rejected the decision' }
        }
        break
      }
      case 'advance':
        if (command.day < before.day || command.day - before.day > 7) {
          ok = false; receipt = { error: 'Advance must move from the current day by at most seven days.' }
        } else receipt = await dispatch('advance', String(command.day))
        break
      case 'wake': receipt = { actors: command.actors, reason: command.reason }; break
      case 'checkpoint': {
        const checkpointId = `cp-${id}`, memoryFile = `.bridge/${id}.memory.txt`
        const retained = await readOptional(join(this.directory, 'output', 'checkpoints', `${checkpointId}.json`))
        if (retained !== undefined) {
          const checkpoint = z.object({ memory: z.string(), day: z.number() }).parse(JSON.parse(retained))
          if (checkpoint.memory !== command.memory) throw new Error('Harbor checkpoint retry changed its memory')
          await this.cli('restore-check', checkpointId)
          receipt = { checkpointId, day: checkpoint.day, file: `output/checkpoints/${checkpointId}.json` }
        } else {
          await save(join(this.directory, memoryFile), command.memory)
          receipt = await dispatch('checkpoint', checkpointId, memoryFile)
        }
        break
      }
      case 'restore-check': receipt = await this.cli('restore-check', command.checkpointId); break
      case 'audit': receipt = await this.cli('audit'); break
      case 'finish': {
        const audit = await this.cli('audit')
        if (!z.object({ mechanicallyComplete: z.boolean() }).parse(audit).mechanicallyComplete) {
          ok = false; receipt = { error: 'The original case audit is not complete.', audit }
        } else {
          authorize()
          await save(join(this.directory, 'output', 'final-report.md'), command.report)
          receipt = { report: 'output/final-report.md', audit }
        }
        break
      }
      default: return assertNever(command)
    }
    const result = harborResultSchema.parse({ ok, command: command.kind, day: (await this.overview()).day,
      receipt: publicReceipt(command, receipt, ok) })
    await save(receiptPath, JSON.stringify(result))
    return result
  }
}

function assertNever(value: never): never { throw new Error(`Unknown Harbor command: ${String(value)}`) }
