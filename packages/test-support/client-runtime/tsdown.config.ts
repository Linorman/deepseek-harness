import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@clocky/clocky-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
