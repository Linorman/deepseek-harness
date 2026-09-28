/** Verify immutable case files against the delivered content hashes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredFiles = ['PROMPT.txt', 'START_HERE.txt', 'RULES.txt', 'GUIDE.txt', 'ACCEPTANCE.txt',
  'seed.json', 'engine.mjs', 'world.mjs', 'integrity.mjs', 'engine.test.mjs']

/** Check delivered input and referee files, excluding world outputs.
 * @param root - Absolute standalone case directory.
 * @returns Verification count; changed or missing files throw.
 */
export async function verifyIntegrity(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, 1)
  assert.deepEqual(Object.keys(manifest.files).sort(), [...requiredFiles].sort(), 'immutable file list differs')
  for (const [file, expected] of Object.entries(manifest.files)) {
    assert.match(file, /^[a-zA-Z0-9_.-]+$/, 'manifest file must be local')
    const observed = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')
    assert.equal(observed, expected, `immutable case file changed: ${file}`)
  }
  return { valid: true, files: Object.keys(manifest.files).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyIntegrity(dirname(fileURLToPath(import.meta.url)))))
}
