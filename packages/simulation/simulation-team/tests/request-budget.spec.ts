/** Complete-envelope admission is independent of tool argument size and preserves provider usage floors. */
import { expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createUserMessage } from '@clocky/clocky-llm'
import { Session, SessionId } from '@clocky/clocky-session'
import TokenMeter, { estimateRequestTokens } from '@clocky/clocky-token-meter'
import { requestBudgetBlock, requestOutputCap, requestCapacity } from '../src/request-budget.ts'

const policy = { maxOutputTokens: 4096, safetyMarginTokens: 2048, inputSafetyFactor: 1.5, compactionAttempts: 1 }
it('caps inherited model output and includes system, schemas and full history before admission', async () => {
  const ctx = new Context()
  await ctx.plugin(TokenMeter)
  const meter = ctx.tokenMeter
  try {
    const session = Session.create(SessionId('budget'))
    const options = { provider: 'fixture', model: 'scripted', maxTokens: requestOutputCap(policy, 65536, 393216),
      system: '规则'.repeat(4000), tools: [{ name: 'observe', description: 'x'.repeat(4000), parameters: { type: 'object' as const } }],
      messages: [createUserMessage({ content: [{ type: 'text', text: 'context'.repeat(14000) }], source: { kind: 'user' } })] }
    session.append('user/message', options.messages[0]!, { surfaceOp: 'append' })
    expect(options.maxTokens).toBe(4096)
    expect(requestOutputCap(policy, 65536, 1024)).toBe(1024)
    const block = requestBudgetBlock(options, session, meter, policy, 16384)
    expect(block).toMatchObject({ estimatedInputTokens: Math.ceil(estimateRequestTokens(options) * 1.5), limit: 16384 })
    expect(block?.requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(requestBudgetBlock(options, session, meter, policy, 65536)).toBeUndefined()
    expect(requestBudgetBlock(options, session, meter, policy, 65536, 16384)?.limit).toBe(16384)
    expect(() => requestOutputCap(policy, 100)).toThrow(/cannot fit/)
  } finally { await ctx.fiber.dispose() }
})

it('refuses only a provably impossible policy minimum and keeps unknown context/long-run demand unknown', () => {
  expect(requestCapacity(undefined, { tokensPerRequest: 1, contextWindow: 1 })).toEqual({ status: 'unknown' })
  expect(requestCapacity(policy, { tokensPerRequest: 2049 })).toEqual({ status: 'impossible', dimension: 'request-limit', minimumRequired: '2050', limit: 2049 })
  expect(requestCapacity(policy, { tokensPerRequest: 10000, contextWindow: 2049 })).toEqual({ status: 'impossible', dimension: 'context-window', minimumRequired: '2050', limit: 2049 })
  expect(requestCapacity(policy, { tokensPerRequest: 2050, contextWindow: 2050 })).toEqual({ status: 'unknown' })
  expect(requestCapacity({ ...policy, safetyMarginTokens: Number.MAX_SAFE_INTEGER }, { tokensPerRequest: Number.MAX_SAFE_INTEGER }))
    .toMatchObject({ status: 'impossible', minimumRequired: '9007199254740993' })
})

it('measures complete known UTF-8 block framing and refuses a byte ceiling before any model call', () => {
  const knownRequiredContext = [{ kind: 'identity' as const, required: true,
    blocks: [{ type: 'text' as const, text: '猫\n"\\'.repeat(50) }] }]
  const bytes = Buffer.byteLength(JSON.stringify(knownRequiredContext.flatMap(section => section.blocks)), 'utf8')
  const request = { tokensPerRequest: 100000, knownRequiredContext }
  expect(requestCapacity(undefined, request, bytes - 1)).toMatchObject({ status: 'impossible', dimension: 'context-bytes',
    minimumRequired: String(bytes), limit: bytes - 1, sizing: { requiredContextBytes: bytes, coverage: 'required-subset' } })
  expect(requestCapacity(undefined, request, bytes)).toMatchObject({ status: 'unknown', sizing: {
    requiredContextBytes: bytes, completeEnvelope: 'unknown', futureConsumption: 'unknown' } })
  expect(bytes).toBeGreaterThan(JSON.stringify(knownRequiredContext.flatMap(section => section.blocks)).length)
})

it('uses the same meter floor and policy factor without claiming a complete initial request or spend forecast', () => {
  const knownRequiredContext = [{ kind: 'identity' as const, required: true,
    blocks: [{ type: 'text' as const, text: 'known required identity '.repeat(200) }] }]
  const input = createUserMessage({ content: knownRequiredContext[0]!.blocks, source: { kind: 'user' } })
  const floor = Math.ceil(estimateRequestTokens({ provider: 'fixture', model: 'scripted', messages: [input] }) * policy.inputSafetyFactor)
  const minimum = floor + policy.safetyMarginTokens + 1
  const request = { tokensPerRequest: 100000, contextWindow: minimum - 1, knownRequiredContext }
  expect(requestCapacity(policy, request, 65536)).toMatchObject({ status: 'impossible', dimension: 'context-window',
    minimumRequired: String(minimum), sizing: { estimatedInputTokens: floor } })
  expect(requestCapacity(policy, { ...request, tokensPerRequest: minimum - 1, contextWindow: 100000 }, 65536))
    .toMatchObject({ status: 'impossible', dimension: 'request-limit' })
  expect(requestCapacity(policy, { ...request, contextWindow: minimum }, 65536)).toMatchObject({ status: 'unknown', sizing: {
    estimatedInputTokens: floor, completeEnvelope: 'unknown', futureConsumption: 'unknown' } })
})
