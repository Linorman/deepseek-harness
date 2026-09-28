/** Repository-local test directories also work before any development scratch folders exist. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'

/** Allocate an isolated directory under the repository's temporary tree. */
export async function simulationTemp(prefix: string): Promise<string> {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  return await mkdtemp(join(root, `simulation-${prefix}-`))
}
