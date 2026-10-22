/** Reuse the already scoped external keyless adapters; process-loss controls never feed Native objects into cognition. */
import type { Context } from '@clocky/cordis'
import * as transfer from './world-personnel-model.ts'
import * as departure from './world-departure-model.ts'

export const name = 'world-personnel-crash-model'
export const inject = ['llm']
const selected = process.env.WORLD_PERSONNEL_CRASH_STAGE?.startsWith('depart-') === true ? departure : transfer
/** Actual underlying independent Agent model requests, not fabricated replay counts. */
export const requests = selected.requests
/** Actual underlying Model inputs, used only by the host-side evidence assertions. */
export const modelInputs = selected.modelInputs
/** @param ctx - Original Loader context; selected provider receives only its real Session inputs. */
export function apply(ctx: Context): void { selected.apply(ctx) }
