/** Register the existing input-only scripted models without exposing Native or Team services. */
import type { Context } from '@clocky/cordis'
import { apply as rule } from './world-external-model.ts'
import { apply as actor } from './world-external-actor-model.ts'
export const inject = ['llm']
/** @param ctx - Existing model registry. @returns nothing; each original adapter owns its effect lifetime. */
export function apply(ctx: Context): void { rule(ctx); actor(ctx) }
