/** Live acceptance delegates to the existing adapter through a credential-owning local budget proxy. */
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import * as PiAi from '@clocky/clocky-llm-pi-ai'

export const name = 'live-world-provider'
export const inject = ['llm']

/** Install one explicit non-thinking route; the proxy refuses unbudgeted or retried upstream requests. */
export async function apply(ctx: Context): Promise<void> {
  const maxOutputTokens = z.coerce.number().int().min(512).max(2048).parse(process.env.LIVE_MAX_OUTPUT_TOKENS ?? 512)
  const baseURL = process.env.LIVE_PROXY_URL
  if (baseURL === undefined || !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseURL)) throw new Error('Live validation requires its local budget proxy')
  await ctx.plugin(PiAi, { providers: { 'live-world': { apiKeyEnv: 'SIMULATION_MODEL_API_KEY',
    api: 'openai-completions', baseURL, retryPolicy: { mode: 'normal', maxRetries: 0 },
    compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false, supportsStore: false, supportsStrictMode: false }, reasoning: 'off',
    models: [{ id: 'deepseek-flash', contextWindow: 1048576, maxTokens: maxOutputTokens, reasoningEfforts: { off: 'off', low: 'low' } }],
  } } })
}
