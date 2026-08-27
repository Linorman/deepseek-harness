import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@clocky/clocky-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
