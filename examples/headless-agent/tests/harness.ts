import { Context } from '@clocky/cordis'
import type { SessionEvent } from '@clocky/clocky-session'
import type { Agent } from '@clocky/clocky-agent'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import { LocalBashExecutor } from '@clocky/clocky-bash-local'
import * as BashEnvPlugin from '@clocky/clocky-shell-env'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import * as ToolBash from '@clocky/clocky-tool-bash'
import * as ToolTodo from '@clocky/clocky-tool-todo'
import * as LlmPiAi from '@clocky/clocky-llm-pi-ai'
import type { PiAiProviderProfile, PiAiReasoningEfforts } from '@clocky/clocky-llm-pi-ai'
import TokenMeter from '@clocky/clocky-token-meter'
import ToolResultPruner from '@clocky/clocky-compaction-tool-result-pruner'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@clocky/clocky-session-checkpoint-policy'
import { BasicCompactionEngine } from '@clocky/clocky-compaction-basic'
import type { BasicCompactionConfig } from '@clocky/clocky-compaction-basic'

/**
 * Shared harness for the headless-agent e2e suites: the full plugin stack
 * with the generic pi-ai adapter and the real bash + todo_write tools. Lives
 * outside the *.e2e.ts pattern so importing it never re-registers another
 * file's tests.
 */

export const SYSTEM_PROMPT = 'You are a coding agent. Use bash for file operations '
  + 'with cat/grep/heredocs; check [exit code: N] markers, '
  + 'and report results briefly. When the task names a tool, call it immediately '
  + 'and do not replace the tool call with an explanation.'

/** System prompt for the todo_write e2e: nudges the model to plan with the tool. */
export const TODO_SYSTEM_PROMPT = 'You are a coding agent. For multi-step work, '
  + 'use the todo_write tool to track a task list: send the WHOLE list each call, '
  + 'mark every task being actively worked on in_progress (several at once when '
  + 'work runs in parallel, at least one while work remains), and mark a task '
  + 'completed as soon as it is done.'

const localModelBaseURL = process.env.CLOCKY_LOCAL_MODEL_BASE_URL
const useLocalModel = localModelBaseURL !== undefined && localModelBaseURL.length > 0
/** Canonical thinking levels mapped to the levels accepted by the local Qwen endpoint. */
const localModelReasoningEfforts = {
  off: null,
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'xhigh',
  xhigh: 'xhigh',
  max: 'xhigh',
} satisfies PiAiReasoningEfforts
type LocalReasoningEffort = NonNullable<PiAiProviderProfile['reasoning']>
const localModelReasoningEffort: LocalReasoningEffort | undefined = (() => {
  const raw = process.env.CLOCKY_LOCAL_MODEL_REASONING_EFFORT
  if (raw === undefined || raw === '') return undefined
  switch (raw) {
    case 'off':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return raw
    default:
      throw new Error('CLOCKY_LOCAL_MODEL_REASONING_EFFORT must be one of off, minimal, low, medium, high, xhigh, or max')
  }
})()

/** Whether a keyed real-model route is available to the live e2e suites. */
export const hasRealModel = useLocalModel || Boolean(process.env.DEEPSEEK_API_KEY)

/** Provider/model identity selected by the live e2e suites. */
export const realModel = Object.freeze({
  provider: useLocalModel ? 'local-vllm' : 'deepseek',
  model: useLocalModel
    ? process.env.CLOCKY_LOCAL_MODEL_ID ?? 'Qwen3.8-27B-AWQ-4bit'
    : 'deepseek-v4-flash',
})

/**
 * Build the one real-model route used by programmatic headless e2e harnesses.
 * The local route is explicit and OpenAI-compatible; the external route keeps
 * the example's existing DeepSeek fallback. A context override names the
 * selected model rather than inventing a second test-only model id.
 * @param modelContextWindow - optional context capacity override for compaction tests.
 * @returns provider profiles keyed by the selected route.
 */
export function realModelProviders(modelContextWindow?: number): Record<string, PiAiProviderProfile> {
  if (useLocalModel) {
    return {
      [realModel.provider]: {
        apiKeyEnv: 'CLOCKY_LOCAL_MODEL_API_KEY',
        api: 'openai-completions',
        baseURL: localModelBaseURL,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: 'max_tokens',
        },
        defaultContextWindow: modelContextWindow ?? 131072,
        defaultMaxTokens: 5120,
        models: [{
          id: realModel.model,
          contextWindow: modelContextWindow ?? 131072,
          maxTokens: 5120,
          reasoningEfforts: localModelReasoningEfforts,
        }],
        ...localModelReasoningEffort === undefined ? {} : { reasoning: localModelReasoningEffort },
      },
    }
  }
  return {
    deepseek: {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      ...process.env.DEEPSEEK_BASE_URL === undefined ? {} : { baseURL: process.env.DEEPSEEK_BASE_URL },
      ...modelContextWindow === undefined ? {} : { models: [{ id: realModel.model, contextWindow: modelContextWindow }] },
    },
  }
}

/** Options for {@link codingHarness}. */
export interface CodingHarnessOptions {
  /**
   * Deployment persona for the tree (the system-prompt plugin's `persona`
   * config — per-context, not per-agent). Omitted ⇒ no persona section.
   */
  persona?: string
  /** Durable JSONL persistence root (the resume suite needs it; others stay file-free). */
  persistenceRoot?: string
  /**
   * Load {@link BasicCompactionEngine} with this config so the compaction e2e can
   * trigger compaction at a small, controlled history size. Omitted ⇒ no
   * compaction plugin (the default suites run without it).
   */
  compact?: BasicCompactionConfig
  /** Test-only context capacity advertised for the selected real model. */
  modelContextWindow?: number
}

export async function codingHarness(workdir: string, options: CodingHarnessOptions = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: options.persona ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmPiAi, {
    providers: realModelProviders(options.modelContextWindow),
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  // Compaction is opt-in: only the compaction e2e loads the reusable meter and backend.
  if (options.compact !== undefined) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, options.compact)
  }
  // Durable JSONL persistence is opt-in: only the resume e2e needs it, and the
  // other suites stay file-free. Loaded last so a resume's deferred
  // `ctx.inject(['sessionPersistence'])` resolves once this is present.
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    await ctx.plugin(SessionCheckpointPolicy)
  }
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

export function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}
