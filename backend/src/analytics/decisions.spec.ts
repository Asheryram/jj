import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentsSlipping,
  cashAvailable,
  failureCost,
  floatRunway,
  providerSwitch,
  pulse,
  rank,
  sizeGb,
  thinMargins,
  type Listing,
  type ProviderReliability,
} from './decisions'

// Fixtures are production's own figures, 19 Nov 2026.

const mtn = (name: string, provider: string, cost: number, sold: number, active = true): Listing => ({
  productId: `${provider}-${name}`,
  name,
  network: 'MTN',
  category: 'data',
  provider,
  active,
  cost,
  sold,
})
const reliability: ProviderReliability[] = [
  { provider: 'datahub-gh', network: 'MTN', settled: 372, delivered: 362 },
  { provider: 'gmpl', network: 'MTN', settled: 39, delivered: 38 },
]

test('reads the bundle size from either naming style', () => {
  assert.equal(sizeGb('2GB Data'), 2)
  assert.equal(sizeGb('MTN 10GB'), 10)
  assert.equal(sizeGb('TELECEL(8GB)'), 8)
  assert.equal(sizeGb('WAEC checker'), null)
})

test('recommends the cheaper provider for the same bundle when it delivers as well', () => {
  const decision = providerSwitch(
    [
      mtn('2GB Data', 'datahub-gh', 950, 30),
      mtn('MTN 2GB', 'gmpl', 770, 7),
      mtn('5GB Data', 'datahub-gh', 2250, 29),
      mtn('MTN 5GB', 'gmpl', 1925, 7),
    ],
    reliability,
  )
  assert.ok(decision)
  // (950 − 770) × 30 + (2250 − 1925) × 29 = 14,825 over 4 weeks, scaled to 30 days.
  assert.equal(decision.monthlyImpact, Math.round((14_825 * 30) / 28))
  assert.match(decision.title, /GMPL/)
})

test('stays quiet when the cheaper provider is less reliable', () => {
  const shaky: ProviderReliability[] = [reliability[0], { provider: 'gmpl', network: 'MTN', settled: 40, delivered: 34 }]
  assert.equal(providerSwitch([mtn('2GB Data', 'datahub-gh', 950, 30), mtn('MTN 2GB', 'gmpl', 770, 7)], shaky), null)
})

test('stays quiet on too little delivery history to judge', () => {
  const thin: ProviderReliability[] = [reliability[0], { provider: 'gmpl', network: 'MTN', settled: 8, delivered: 8 }]
  assert.equal(providerSwitch([mtn('2GB Data', 'datahub-gh', 950, 30), mtn('MTN 2GB', 'gmpl', 770, 7)], thin), null)
})

test('ignores a cheaper listing that is off sale, and bundles nobody bought', () => {
  assert.equal(
    providerSwitch([mtn('2GB Data', 'datahub-gh', 950, 30), mtn('MTN 2GB', 'gmpl', 770, 0, false)], reliability),
    null,
  )
  assert.equal(providerSwitch([mtn('2GB Data', 'datahub-gh', 950, 0), mtn('MTN 2GB', 'gmpl', 770, 7)], reliability), null)
})

test('a float with under two days left is urgent, under five is this week, more is quiet', () => {
  const decisions = floatRunway([
    { provider: 'gmpl', balance: 8_945, dailySpend: 7_204, emptyFailures: 0, emptyFailureValue: 0 },
    { provider: 'datahub-gh', balance: 9_043, dailySpend: 2_866, emptyFailures: 1, emptyFailureValue: 9_878 },
  ])
  assert.deepEqual(
    decisions.map((d) => [d.id, d.urgency]),
    [
      ['float_runway:gmpl', 'now'],
      ['float_runway:datahub-gh', 'this_week'],
    ],
  )
  assert.match(decisions[1].evidence.join(' '), /run dry 1 time/)
  assert.deepEqual(floatRunway([{ provider: 'gmpl', balance: 100_000, dailySpend: 2_000, emptyFailures: 0, emptyFailureValue: 0 }]), [])
  assert.deepEqual(floatRunway([{ provider: 'gmpl', balance: null, dailySpend: 2_000, emptyFailures: 0, emptyFailureValue: 0 }]), [])
})

test('flags agents who more than halved, not ones holding steady or new', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const decision = agentsSlipping(
    [
      { userId: 'k', name: 'Kwame Bosomefi', phone: '0508732428', prior: 26, recent: 3, profitPerOrder: 341, lastSaleAt: new Date('2026-10-28T11:37:00Z') },
      { userId: 'h', name: 'Henry Kwarteng', phone: '0549400720', prior: 31, recent: 28, profitPerOrder: 277, lastSaleAt: now },
      { userId: 'p', name: 'Paa Kwaku', phone: '0200000000', prior: 0, recent: 9, profitPerOrder: 200, lastSaleAt: now },
      { userId: 's', name: 'Sheila Tsiantey', phone: '0537121770', prior: 5, recent: 1, profitPerOrder: 131, lastSaleAt: null },
    ],
    now,
  )
  assert.ok(decision)
  assert.match(decision.title, /Call 2 agents/)
  assert.match(decision.evidence[0], /Kwame Bosomefi .* 26 → 3 sales, nothing for 22 days/)
  assert.equal(decision.monthlyImpact, Math.round((((26 - 3) * 341 + (5 - 1) * 131) * 30) / 28))
})

test('suggests a price for bundles that keep under 9%, worth it at the same volume', () => {
  const decision = thinMargins([
    { productId: 'a', name: '10GB Data', network: 'MTN', provider: 'datahub-gh', sold: 12, avgSale: 4686, avgProfit: 407, cost: 4300 },
    { productId: 'b', name: '2GB Data', network: 'MTN', provider: 'datahub-gh', sold: 30, avgSale: 1116, avgProfit: 169, cost: 950 },
    { productId: 'c', name: '20GB Data', network: 'MTN', provider: 'datahub-gh', sold: 2, avgSale: 8702, avgProfit: 493, cost: 8200 },
  ])
  assert.ok(decision)
  // 10GB only: 2GB keeps 15%, and 20GB sold too few to judge.
  assert.match(decision.title, /^1 bundle/)
  // 12% of 46.86 is 5.62; it keeps 4.07, so +1.56, rounded up to the next 10 pesewas.
  assert.match(decision.evidence[0], /\+GHS 1\.60/)
})

test('failed orders: quiet below three, otherwise the costliest reason first', () => {
  assert.equal(failureCost([{ reason: 'Insufficient balance', orders: 2, cost: 100, value: 5000 }]), null)
  const decision = failureCost([
    { reason: 'No reply from the provider', orders: 4, cost: 3083, value: 7228 },
    { reason: 'Insufficient balance', orders: 1, cost: 193, value: 9878 },
    { reason: '0257979113 is not added to our beneficiary list', orders: 1, cost: 270, value: 8705 },
  ])
  assert.ok(decision)
  // Most often by count: four with no confirmation beat one costly float failure.
  assert.match(decision.title, /6 paid orders failed .* never confirmed/)
})

test('cash: holds back in-flight orders and a week of float, warns when below zero', () => {
  const safe = cashAvailable({ freeToSpend: 60_084, inFlightWorstCase: 7_970, dailyFloatSpend: 3_000 })
  assert.ok(safe)
  // 600.84 − 79.70 − 210.00 = 311.14, rounded down to the nearest GHS 10.
  assert.match(safe.title, /GHS 310\.00/)
  assert.equal(cashAvailable({ freeToSpend: 20_000, inFlightWorstCase: 0, dailyFloatSpend: 3_000 }), null)
  const owing = cashAvailable({ freeToSpend: -5_000, inFlightWorstCase: 0, dailyFloatSpend: 0 })
  assert.equal(owing?.urgency, 'now')
})

test('ranks urgent first, then by money', () => {
  const base = { evidence: [], action: { label: '', to: '' } }
  const ranked = rank([
    { ...base, id: 'a', kind: 'thin_margin', urgency: 'when_you_can', title: '', monthlyImpact: 9_000 },
    null,
    { ...base, id: 'b', kind: 'agents_slipping', urgency: 'this_week', title: '', monthlyImpact: 1_000 },
    { ...base, id: 'c', kind: 'provider_switch', urgency: 'this_week', title: '', monthlyImpact: 30_000 },
    { ...base, id: 'd', kind: 'float_runway', urgency: 'now', title: '', monthlyImpact: null },
    { ...base, id: 'e', kind: 'float_runway', urgency: 'this_week', title: '', monthlyImpact: null },
  ])
  assert.deepEqual(
    ranked.map((d) => d.id),
    ['d', 'e', 'c', 'b', 'a'],
  )
})

test('pulse compares last week with the four before it', () => {
  const week = (w: string, sales: number, profit: number) => ({ week: w, sales, profit, ownShop: 0, agents: sales, activeAgents: 7 })
  const p = pulse([
    week('2026-10-12', 130_336, 16_324),
    week('2026-10-19', 121_997, 14_038),
    week('2026-10-26', 85_561, 11_917),
    week('2026-11-02', 89_001, 12_079),
    week('2026-11-09', 86_002, 13_790),
  ])
  assert.ok(p)
  assert.equal(Math.round((p.salesChange ?? 0) * 100), -19)
  assert.equal(Math.round((p.profitChange ?? 0) * 100), 1)
})
