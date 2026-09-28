/** Validate generated order and payment ledgers; Team task order is checked separately. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const csv = async path => {
  const lines = (await readFile(resolve(here, path), 'utf8')).trim().split('\n').map(line => line.trim().split(','))
  return { header: lines[0], rows: lines.slice(1) }
}
const orders = (await csv('data/orders.csv')).rows
const stock = new Map((await csv('data/inventory.csv')).rows.map(([sku, quantity]) => [sku, Number(quantity)]))
const expectedFulfillment = orders.map(([id, sku, quantity]) => {
  const ordered = Number(quantity)
  const fulfilled = Math.min(ordered, stock.get(sku))
  stock.set(sku, stock.get(sku) - fulfilled)
  return [id, sku, String(ordered), String(fulfilled), String(ordered - fulfilled), String(stock.get(sku))]
})
const fulfillment = await csv('output/fulfillment.csv')
assert.deepEqual(fulfillment.header, ['order_id', 'sku', 'ordered', 'fulfilled', 'backordered', 'stock_after'])
assert.deepEqual(fulfillment.rows, expectedFulfillment)
const payments = (await csv('data/payments.csv')).rows
const seen = new Map()
const received = new Map(orders.map(([id]) => [id, 0]))
for (const [id, orderId, rawAmount] of payments) {
  const amount = Number(rawAmount)
  if (seen.has(id)) {
    assert.deepEqual(seen.get(id), [orderId, amount])
    continue
  }
  seen.set(id, [orderId, amount])
  assert.ok(received.has(orderId))
  received.set(orderId, received.get(orderId) + amount)
}
const expectedReceivables = orders.map(([id, , quantity, unitPrice]) => {
  const invoice = Number(quantity) * Number(unitPrice)
  const paid = received.get(id)
  return [id, String(invoice), String(paid), String(invoice - paid)]
})
const receivables = await csv('output/receivables.csv')
assert.deepEqual(receivables.header, ['order_id', 'invoice', 'paid', 'due'])
assert.deepEqual(receivables.rows, expectedReceivables)
const report = await readFile(resolve(here, 'output/reconciliation.txt'), 'utf8')
for (const value of ['11', '10', '1', '355', '240', '115', 'O103', 'P004']) assert.ok(report.includes(value))
console.log('Order files verified. Inspect the Team journal for two workers and the dependent reconciliation.')
