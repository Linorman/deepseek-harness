import { describe, expect, it } from 'vitest'
import {
  readSupervisorJson,
  supervisorErrorSchema,
  supervisorObservationSchema,
  supervisorRequestSchema,
} from '../src/protocol.ts'

async function* chunks(values: readonly (Uint8Array | string)[]): AsyncIterable<Uint8Array | string> {
  for (const value of values) yield value
}

describe('supervisor HTTP protocol bounds', () => {
  it('reassembles string and Buffer chunks within the configured byte bound', async () => {
    await expect(readSupervisorJson(chunks(['{"version":', Buffer.from('1}')]), 32)).resolves.toEqual({ version: 1 })
  })

  it('rejects an oversized body before parsing the remaining chunks', async () => {
    await expect(readSupervisorJson(chunks(['{"payload":"', 'too-large"}']), 10))
      .rejects.toThrow('payload exceeds its configured byte limit')
  })

  it('rejects malformed JSON at the wire boundary', async () => {
    await expect(readSupervisorJson(chunks(['not-json']), 32)).rejects.toThrow(SyntaxError)
  })

  it('keeps request, observation, and public error schemas closed to unsupported values', () => {
    expect(() => supervisorRequestSchema.parse({ version: 2, operation: 'health', binding: {} })).toThrow()
    expect(() => supervisorObservationSchema.parse({ descriptor: {}, status: 'gone' })).toThrow()
    expect(() => supervisorErrorSchema.parse({ code: 'SECRET' })).toThrow()
  })
})
