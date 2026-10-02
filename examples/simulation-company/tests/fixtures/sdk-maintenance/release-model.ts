/** Only the external model is scripted; management, delivery and storage use production owners. */
import { released } from '../../product-control-model.ts'

export function apply(): void { released.resolve(undefined) }
