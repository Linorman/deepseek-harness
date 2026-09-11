/** One-shot Team runner output, ordering, error, and launcher lifecycle. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { apply, Config, internals } from '../src/index.ts'

const TEAM_ID = 'team-1'
const originalInternals = { ...internals }

afterEach(() => { Object.assign(internals, originalInternals) })

interface CreateRequest {
  objective: string
  cwd: string
}

interface HumanInputRequest {
  teamId: string
  content: readonly [{ type: 'text'; text: string }]
  delivery: 'turn'
}

interface FinalWaitRequest {
  teamId: string
}

interface TeamRunScript {
  create?(request: CreateRequest): Promise<{ teamId: string }> | { teamId: string }
  postHumanInput?(request: HumanInputRequest): Promise<void> | void
  waitForFinal?(request: FinalWaitRequest): Promise<{ text: string }> | { text: string }
}

interface Calls {
  create: CreateRequest[]
  postHumanInput: HumanInputRequest[]
  waitForFinal: FinalWaitRequest[]
}

async function bench(script: TeamRunScript = {}): Promise<{
  ctx: Context
  run(): Promise<{ code: number; out: string; err: string; order: string[]; calls: Calls }>
}> {
  const ctx = new Context()
  const order: string[] = []
  const calls: Calls = { create: [], postHumanInput: [], waitForFinal: [] }
  const teamRuns = {
    async create(request: CreateRequest): Promise<{ teamId: string }> {
      order.push('create')
      calls.create.push(request)
      return await (script.create?.(request) ?? { teamId: TEAM_ID })
    },
    async postHumanInput(request: HumanInputRequest): Promise<unknown> {
      order.push('post')
      calls.postHumanInput.push(request)
      return await script.postHumanInput?.(request)
    },
    async waitForFinal(request: FinalWaitRequest): Promise<{ text: string }> {
      order.push('wait')
      calls.waitForFinal.push(request)
      return await (script.waitForFinal?.(request) ?? { text: 'final answer' })
    },
  }
  ctx.provide('teamRuns', teamRuns as never)
  return {
    ctx,
    run: async () => {
      let out = ''
      let err = ''
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, { task: 'do the thing' })
      return { code: await exited, out, err, order, calls }
    },
  }
}

describe('headless runner', () => {
  it('creates a Team, posts human input, waits for its explicit final, and exits after printing it', async () => {
    const test = await bench()
    const result = await test.run()
    expect(result).toEqual({
      code: 0,
      out: 'final answer\n',
      err: '',
      order: ['create', 'post', 'wait', 'exit'],
      calls: {
        create: [{ objective: 'do the thing', cwd: process.cwd() }],
        postHumanInput: [{ teamId: TEAM_ID, content: [{ type: 'text', text: 'do the thing' }], delivery: 'turn' }],
        waitForFinal: [{ teamId: TEAM_ID }],
      },
    })
    await test.ctx.fiber.dispose()
  })

  it('waits for an asynchronously available explicit final', async () => {
    const test = await bench({
      waitForFinal: async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return { text: 'race-free answer' }
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'race-free answer\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('reports a Team-run creation failure before it posts human input', async () => {
    const test = await bench({
      create: () => Promise.reject(new Error('a default provider and model are required to activate the Team coordinator')),
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '',
      err: 'clocky: a default provider and model are required to activate the Team coordinator\n',
      order: ['create', 'exit'],
      calls: { create: [{ objective: 'do the thing', cwd: process.cwd() }], postHumanInput: [], waitForFinal: [] },
    })
    await test.ctx.fiber.dispose()
  })

  it('stringifies a non-Error Team-run failure', async () => {
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('final delivery failed')
      },
    }
    const test = await bench({
      waitForFinal: () => rejected as never,
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '',
      err: 'clocky: final delivery failed\n',
      order: ['create', 'post', 'wait', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    const services = ctx.plugin((child: Context) => {
      child.provide('teamRuns', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx, { task: 't' })
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', async () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { task: 't' }) }).toThrow('must provide ctx.appExit')
    await ctx.fiber.dispose()
  })

  it('validates config: the task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    expect(new Config({ task: 'x' })).toEqual({ task: 'x' })
  })
})
