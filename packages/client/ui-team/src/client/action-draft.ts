/** Unsent input and retry identity; request bodies and permissions remain in runtime. */
import type { TeamActionResponseInput } from '@clocky/clocky-client-runtime/client'

/** One question's user-authored answer. */
export interface ActionAnswerDraft {
  readonly selected: readonly string[]
  readonly custom: string
}

/** Retain an uncertain answer's command identity together with its exact payload fingerprint. */
export interface HumanActionDraft {
  readonly answers: Readonly<Record<string, ActionAnswerDraft>>
  readonly retry?: { readonly fingerprint: string; readonly key: TeamActionResponseInput['idempotencyKey'] } | undefined
}

/** Initial input for an unopened request. */
export const EMPTY_ACTION_DRAFT: HumanActionDraft = { answers: {} }
