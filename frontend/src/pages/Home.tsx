import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { cedis } from '../lib/format'
import Catalogue from '../components/Catalogue'
import { Badge, Button, Card, cn } from '../components/ui'
import {
  CertificateIcon,
  CheckIcon,
  ShieldIcon,
  TrendUpIcon,
  UsersIcon,
  WalletIcon,
} from '../components/icons'

const AGENT_BENEFITS = [
  {
    icon: TrendUpIcon,
    title: 'Your price, your profit',
    detail: 'Set a resale price per product, anywhere above what you pay.',
  },
  {
    icon: UsersIcon,
    title: 'Sell with a link',
    detail: 'Share your shop. Customers pay directly and your margin is credited to you.',
  },
  {
    icon: WalletIcon,
    title: 'Withdraw to MoMo',
    detail: 'No float to fund, no stock to carry. Take your earnings out whenever you like.',
  },
]

/**
 * The front door is the shop.
 *
 * Most people arriving here want a bundle in under a minute, and nobody needs
 * an account to get one (FR-4.8). So the catalogue is the first thing on the
 * page; the pitch for becoming an agent sits below it, where someone who came
 * to sell rather than buy will still find it.
 */
export default function Home() {
  const { products, retailPrice, sellerName, sellerCode } = useStore()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()

  // The agent-margin example is driven by real catalogue data so it can never
  // drift from what an agent actually sees.
  const example = products.find((p) => p.id === 'mtn-data-5gb')
  const exampleCost = example?.adminPrice ?? 0
  const exampleSale = example ? retailPrice(example, 'KWAME77') : 0
  const exampleMargin = exampleSale - exampleCost

  return (
    <>
      {/* ── Slim hero. Enough to say what this is, not enough to delay a purchase. ── */}
      <section className="border-b border-slate-200 dark:border-slate-700 bg-brand-700">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-xl">
              <Badge tone="onBrand">
                MTN · Telecel · AirtelTigo
              </Badge>
              <h1 className="mt-3 text-2xl leading-tight font-extrabold tracking-tight text-white sm:text-3xl">
                {sellerName && sellerCode
                  ? `Buy from ${sellerName}`
                  : 'Data, airtime and result checkers in about ten seconds.'}
              </h1>
              <p className="mt-2 text-brand-50/90">
                Pick a bundle, enter the number, pay with Mobile Money.{' '}
                <strong className="font-semibold text-white">No account needed.</strong>
              </p>
            </div>
            <dl className="flex gap-6">
              {[
                ['12,400+', 'orders delivered'],
                ['340+', 'active agents'],
                ['~9s', 'average delivery'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-lg font-bold text-white sm:text-xl">{value}</dt>
                  <dd className="mt-0.5 text-xs text-brand-100/80">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── The shop, immediately. ── */}
      <section className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Catalogue />
      </section>

      {/* ── Reassurance, once they have seen prices. ── */}
      <section className="mx-auto max-w-6xl px-4 pb-10">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="flex items-start gap-3 p-4">
            <ShieldIcon className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong className="block font-semibold text-slate-900 dark:text-slate-50">Payments via Paystack</strong>
              MTN MoMo, Telecel Cash, AirtelTigo Money and cards. We never see your card details.
            </p>
          </Card>
          <Card className="flex items-start gap-3 p-4">
            <WalletIcon className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong className="block font-semibold text-slate-900 dark:text-slate-50">Failed order? Refunded.</strong>
              If a bundle does not reach the number, your money comes straight back.
            </p>
          </Card>
          <Card className="flex items-start gap-3 p-4">
            <CertificateIcon className="size-5 shrink-0 text-brand-600 dark:text-brand-300" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong className="block font-semibold text-slate-900 dark:text-slate-50">
                Checkers: independent reseller
              </strong>
              We sell genuine vouchers but are not affiliated with WAEC.
            </p>
          </Card>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
            Four steps, every time
          </h2>
          <ol className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Pick the bundle', 'Prices are shown up front, before anything else.'],
              ['Enter the number', 'We detect the network and confirm it back to you.'],
              ['Pay', 'Mobile Money prompt on your phone. Handled by Paystack.'],
              ['Delivered', 'On screen and by SMS, usually under ten seconds.'],
            ].map(([title, detail], index) => (
              <li key={title}>
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <p className="mt-3 font-semibold text-slate-900 dark:text-slate-50">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{detail}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            Bought something already?{' '}
            <Link to={shopPath('/track')} className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
              Track your order
            </Link>{' '}
            with your reference and phone number.
          </p>
        </div>
      </section>

      {/* ── For people who came to sell, not buy (FR-1.6) ── */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <Badge tone="brand">Want to sell?</Badge>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
              Become an agent. Set your own prices.
            </h2>
            <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">
              You get your own shop link to share. Customers buy at your prices and pay directly —
              you never handle the money or carry any stock. The difference between your price and
              what you pay is yours the moment the order completes.
            </p>
            <ul className="mt-6 space-y-3.5">
              {AGENT_BENEFITS.map((benefit) => (
                <li key={benefit.title} className="flex gap-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
                    <benefit.icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-semibold text-slate-900 dark:text-slate-50">{benefit.title}</span>
                    <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{benefit.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={registerPath}>
                <Button size="lg">Create an agent account</Button>
              </Link>
              <Link to={shopPath('/login')}>
                <Button size="lg" variant="outline">
                  Agent log in
                </Button>
              </Link>
            </div>
          </div>

          {/* Margin illustration, from the real catalogue */}
          <Card className="p-5">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Example — {example ? example.name : 'MTN 5GB'}
            </p>
            <div className="mt-4 space-y-3">
              <Row label="Your agent price" value={cedis(exampleCost)} />
              <Row label="You charge your customer" value={cedis(exampleSale)} strong />
              <div className="border-t border-dashed border-slate-200 dark:border-slate-700 pt-3">
                <Row
                  label="Your profit per order"
                  value={cedis(exampleMargin)}
                  tone="brand"
                  strong
                />
              </div>
            </div>
            <div className="mt-5 space-y-2.5">
              <div className="rounded-xl bg-brand-50 dark:bg-brand-900/40 p-3.5 text-sm text-brand-900 dark:text-brand-200">
                Sell 20 of these a day and that is{' '}
                <strong className="font-bold">{cedis(exampleMargin * 20)}</strong> in daily profit.
              </div>
              <ul className="space-y-1.5">
                {[
                  'No float to fund, no stock to buy',
                  'Paid the instant each order completes',
                  'Withdraw to MoMo whenever you like',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand-600 dark:text-brand-300" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </section>
    </>
  )
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'brand'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <span
        className={cn(
          'tabular',
          strong ? 'text-lg font-bold' : 'font-semibold',
          tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-900 dark:text-slate-50',
        )}
      >
        {value}
      </span>
    </div>
  )
}
