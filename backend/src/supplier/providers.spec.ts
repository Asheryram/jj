import test from 'node:test'
import assert from 'node:assert/strict'
import { asProvider, isApprovalProvider, KNOWN_PROVIDERS, providerName, PROVIDERS, routingRefusal } from './providers'
import { hasAutomatedFulfilment } from './supplier.service'

/**
 * The registry replaced two-way `provider === 'gmpl' ? … : DataHub` branches.
 * These pin what those branches did for the two existing suppliers, so the
 * refactor changed nothing for them, and that a supplier we do not know is
 * refused instead of being treated as DataHub.
 */

test('a stored provider with no value is DataHub, as for every order before GMPL', () => {
  assert.equal(asProvider(null), 'datahub-gh')
  assert.equal(asProvider(undefined), 'datahub-gh')
  assert.equal(asProvider(''), 'datahub-gh')
  assert.equal(asProvider('gmpl'), 'gmpl')
  assert.equal(asProvider('datahub-gh'), 'datahub-gh')
})

test('a supplier we do not know is refused, never sent to DataHub', () => {
  assert.throws(() => asProvider('acme'), /Unknown supplier "acme"/)
  assert.equal(asProvider('netpulse'), 'netpulse')
})

test('status words read the same as before, per supplier', () => {
  const dh = PROVIDERS['datahub-gh'].mapStatus
  assert.equal(dh('SUCCESSFUL'), 'completed')
  assert.equal(dh('FAILED'), 'failed')
  assert.equal(dh('REFUNDED'), 'failed')
  assert.equal(dh('PROCESSING'), null)
  const gm = PROVIDERS.gmpl.mapStatus
  assert.equal(gm('delivered'), 'completed')
  assert.equal(gm('could_not_deliver'), 'failed')
  assert.equal(gm('received'), null)
  // One supplier's word means nothing to the other.
  assert.equal(dh('delivered'), null)
})

test('only GMPL puts a failed charge back on its own', () => {
  assert.equal(PROVIDERS.gmpl.refundsFailedCharge, true)
  assert.equal(PROVIDERS['datahub-gh'].refundsFailedCharge, false)
})

test('live switches and names are unchanged', () => {
  assert.equal(PROVIDERS['datahub-gh'].liveEnvKey, 'DATAHUB_LIVE')
  assert.equal(PROVIDERS.gmpl.liveEnvKey, 'GMPL_LIVE')
  assert.equal(providerName('datahub-gh'), 'DataHub')
  assert.equal(providerName('gmpl'), 'GMPL')
  assert.equal(PROVIDERS['datahub-gh'].fullLabel, 'DataHub GH')
})

test('routing refuses what GMPL does not sell, and nothing for DataHub', () => {
  assert.match(routingRefusal('gmpl', 'AirtelTigo', 'data') ?? '', /doesn't sell AirtelTigo/)
  assert.match(routingRefusal('gmpl', 'MTN', 'checker') ?? '', /only sells data/)
  assert.equal(routingRefusal('gmpl', 'Telecel', 'data'), null)
  assert.equal(routingRefusal('datahub-gh', 'AirtelTigo', 'data'), null)
  assert.match(routingRefusal('datahub-gh', 'MTN', 'mashup') ?? '', /only sells data/)
})

test('automated fulfilment: GMPL needs a bundle id, DataHub a key and a size', () => {
  assert.equal(hasAutomatedFulfilment({ provider: 'gmpl', networkKey: 'b-1', capacityGb: null }), true)
  assert.equal(hasAutomatedFulfilment({ provider: 'datahub-gh', networkKey: 'YELLO', capacityGb: null }), false)
  assert.equal(hasAutomatedFulfilment({ provider: 'datahub-gh', networkKey: 'YELLO', capacityGb: '3' }), true)
  assert.equal(hasAutomatedFulfilment({ provider: 'gmpl', networkKey: null, capacityGb: null }), false)
})

test('DataHub and GMPL keep the number-approval flow; NetPulse has none', () => {
  assert.equal(isApprovalProvider('datahub-gh'), true)
  assert.equal(isApprovalProvider('gmpl'), true)
  assert.equal(isApprovalProvider('netpulse'), false)
  assert.deepEqual([...KNOWN_PROVIDERS], ['datahub-gh', 'gmpl', 'netpulse'])
})

test('NetPulse: refunds failures, sells all three networks, data, Mashup and checkers', () => {
  const np = PROVIDERS.netpulse
  assert.equal(np.refundsFailedCharge, true)
  assert.equal(np.liveEnvKey, 'NETPULSE_LIVE')
  assert.equal(routingRefusal('netpulse', 'AirtelTigo', 'data'), null)
  assert.equal(routingRefusal('netpulse', 'MTN', 'mashup'), null)
  assert.match(routingRefusal('netpulse', 'MTN', 'airtime') ?? '', /only sells data, mashup and checker/)
  assert.equal(np.mapStatus('completed'), 'completed')
  assert.equal(np.mapStatus('failed'), 'failed')
  assert.equal(np.mapStatus('processing'), null)
  assert.equal(hasAutomatedFulfilment({ provider: 'netpulse', networkKey: '1GB', capacityGb: '1' }), true)
})

test('unrouted: DataHub for data, NetPulse for Mashup, explicit routing wins', async () => {
  const { SettingsService } = await import('../settings/settings.service')
  const settings = Object.create(SettingsService.prototype) as InstanceType<typeof SettingsService>
  assert.equal(settings.providerFor({}, 'MTN', 'data'), 'datahub-gh')
  assert.equal(settings.providerFor({}, 'MTN', 'mashup'), 'netpulse')
  assert.equal(settings.providerFor({ 'MTN:data': 'gmpl' }, 'MTN', 'data'), 'gmpl')
  assert.equal(settings.providerFor({}, null, 'checker'), 'datahub-gh')
})
