import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@clocky/clocky-client-web',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
