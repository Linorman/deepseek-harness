/**
 * The one home of this application's forwarded-Host-event allowlist. Both
 * compiler faces list this file, so the Host forwarding loop and the consumer
 * `ctx.remote.$on` key face read one declaration instead of two copies that
 * could drift; `./types.ts` derives the type projection from it and stays
 * type-only.
 */

/**
 * Host events this application forwards to consumers verbatim: no projection,
 * no redaction, no renaming. The wire name is the Host cordis event name and
 * the payload is its argument list. This array owns the legal key set of
 * `ctx.remote.$on`; Host delivery additionally classifies Session ownership
 * and checks current product read authority. Adding an event requires that
 * ownership decision in the Host's exhaustive classifier.
 */
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/reference-updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
] as const
