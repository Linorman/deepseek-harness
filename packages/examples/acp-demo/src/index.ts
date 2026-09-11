/**
 * The ACP automation server app: the default agent spine, JSONL Session
 * persistence, the local Team topology, and the {@link @clocky/clocky-acp}
 * bridge. The app owns those plugins through one ordered lifecycle so ACP Team
 * runs quiesce before their durable stores detach. It writes nothing to stdout.
 * Leaf configuration supplies adapters, executors, and optional tools, and must
 * likewise avoid stdout loggers. Named exports retain this plugin's `Config`
 * schema through Loader (see docs/postmortem/0001).
 * @module @clocky/clocky-acp-demo
 */

import type { Context } from '@clocky/cordis'
import { join } from 'node:path'
import z from '@clocky/schemastery'
import * as acp from '@clocky/clocky-acp'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import * as agentCore from '@clocky/clocky-agent-spine-demo'
import * as workspaceContext from '@clocky/clocky-agent-instructions'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as AgentRuntimeInProcess from '@clocky/clocky-agent-runtime-in-process'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import * as TeamChannelDirect from '@clocky/clocky-team-channel-direct'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamRun from '@clocky/clocky-team-run'
import * as ToolTeam from '@clocky/clocky-tool-team'
import * as ToolTeamGoal from '@clocky/clocky-tool-team-goal'
import ToolRuntime, { type Config as ToolsConfig } from '@clocky/clocky-tools'
import JsonlSessionPersistence, {
  JsonlCompressionSchema,
  type JsonlCompression,
} from '@clocky/clocky-session-persistence-jsonl'
import * as sessionCheckpointPolicy from '@clocky/clocky-session-checkpoint-policy'
import SqliteSessionQueryEngine from '@clocky/clocky-session-query-sqlite'

export const name = 'acp-demo'
const DEFAULT_PERSISTENCE_ROOT = './.sessions'
const RemovedGoalsConfigSchema: z<never> = z.transform(z.any(), () => {
  throw new TypeError('acp-demo: goals has been removed; ACP tasks are Team-owned')
})

/**
 * App config: the swappable per-deployment values. `provider` and `model`
 * select the local Team coordinator's default model; `persona` is the
 * deployment persona; `toolOrder` is the explicit model-facing tool order;
 * `tools` is the tool registry's config; and `persistenceRoot` owns Session
 * persistence plus the derived Team storage root.
 */
export interface Config {
  /** Provider route for default local Team coordinator activations. */
  provider: string
  /** Model name for default local Team coordinator activations. */
  model: string
  /** Fresh Team-projection reads allowed when a coordinator soft interrupt races a durable update. */
  interruptRetryAttempts?: number
  /** Bundled agent-loop concurrency cap; `1` is serial and omission uses its default. */
  maxParallelToolCalls?: number
  /** Deployment persona (the system-prompt plugin's `persona` config). */
  persona?: string
  /** Explicit model-facing tool order (the system-prompt plugin's `toolOrder` config; see clocky-system-prompt). */
  toolOrder?: string[]
  /** Tool-registry config — its presentation `mode` (forwarded through agent-spine-demo; see clocky-tools). */
  tools?: ToolsConfig
  /** Clocky home directory exposed to bash and used for local skill discovery. */
  clockyHome?: string
  /** Fallback session-title limits forwarded through agent-spine-demo. */
  sessionTitle?: NonNullable<agentCore.Config['sessionTitle']>
  /** Directory for JSONL sessions and the derived query index. Defaults to `./.sessions`. */
  persistenceRoot?: string
  /** JSON storage root for Team journals and channel WALs; defaults below `persistenceRoot`. */
  teamStorageRoot?: string
  /** Write delta-chunk runs as packed storage rows (the JSONL backend's `packChunks`). Defaults to `true`. */
  packChunks?: boolean
  /** JSONL artifact encoding; defaults to checksummed Zstandard frames. */
  persistenceCompression?: JsonlCompression
  /** Controls automatic AGENTS.md/CLAUDE.md loading; configure a byte budget or set `false`. */
  workspaceContext: agentCore.Config['workspaceContext']
  /** Skill registry, local-provider, and model-facing consumer config forwarded to agent-spine-demo. */
  skills?: agentCore.SkillConfig
  /** Model-facing bash tool config forwarded through agent-core. */
  toolBash?: NonNullable<agentCore.Config['toolBash']>
  /** Process-local background-job admission config forwarded through agent-core. */
  jobs?: NonNullable<agentCore.Config['jobs']>
  /** Generic background-job controls forwarded through agent-core; set false to omit their tools. */
  toolJobs?: NonNullable<agentCore.Config['toolJobs']>
  /** Removed same-session Goal config; supplying it fails at load. */
  goals?: never
}

// Each entry point owns a complete, directly readable config schema; extracting
// the common fields would make two small app contracts depend on a new facade.
/* jscpd:ignore-start */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  interruptRetryAttempts: z.number().step(1).min(1),
  maxParallelToolCalls: z.number().step(1).min(1),
  persona: z.string(),
  // The array default is forced to undefined: ABSENT means "lexicographic
  // order" (the owning clocky-system-prompt schema does the same), while
  // schemastery's native [] default would read as an invalid configured list.
  toolOrder: z.array(z.string()).default(undefined as unknown as string[]),
  tools: ToolRuntime.Config,
  clockyHome: z.string(),
  sessionTitle: agentCore.SessionTitleConfigSchema,
  persistenceRoot: z.string().default(DEFAULT_PERSISTENCE_ROOT),
  teamStorageRoot: z.string(),
  packChunks: z.boolean().default(true),
  persistenceCompression: JsonlCompressionSchema,
  workspaceContext: z.union([z.const(false), workspaceContext.Config]).required(),
  skills: agentCore.SkillConfigSchema,
  toolBash: agentCore.ToolBashConfigSchema,
  jobs: agentCore.JobsConfigSchema,
  toolJobs: z.union([z.const(false), agentCore.ToolJobsConfigSchema]),
  goals: RemovedGoalsConfigSchema,
})
/* jscpd:ignore-end */

interface StorageRoots {
  readonly persistenceRoot: string
  readonly teamStorageRoot: string
}

/** Resolve the durable roots owned by this app composition. */
function resolveStorageRoots(config: Config): StorageRoots {
  const persistenceRoot = config.persistenceRoot ?? DEFAULT_PERSISTENCE_ROOT
  return {
    persistenceRoot,
    teamStorageRoot: config.teamStorageRoot ?? join(persistenceRoot, 'team-storage'),
  }
}

/**
 * Compose the spine, local Team runtime, and ACP automation transport. JSONL
 * persists coordinator Sessions and `teamStorageRoot` persists Team journals
 * and channel WALs. The ACP bridge owns stdout; this composition adds no logger
 * or HMR row.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const roots = resolveStorageRoots(config)
  await ctx.effect(async function* () {
    const spine = ctx.plugin(agentCore, agentCore.pickSpineConfig(config))
    await spine
    yield spine.dispose
    // Same rationale as the Config schema above: each entry point forwards its own
    // persistence passthroughs rather than sharing a facade with stdio-demo.
    /* jscpd:ignore-start */
    const persistence = ctx.plugin(JsonlSessionPersistence, {
      root: roots.persistenceRoot,
      ...config.packChunks !== undefined ? { packChunks: config.packChunks } : {},
      ...(config.persistenceCompression === undefined ? {} : { compression: config.persistenceCompression }),
    })
    await persistence
    yield persistence.dispose
    /* jscpd:ignore-end */
    const checkpoint = ctx.plugin(sessionCheckpointPolicy)
    await checkpoint
    yield checkpoint.dispose
    const query = ctx.plugin(SqliteSessionQueryEngine, { path: join(roots.persistenceRoot, 'session-query.db') })
    await query
    yield query.dispose

    const defaultModel = ctx.plugin(AgentDefaultModelConfig, { provider: config.provider, model: config.model })
    await defaultModel
    yield defaultModel.dispose
    const storage = ctx.plugin(Storage)
    await storage
    yield storage.dispose
    const storageJson = ctx.plugin(StorageJson, { root: roots.teamStorageRoot })
    await storageJson
    yield storageJson.dispose
    const storageLog = ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await storageLog
    yield storageLog.dispose
    const hub = ctx.plugin(TeamHub)
    await hub
    yield hub.dispose
    const direct = ctx.plugin(TeamChannelDirect)
    await direct
    yield direct.dispose
    const channelAdmission = ctx.plugin(TeamChannelAdmission)
    await channelAdmission
    yield channelAdmission.dispose
    const runtimes = ctx.plugin(AgentRuntime)
    await runtimes
    yield runtimes.dispose
    const inProcess = ctx.plugin(AgentRuntimeInProcess)
    await inProcess
    yield inProcess.dispose
    const activations = ctx.plugin(TeamActivationController)
    await activations
    yield activations.dispose
    const links = ctx.plugin(TeamLinkRegistry)
    await links
    yield links.dispose
    const localLink = ctx.plugin(TeamLinkLocal)
    await localLink
    yield localLink.dispose
    const agentClient = ctx.plugin(TeamAgentClient)
    await agentClient
    yield agentClient.dispose
    const teamTools = ctx.plugin(ToolTeam)
    await teamTools
    yield teamTools.dispose
    const teamRun = ctx.plugin(TeamRun)
    await teamRun
    yield teamRun.dispose
    const teamGoalTools = ctx.plugin(ToolTeamGoal)
    await teamGoalTools
    yield teamGoalTools.dispose
    const transport = ctx.plugin(acp, {
      ...config.interruptRetryAttempts === undefined ? {} : { interruptRetryAttempts: config.interruptRetryAttempts },
    })
    await transport
    yield transport.dispose
  }, 'acp-demo.composition')
}
