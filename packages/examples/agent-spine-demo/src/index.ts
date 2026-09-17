/**
 * Default executor-less, UI-less agent spine. It bundles the common services,
 * background-job registry and controls, concrete loop, local skill and
 * agent-instructions providers, and model-facing shell/skill consumers;
 * deployments still choose the LLM adapter, bash executor, and presentation.
 * The plugin intentionally exposes named exports only because Loader default
 * unwrapping would discard its `Config` schema (see docs/postmortem/0001).
 * @module @clocky/clocky-agent-spine-demo
 */

import type { Context } from '@clocky/cordis'
import Timer from '@clocky/cordis-plugin-timer'
import z from '@clocky/schemastery'
import LlmRuntime from '@clocky/clocky-llm'
import SessionStore from '@clocky/clocky-session'
import SessionTitleService, { type Config as SessionTitleConfig } from '@clocky/clocky-session-title'
import SystemPrompt, { type Config as SystemPromptConfig } from '@clocky/clocky-system-prompt'
import ToolRuntime, { type Config as ToolsConfig } from '@clocky/clocky-tools'
import SkillRegistry, { type Config as SkillRegistryConfig } from '@clocky/clocky-skill'
import * as SkillFileSystem from '@clocky/clocky-skill-filesystem'
import AgentRegistry from '@clocky/clocky-agent'
import LocalJobRegistry, { type Config as JobsConfig } from '@clocky/clocky-jobs-local'
import InvariantRegistry, { type Config as InvariantConfig } from '@clocky/clocky-invariants'
import * as sessionInvariant from '@clocky/clocky-session/invariant'
import * as agentInvariant from '@clocky/clocky-agent/invariant'
import * as scopeInvariant from '@clocky/clocky-scope/invariant'
import * as agentLoopInvariant from '@clocky/clocky-agent-loop/invariant'
import * as toolBash from '@clocky/clocky-tool-bash'
import * as bashEnv from '@clocky/clocky-shell-env'
import * as workspaceContext from '@clocky/clocky-agent-instructions'
import * as toolSkill from '@clocky/clocky-tool-skill'
import * as toolJobs from '@clocky/clocky-tool-jobs'
import AgentLoop, { type Config as AgentLoopConfig } from '@clocky/clocky-agent-loop'
import * as llmRetry from '@clocky/clocky-llm-retry'
import { resolveClockyHome } from '@clocky/clocky-home-paths'

export const name = 'agent-spine-demo'

/** Overridable example policy used when a bundle consumer omits `sessionTitle`. */
const EXAMPLE_SESSION_TITLE_CONFIG: SessionTitleConfig = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
}

/** Skill bundle config forwarded to the registry, local provider, and model-facing consumer. */
export interface SkillConfig {
  /** Mount the bundled local skill provider and model-facing skill tool (default true). */
  enabled?: boolean
  /** Registry-level discovery cache settings. */
  registry?: SkillRegistryConfig
  /** Local filesystem skill provider settings. */
  filesystem?: SkillFileSystem.Config
  /** Model-facing skill catalog and tool settings. */
  tool?: toolSkill.Config
}

/**
 * Bundle config: each field forwarded verbatim to the child that owns it —
 * `agents` to the agent loop (an app that pre-creates no agents, like the ACP
 * bridge, simply omits it), `includeHarnessIdentity`, `includeRuntimeContext`,
 * `persona`, and `toolOrder` to the system-prompt plugin (the fixed opener,
 * dynamic-context policy, deployment persona, and explicit model-facing tool
 * order), the `tools` object to the tool registry (its presentation `mode`),
 * `clockyHome` to bash environment and local skill discovery, `sessionTitle` to
 * the fallback title service, `skills` to the
 * skill registry/local provider/tool consumer, `workspaceContext` to the
 * agent-instructions loader, `jobs` to the process-local job provider, and
 * `toolBash`/`toolJobs` to the model-facing tool plugins this bundle owns.
 * Provider adapters own their `retryPolicy`; this bundle always mounts its
 * executor.
 * `invariants` configures global and package-filtered
 * relational checks. Owner schemas supply defaults for optional input;
 * workspace context instead requires an explicit byte budget or `false` because
 * it changes model-visible input. Producer opt-in stays producer-local:
 * `toolBash` configures bash only; independently composed producers keep their
 * own config. Set `toolBash: false` when another plugin owns the model-facing
 * `bash` name.
 */
export interface Config {
  /** The agent-loop `agents` list (see clocky-agent-loop's `Config`). */
  agents?: AgentLoopConfig['agents']
  /** Agent-loop concurrency cap; `1` is serial. */
  maxParallelToolCalls?: AgentLoopConfig['maxParallelToolCalls']
  /** Whether the system prompt includes the fixed Harness identity (default true). */
  includeHarnessIdentity?: SystemPromptConfig['includeHarnessIdentity']
  /** Whether model history includes dynamic runtime-context snapshots (default true). */
  includeRuntimeContext?: SystemPromptConfig['includeRuntimeContext']
  /** The deployment persona (see clocky-system-prompt's `Config`). */
  persona?: SystemPromptConfig['persona']
  /** The explicit model-facing tool order (see clocky-system-prompt's `Config`). */
  toolOrder?: SystemPromptConfig['toolOrder']
  /** The tool registry's config — its presentation `mode` (see clocky-tools' `Config`). */
  tools?: ToolsConfig
  /** Clocky home directory shared by shell context and local skill discovery. */
  clockyHome?: string
  /** Deterministic fallback and accepted-title limits; omission uses the bundle's example policy. */
  sessionTitle?: SessionTitleConfig
  /** Workspace-context loader controls with an explicit byte budget; set `false` for hermetic prompts. */
  workspaceContext: workspaceContext.Config | false
  /**
   * Skill registry, local provider, and model-facing consumer config.
   * Skills use `enabled` because one nested config controls a provider stack;
   * single model-tool plugins use `Config | false` to disable that one consumer.
   */
  skills?: SkillConfig
  /** Model-facing bash tool config, or false when another plugin owns `bash`. */
  toolBash?: toolBash.Config | false
  /** Process-local background-job admission config. */
  jobs?: JobsConfig
  /** Generic background-job controls; set false to keep the job service without model-facing job tools. */
  toolJobs?: toolJobs.Config | false
  /** Global enablement and package-name filters for invariant companions. */
  invariants?: InvariantConfig
}

/** The skill config schema exported for app packages that forward `skills`. */
export const SkillConfigSchema: z<SkillConfig> = z.object({
  enabled: z.boolean().default(true),
  registry: SkillRegistry.Config,
  filesystem: SkillFileSystem.Config,
  tool: toolSkill.Config,
})

/** The session-title config schema with the shared bundle's overridable example limits. */
export const SessionTitleConfigSchema: z<SessionTitleConfig> = SessionTitleService.Config
  .default(EXAMPLE_SESSION_TITLE_CONFIG)

/** The bash-tool config schema exported for app packages that forward `toolBash`. */
export const ToolBashConfigSchema: z<toolBash.Config | false> =
  z.union([z.const(false), toolBash.Config])

/** The process-local job registry schema exported for app packages that forward `jobs`. */
export const JobsConfigSchema: z<JobsConfig> = LocalJobRegistry.Config

/** The job-control-tool config schema exported for app packages that forward `toolJobs`. */
export const ToolJobsConfigSchema: z<toolJobs.Config> = toolJobs.Config

/** Intersect the owners' schemas so validation + defaulting stay identical. */
export const Config = z.intersect([
  AgentLoop.Config,
  SystemPrompt.Config,
  z.object({
    tools: ToolRuntime.Config,
    clockyHome: z.string(),
    sessionTitle: SessionTitleConfigSchema,
    skills: SkillConfigSchema,
    workspaceContext: z.union([z.const(false), workspaceContext.Config]).required(),
    toolBash: ToolBashConfigSchema,
    jobs: JobsConfigSchema,
    toolJobs: z.union([z.const(false), ToolJobsConfigSchema]),
    invariants: InvariantRegistry.Config,
  }) as unknown as z<Pick<Config, 'tools' | 'clockyHome' | 'sessionTitle' | 'skills' | 'workspaceContext' | 'toolBash' | 'jobs' | 'toolJobs' | 'invariants'>>,
]) as unknown as z<Config>

/**
 * Copy the bundle-owned fields from an app config without leaking entry-point settings.
 * @param config - App config containing the shared spine fields.
 * @returns The fields accepted by this bundle, preserving optional absence.
 */
export function pickSpineConfig(config: Omit<Config, 'agents'>): Omit<Config, 'agents'> {
  return {
    ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
    ...config.includeHarnessIdentity !== undefined ? { includeHarnessIdentity: config.includeHarnessIdentity } : {},
    ...config.includeRuntimeContext !== undefined ? { includeRuntimeContext: config.includeRuntimeContext } : {},
    ...config.persona !== undefined ? { persona: config.persona } : {},
    ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
    ...config.tools !== undefined ? { tools: config.tools } : {},
    ...config.clockyHome !== undefined ? { clockyHome: config.clockyHome } : {},
    ...config.sessionTitle !== undefined ? { sessionTitle: config.sessionTitle } : {},
    workspaceContext: config.workspaceContext,
    ...config.skills !== undefined ? { skills: config.skills } : {},
    ...config.toolBash !== undefined ? { toolBash: config.toolBash } : {},
    ...config.jobs !== undefined ? { jobs: config.jobs } : {},
    ...config.toolJobs !== undefined ? { toolJobs: config.toolJobs } : {},
    ...config.invariants !== undefined ? { invariants: config.invariants } : {},
  }
}

/**
 * Load the spine. Each `ctx.plugin(...)` mounts one child of the bundle fiber;
 * `agent-loop` receives the forwarded `agents` list and `system-prompt` the
 * forwarded `persona` and `toolOrder`. Workspace-context receives its own
 * explicitly forwarded config. Load order is irrelevant (cordis
 * pends each fiber on its `inject` until the services it needs exist), but the
 * listing mirrors the dependency layering for readability: the LLM vocabulary
 * and core registries first, then extension plugins that wrap request/tool
 * seams, then the loop that drives them.
 */
export function apply(ctx: Context, config: Config): void {
  const nestedClockyHome = config.skills?.filesystem?.clockyHome
  if (config.clockyHome !== undefined && nestedClockyHome !== undefined
    && resolveClockyHome(config.clockyHome) !== resolveClockyHome(nestedClockyHome)) {
    throw new Error('agent-spine-demo: clockyHome and skills.filesystem.clockyHome must resolve to the same directory')
  }
  const clockyHome = resolveClockyHome(config.clockyHome ?? nestedClockyHome)

  ctx.plugin(Timer)
  ctx.plugin(LlmRuntime)
  ctx.plugin(SessionStore)
  ctx.plugin(SessionTitleService, config.sessionTitle ?? EXAMPLE_SESSION_TITLE_CONFIG)
  // Owner schemas resolve defaults; forward toolOrder only when explicitly set.
  ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: config.includeHarnessIdentity ?? true,
    includeRuntimeContext: config.includeRuntimeContext ?? true,
    persona: config.persona ?? '',
    ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
  })
  ctx.plugin(ToolRuntime, config.tools ?? {})
  const skillsEnabled = config.skills?.enabled ?? true
  if (skillsEnabled) {
    ctx.plugin(SkillRegistry, config.skills?.registry ?? {})
    ctx.plugin(SkillFileSystem, Object.assign({}, config.skills?.filesystem, { clockyHome }))
  }
  ctx.plugin(AgentRegistry)
  ctx.plugin(llmRetry)
  ctx.plugin(LocalJobRegistry, config.jobs ?? {})
  ctx.plugin(InvariantRegistry, config.invariants ?? {})
  ctx.plugin(sessionInvariant)
  ctx.plugin(agentInvariant)
  ctx.plugin(scopeInvariant)
  ctx.plugin(agentLoopInvariant)
  if (config.toolBash !== false) {
    ctx.plugin(bashEnv, { clockyHome })
    ctx.plugin(toolBash, config.toolBash ?? {})
  }
  if (config.workspaceContext !== false) {
    ctx.plugin(workspaceContext, config.workspaceContext)
  }
  // Both plugins prepend session-prefix messages. Registration order is the
  // rendered order, so workspace instructions must precede the skill catalog.
  if (skillsEnabled) ctx.plugin(toolSkill, config.skills?.tool ?? {})
  if (config.toolJobs !== false) ctx.plugin(toolJobs, config.toolJobs ?? {})
  ctx.plugin(AgentLoop, {
    agents: config.agents ?? [],
    ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
  })
}
