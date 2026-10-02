/** Host mounting requires the opt-in product directory before the browser module is advertised. */
export { Config } from './config.ts'
/** Required Host-side deployment capability. */
export const inject = ['simulationProducts']
/** Host entry has no execution effects; its injection determines browser availability. */
export function apply(): void {}
