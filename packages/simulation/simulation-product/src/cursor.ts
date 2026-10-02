/** Product continuations bind authentication, collection/object selection and the exact revision/query. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { SimulationProductCursor } from './types.ts'

/** Encrypted continuation identity includes principal generation and directory/query revision. */
const cursorSchema = z.object({ principalId: z.string(), issuer: z.string(), subject: z.string(), generation: z.number().int(),
  scope: z.string(), revision: z.number().int(), search: z.string(), limit: z.number().int(), offset: z.number().int().nonnegative(),
}).strict()
type CursorData = z.infer<typeof cursorSchema>

/** One service lifetime invalidates continuations when its directory owner is replaced. */
export class DirectoryCursorCodec {
  private readonly key = randomBytes(32)

  /**
   * Encode a private next position without exposing unauthorized scan metadata.
   * @param call - Current authenticated principal generation.
   * @param query - Exact directory/query observation and next offset.
   * @returns opaque encrypted continuation.
   */
  encode(call: AuthenticatedProductCall, query: Pick<CursorData, 'scope' | 'revision' | 'search' | 'limit' | 'offset'>): SimulationProductCursor {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    const data: CursorData = { ...query, principalId: call.principal.id, issuer: call.principal.issuer,
      subject: call.principal.subject, generation: call.credentialGeneration }
    const payload = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString('base64url') as SimulationProductCursor
  }

  /**
   * Decode and bind the original query before its private scan position is used.
   * @param value - Untrusted wire continuation.
   * @param call - Current authenticated principal generation.
   * @param query - Current directory revision and explicit query.
   * @returns validated private next offset; authentication/query replacement rejects.
   */
  decode(value: SimulationProductCursor, call: AuthenticatedProductCall,
    query: Pick<CursorData, 'scope' | 'revision' | 'search' | 'limit'>): number {
    try {
      const data = this.unpack(value)
      if (data.principalId !== call.principal.id || data.issuer !== call.principal.issuer || data.subject !== call.principal.subject
        || data.generation !== call.credentialGeneration || data.revision !== query.revision || data.scope !== query.scope
        || data.search !== query.search || data.limit !== query.limit) throw new Error('Cursor observation expired')
      return data.offset
    } catch (cause: unknown) { throw new Error('Simulation directory continuation expired; restart from the first page', { cause }) }
  }

  /**
   * Read a prior watch observation while accepting later native revisions.
   * @param value - Authenticated prior watch cursor; another service lifetime cannot decrypt it.
   * @param call - Current credential generation.
   * @param scope - Exact run watch namespace.
   * @returns prior policy and native revision or missing/unavailable sentinels; other query/credential selections reject.
   */
  watchRevision(value: SimulationProductCursor, call: AuthenticatedProductCall, scope: string): { revision: number; readVersion: string } {
    const data = this.unpack(value)
    if (data.principalId !== call.principal.id || data.issuer !== call.principal.issuer || data.subject !== call.principal.subject
      || data.generation !== call.credentialGeneration || data.scope !== scope || (!data.search.startsWith('watch:') || data.search.length <= 6) || data.limit !== 1
      || data.offset !== 0 || data.revision < -2) throw new Error('Simulation watch continuation expired')
    return { revision: data.revision, readVersion: data.search.slice('watch:'.length) }
  }

  private unpack(value: SimulationProductCursor): CursorData {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value || bytes.length < 29) throw new Error('Invalid cursor encoding')
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const text = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    return cursorSchema.parse(JSON.parse(text))
  }

}
