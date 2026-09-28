/** Validate generated triage files; Team worker participation is checked separately. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const csv = async path => {
  const lines = (await readFile(resolve(here, path), 'utf8')).trim().split('\n').map(line => line.trim().split(','))
  return { header: lines[0], rows: lines.slice(1) }
}
const source = await csv('tickets.csv')
assert.deepEqual(source.header, ['id', 'severity', 'affected_customers', 'data_loss', 'owner'])
const expected = source.rows.map(([id, severity, customers, loss, owner]) =>
  [id, String(4 * Number(severity) + 2 * Number(customers) + 3 * Number(loss === 'yes')), owner])
const first = await csv('output/first-half.csv')
const second = await csv('output/second-half.csv')
const priority = await csv('output/priority.csv')
for (const file of [first, second, priority]) assert.deepEqual(file.header, ['id', 'score', 'owner'])
assert.deepEqual(first.rows.map(row => row[0]).sort(), ['T01', 'T02', 'T03', 'T04'])
assert.deepEqual(second.rows.map(row => row[0]).sort(), ['T05', 'T06', 'T07', 'T08'])
assert.deepEqual([...first.rows, ...second.rows].sort((a, b) => a[0].localeCompare(b[0])), expected)
expected.sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
assert.deepEqual(priority.rows, expected)
const summary = await readFile(resolve(here, 'output/summary.txt'), 'utf8')
for (const [id, score] of expected.slice(0, 3)) assert.ok(summary.includes(id) && summary.includes(score))
assert.ok(summary.includes('159'))
console.log('Triage files verified. Inspect the Team journal for two worker attempts.')
