import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { api } from '../lib/api'
import { Callout, Card, CardHead, Field, Select } from './ui'
import { AlertIcon } from './icons'

const NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'] as const

/**
 * Which supplier fulfils each network's data bundles, the actual routing
 * switch: this changes what a customer is offered. Deliberately a separate
 * control from a provider *filter* (CostPrices.tsx has its own, narrowing
 * which rows the admin is looking at, never changing what's live), the two
 * were conflated in an earlier version, one control in the middle of the
 * price table that both showed and changed routing, which made it hard to
 * just browse one provider's rows without risking a click that switched it.
 *
 * GMPL can't serve AirtelTigo at all (that select is disabled, not just
 * server-refused, so a bad combination is never even offered), and only
 * ever sells `data`, the one category either supplier has real fulfilment
 * for today, so this is the only category worth a picker.
 *
 * Shared between Settings (the reference copy, alongside every other
 * platform-wide switch) and the Prices page (where it's actually useful to
 * see and change at a glance, next to the bundles it governs), rather than
 * two copies of the same fetch/save logic drifting apart.
 */
export function NetworkProviderRouting({ gmplState }: { gmplState?: string }) {
  const { pushToast } = useStore()
  const [routing, setRouting] = useState<Record<string, 'datahub-gh' | 'gmpl'>>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .adminSettings()
      .then((settings) => {
        if (!live) return
        setRouting(settings.networkProviderRouting ?? {})
        setLoaded(true)
      })
      .catch(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [])

  const providerFor = (network: string) => routing[`${network}:data`] ?? 'datahub-gh'

  const save = async (network: string, provider: 'datahub-gh' | 'gmpl') => {
    const next = { ...routing, [`${network}:data`]: provider }
    setSaving(network)
    try {
      const settings = await api.setNetworkProviderRouting(next)
      setRouting(settings.networkProviderRouting ?? next)
      pushToast({ tone: 'success', title: `${network} data bundles now route to ${provider === 'gmpl' ? 'GMPL' : 'DataHub GH'}.` })
    } catch (error) {
      pushToast({ tone: 'error', title: error instanceof Error ? error.message : 'We could not save that.' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card className="mt-3">
      <CardHead
        title="Which supplier sells each network"
        subtitle="Data bundles only, one supplier per network, never both at once."
      />
      <div className="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Takes effect immediately, on the very next storefront load, nobody's own on/off-sale
          choice for either provider is ever touched by switching this: a bundle you've turned off
          stays off, one you've turned on stays on, this only decides which provider's bundles a
          customer is offered for the network.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {NETWORKS.map((network) => {
            const isAirtelTigo = network === 'AirtelTigo'
            return (
              <Field key={network} label={network} htmlFor={`routing-${network}`}>
                <Select
                  id={`routing-${network}`}
                  disabled={!loaded || isAirtelTigo || saving === network}
                  value={isAirtelTigo ? 'datahub-gh' : providerFor(network)}
                  onChange={(event) => void save(network, event.target.value as 'datahub-gh' | 'gmpl')}
                >
                  <option value="datahub-gh">DataHub GH</option>
                  {!isAirtelTigo && <option value="gmpl">GMPL</option>}
                </Select>
              </Field>
            )
          })}
        </div>

        {gmplState && gmplState !== 'live' && (
          <Callout tone="warning" icon={<AlertIcon className="size-4" />}>
            GMPL is {gmplState === 'live-requested-no-key' ? 'misconfigured' : 'simulated'} right
            now. Switching a network to it here takes effect on the storefront immediately, orders
            still go through the simulated path until GMPL_LIVE is set and the server restarted.
          </Callout>
        )}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          GMPL doesn't sell AirtelTigo at all, or anything besides data bundles, so it's the only
          option for AirtelTigo and the only category with a real choice to make.
        </p>
      </div>
    </Card>
  )
}
