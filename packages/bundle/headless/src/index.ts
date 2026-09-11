/**
 * @clocky/clocky-headless — one-shot Team driver. The bundle patch rides over
 * clocky-base without Host, HTTP, or browser plugins; this runner creates a
 * Team, posts the task as human input, prints its explicit final, and exits.
 *
 * @module @clocky/clocky-headless
 */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/cordis-plugin-loader'
import type {} from '@clocky/clocky-cmdline'
import type {} from '@clocky/clocky-team-run'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core service required before the one-shot Team can start. */
export const inject = ['teamRuns']

/** Plugin config: the task resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
})

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Report an unexpected Team-run failure and request a failing exit. */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`clocky: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a newly created Team and request process exit.
 * @param ctx - plugin context carrying the Team-run and launcher IO services.
 * @param task - one-shot task text.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, task: string, io: HeadlessIo): Promise<void> {
  await ctx.get('loader')?.await()
  const teamRuns = ctx.get('teamRuns')
  if (teamRuns === undefined) return
  const team = await teamRuns.create({ objective: task, cwd: process.cwd() })
  await teamRuns.postHumanInput({ teamId: team.teamId, content: [{ type: 'text', text: task }], delivery: 'turn' })
  const final = await teamRuns.waitForFinal({ teamId: team.teamId })
  io.stdout.write(final.text + '\n')
  io.exit(0)
}

/**
 * Mount the one-shot Team driver.
 * @param ctx - plugin context carrying the Team-run service and launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config.task, io).catch((error: unknown) => { fail(io, error) })
}
