import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import type {} from '@clocky/clocky-skill'
import { SessionId } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-agent-presets'
import { discoverBaselineInstructionFiles } from '@clocky/clocky-agent-instructions'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

async function writeSkill(root: string, name: string): Promise<void> {
  const bundle = join(root, name)
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---
name: ${name}
description: Must not enter the Web replay scaffold
---

Ambient host state.
`)
}

it('isolates replay skill discovery from every ambient host root', async () => {
  const ambient = await mkdtemp(join(tmpdir(), 'clocky-web-ambient-skills-'))
  const clockyHome = join(ambient, 'clocky-home')
  const agentsHome = join(ambient, 'agents-home')
  const bundled = join(ambient, 'bundled')
  await Promise.all([
    writeSkill(join(clockyHome, 'skills'), 'ambient-clocky'),
    writeSkill(join(agentsHome, 'skills'), 'ambient-agents'),
    writeSkill(bundled, 'ambient-bundled'),
    writeSkill(join(ambient, '.agents/skills'), 'ambient-project'),
    mkdir(join(ambient, '.git')),
    writeFile(join(ambient, 'AGENTS.md'), 'Enclosing checkout instructions must not enter replay.\n'),
  ])

  const originalClockyHome = process.env.CLOCKY_HOME
  const originalAgentsHome = process.env.CLOCKY_AGENTS_HOME
  const originalBundled = process.env.CLOCKY_BUNDLED_SKILL_DIR
  const temporaryKeys = ['TMPDIR', 'TMP', 'TEMP'] as const
  const originalTemporaryEnvironment = Object.fromEntries(temporaryKeys.map(key => [key, process.env[key]]))
  for (const key of temporaryKeys) process.env[key] = ambient
  process.env.CLOCKY_HOME = clockyHome
  process.env.CLOCKY_AGENTS_HOME = agentsHome
  process.env.CLOCKY_BUNDLED_SKILL_DIR = bundled
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    expect(dirname(scaffold.workspaceCwd)).toBe(await realpath(ambient))
    const ctx = scaffold.ctx
    // Local skill discovery belongs to the agent's preset LAYER of the host
    // registry, so the roots under test are only reachable through a composed
    // agent's view — the same scope the gateway's `skill.list` resolves for a
    // browser request about a session.
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-skills'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const names = (await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent })).map(skill => skill.name)
      expect(names).not.toContain('ambient-clocky')
      expect(names).not.toContain('ambient-agents')
      expect(names).not.toContain('ambient-bundled')
      expect(names).not.toContain('ambient-project')
      expect(await discoverBaselineInstructionFiles({ cwd: scaffold.workspaceCwd, clockyHome: scaffold.harnessHome })).toEqual([])
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      if (originalClockyHome === undefined) delete process.env.CLOCKY_HOME
      else process.env.CLOCKY_HOME = originalClockyHome
      if (originalAgentsHome === undefined) delete process.env.CLOCKY_AGENTS_HOME
      else process.env.CLOCKY_AGENTS_HOME = originalAgentsHome
      if (originalBundled === undefined) delete process.env.CLOCKY_BUNDLED_SKILL_DIR
      else process.env.CLOCKY_BUNDLED_SKILL_DIR = originalBundled
      for (const key of temporaryKeys) {
        const value = originalTemporaryEnvironment[key]
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      await rm(ambient, { recursive: true, force: true })
    }
  }
})

it('keeps each Host authenticated while a second Host shares its settings home', async () => {
  const first = await launchWebScaffold()
  let second: WebScaffold | undefined
  try {
    expect((await first.authenticatedRpc('settings.describe', {})).result.ok).toBe(true)
    second = await launchWebScaffold({ harnessHome: first.harnessHome })
    expect((await second.authenticatedRpc('settings.describe', {})).result.ok).toBe(true)
    await second.close()
    second = undefined
    expect((await first.authenticatedRpc('settings.mutate', {
      ns: 'ui-conversation', expectedRevision: 0,
      ops: [{ op: 'set', path: ['busyEnter'], value: 'steer' }],
    })).result.ok).toBe(true)
  } finally {
    try { await second?.close() } finally { await first.close() }
  }
})
