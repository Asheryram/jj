import test from 'node:test'
import assert from 'node:assert/strict'
import { DatahubClient } from './datahub.client'

/**
 * `orderStatus` picks how to ask DataHub (by order number or by reference)
 * from the shape of what it was given. Stubs the one HTTP call so the
 * routing itself is what is under test.
 */
function clientAnswering(known: Record<string, 'orderNumber' | 'reference'>) {
  const asked: string[] = []
  const client = Object.create(DatahubClient.prototype) as DatahubClient
  ;(client as unknown as { orderStatusBy: (p: string, v: string) => Promise<unknown> }).orderStatusBy = async (param, value) => {
    asked.push(`${param}=${value}`)
    return known[value] === param ? { kind: 'found', providerStatus: 'PROCESSING', raw: {} } : { kind: 'not_found' }
  }
  return { client, asked }
}

test('an all-digit reference DataHub knows by reference is still found', async () => {
  const { client, asked } = clientAnswering({ '10535899': 'reference' })
  const result = await client.orderStatus('10535899')
  assert.equal(result.kind, 'found')
  assert.deepEqual(asked, ['orderNumber=10535899', 'reference=10535899'])
})

test('an order number typed from the dashboard is found by order number, in one call', async () => {
  const { client, asked } = clientAnswering({ '2149088983': 'orderNumber' })
  assert.equal((await client.orderStatus('2149088983')).kind, 'found')
  assert.deepEqual(asked, ['orderNumber=2149088983'])
})

test('a manual-queue reference is asked by its order number first', async () => {
  const { client, asked } = clientAnswering({ '2149088983': 'orderNumber' })
  assert.equal((await client.orderStatus('manual_2149088983_1700000000')).kind, 'found')
  assert.deepEqual(asked, ['orderNumber=2149088983'])
})

test('a reference DataHub does not know at all is still not found', async () => {
  const { client, asked } = clientAnswering({})
  assert.equal((await client.orderStatus('10535899')).kind, 'not_found')
  assert.equal(asked.length, 2)
})

test('a plain non-numeric reference is asked by reference only', async () => {
  const { client, asked } = clientAnswering({ 'DH-abc123': 'reference' })
  assert.equal((await client.orderStatus('DH-abc123')).kind, 'found')
  assert.deepEqual(asked, ['reference=DH-abc123'])
})
