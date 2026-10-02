/** Bounded principal-scoped discovery; storage names never leave the provider in clear text. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { TeamError, teamDiscoveryCursorSchema } from '@clocky/clocky-team'
import type { TeamDiscoveryCursor, TeamHumanReaderScope, TeamListPage, TeamProductDirectoryPage,
  TeamProductDiscoveryCursor, TeamProductSummary, TeamId } from '@clocky/clocky-team'

/** Per-provider cursor encryption; authentication includes the complete reader identity and generation. */
export class ProductDirectoryCursor {
  private readonly key = randomBytes(32)

  /** Encrypt one internal position for the exact current reader.
   * @param position - Internal storage position.
   * @param scope - Current authenticated reader.
   * @returns authenticated ciphertext whose plaintext is never a product response field.
   */
  seal(position: TeamDiscoveryCursor | -1, scope: TeamHumanReaderScope): TeamProductDiscoveryCursor {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(this.context(scope))
    const body = Buffer.concat([cipher.update(JSON.stringify(position), 'utf8'), cipher.final()])
    return `directory-v1:${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url')}` as TeamProductDiscoveryCursor
  }

  /** Authenticate a product continuation before exposing its storage position to a provider.
   * @param cursor - Untrusted product continuation.
   * @param scope - Current reader context.
   * @param maxBytes - Deployment response/input allowance for the complete cursor.
   * @returns authenticated internal position; foreign, expired, oversized or malformed tokens reject.
   */
  open(cursor: TeamProductDiscoveryCursor, scope: TeamHumanReaderScope, maxBytes: number): TeamDiscoveryCursor | -1 {
    try {
      if (!cursor.startsWith('directory-v1:') || Buffer.byteLength(cursor) > maxBytes) throw new Error('Invalid directory cursor')
      const encoded = cursor.slice('directory-v1:'.length)
      const value = Buffer.from(encoded, 'base64url')
      if (value.toString('base64url') !== encoded || value.byteLength <= 28) throw new Error('Malformed directory cursor')
      const decipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12))
      decipher.setAAD(this.context(scope))
      decipher.setAuthTag(value.subarray(12, 28))
      const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'))
      return parsed === -1 ? -1 : teamDiscoveryCursorSchema.parse(parsed)
    } catch (cause: unknown) {
      throw new TeamError('Product Team discovery cursor expired; restart from -1', 'TEAM_DISCOVERY_CURSOR_EXPIRED', { cause })
    }
  }

  private context(scope: TeamHumanReaderScope): Buffer {
    return Buffer.from(JSON.stringify(['clocky/product-directory/v1', scope.principalId, scope.issuer, scope.subject, scope.credentialGeneration]))
  }
}

/** Dependencies retain authority and metadata under the Hub's existing Team serializers. */
export interface ProductDirectoryReader {
  readonly scan: (position: TeamDiscoveryCursor | -1) => Promise<TeamListPage>
  readonly project: (teamId: TeamId) => Promise<TeamProductSummary | undefined>
  readonly publish: (ids: readonly TeamId[], nextCursor: TeamProductDiscoveryCursor | undefined) => Promise<TeamProductDirectoryPage>
  readonly currentScope: () => TeamHumanReaderScope
}

/** One bounded scan with byte-aware admission and a final atomic authorization projection. */
export class ProductDirectory {
  private readonly cursors = new ProductDirectoryCursor()

  /** Publish one bounded scan without advancing past an unread oversized row.
   * @param afterCursor - Product position or initial read.
   * @param scope - Reader pinned for this request.
   * @param scanAllowance - Maximum physical names examined.
   * @param maxBytes - Complete response allowance.
   * @param reader - Authoritative scans, point projections and final authorization under all selected queues.
   * @returns one bounded page; rejected oversized rows never silently advance past an unread item.
   */
  async read(afterCursor: TeamProductDiscoveryCursor | -1, scope: TeamHumanReaderScope, scanAllowance: number,
    maxBytes: number, reader: ProductDirectoryReader): Promise<TeamProductDirectoryPage> {
    const rows: TeamProductSummary[] = []
    let position = afterCursor === -1 ? -1 : this.cursors.open(afterCursor, scope, maxBytes)
    let scanned = 0
    const validate = () => {
      if (!isDeepStrictEqual(scope, reader.currentScope())) throw new TeamError('Team reader changed during discovery', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const page = (cursor: TeamDiscoveryCursor | -1 | undefined): TeamProductDirectoryPage => ({ items: rows,
      ...cursor === undefined ? {} : { nextCursor: this.cursors.seal(cursor, scope) } })
    while (scanned < scanAllowance) {
      validate()
      const before = position
      const raw = await reader.scan(before)
      validate()
      if (raw.scanned > 1 || raw.items.length > 1 || raw.nextCursor === before
        || raw.nextCursor !== undefined && raw.scanned === 0) throw new TeamError('Team discovery scan exceeded or failed to advance its work allowance', 'TEAM_INVALID_ARGUMENT')
      scanned += raw.scanned
      const candidate = raw.items[0]
      if (candidate !== undefined) {
        const item = await reader.project(candidate.id)
        validate()
        if (item !== undefined) {
          rows.push(item)
          if (Buffer.byteLength(JSON.stringify(page(raw.nextCursor))) > maxBytes) {
            rows.pop()
            if (rows.length === 0) throw new TeamError('Team directory row exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
            return await reader.publish(rows.map(row => row.id), this.cursors.seal(before, scope))
          }
        }
      }
      if (raw.nextCursor === undefined) return await reader.publish(rows.map(row => row.id), undefined)
      position = raw.nextCursor
    }
    const result = page(position)
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw new TeamError('Team directory metadata exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
    return await reader.publish(rows.map(row => row.id), result.nextCursor)
  }
}
