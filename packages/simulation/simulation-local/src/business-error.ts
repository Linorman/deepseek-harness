/** Local business failures, distinct from storage errors. @module @clocky/clocky-simulation-local/business-error */
/** A well-formed accepted operation can fail current business preconditions. */
export class BusinessRejection extends Error {
  constructor(readonly code: string, readonly status: 'rejected' | 'blocked-authority' = 'rejected') { super(code) }
}
/**
 * Reject a business precondition without applying an effect.
 * @param code - Stable failure code.
 * @returns never.
 */
export function rejectBusiness(code: string): never { throw new BusinessRejection(code) }
/**
 * Reject current actor authority without applying an effect.
 * @param code - Stable failure code.
 * @returns never.
 */
export function denyBusiness(code: string): never { throw new BusinessRejection(code, 'blocked-authority') }
