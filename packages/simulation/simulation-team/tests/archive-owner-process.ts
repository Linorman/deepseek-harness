/** Hold the real archive publication mutex until the parent kills this process. */
import { acquireLocalFileOwner } from '../../../storage/storage/src/owner.ts'
const path = process.argv[2]
if (path === undefined) throw new Error('Expected publication owner path')
const release = acquireLocalFileOwner(path)
process.on('SIGTERM', () => { release(); process.exit(0) })
process.send?.({ event: 'archive-publication-held' })
setInterval(() => {}, 1000)
