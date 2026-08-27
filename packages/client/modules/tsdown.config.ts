import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@clocky/clocky-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
