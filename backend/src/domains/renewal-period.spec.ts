import test from 'node:test'
import assert from 'node:assert/strict'
import { renewalPeriodFor } from './renewal-period'

const paidAt = new Date('2026-11-20T10:00:00Z')

test('a domain in grace starts its new cycle when the payment lands', () => {
  const result = renewalPeriodFor(
    { active: true, graceEndsAt: new Date('2026-11-25T00:00:00Z'), nextRenewalAt: new Date('2026-11-18T00:00:00Z'), billingInterval: 'monthly' },
    paidAt,
  )
  assert.equal(result.alreadyPaidUp, false)
  assert.equal(result.periodStart.toISOString(), paidAt.toISOString())
  assert.equal(result.periodEnd.toISOString(), '2026-12-20T10:00:00.000Z')
})

test('a switched-off domain comes back from when it is paid', () => {
  const result = renewalPeriodFor(
    { active: false, graceEndsAt: null, nextRenewalAt: new Date('2026-12-30T00:00:00Z'), billingInterval: 'yearly' },
    paidAt,
  )
  assert.equal(result.alreadyPaidUp, false)
  assert.equal(result.periodEnd.toISOString(), '2027-11-20T10:00:00.000Z')
})

test('a second payment for a domain already paid up buys the next cycle, not nothing', () => {
  const paidUpUntil = new Date('2026-12-20T10:00:00Z')
  const result = renewalPeriodFor({ active: true, graceEndsAt: null, nextRenewalAt: paidUpUntil, billingInterval: 'monthly' }, paidAt)
  assert.equal(result.alreadyPaidUp, true)
  assert.equal(result.periodStart.toISOString(), paidUpUntil.toISOString())
  assert.equal(result.periodEnd.toISOString(), '2027-01-20T10:00:00.000Z')
})
