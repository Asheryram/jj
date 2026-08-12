import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { cedis } from '../lib/format'
import { Badge, Button, Callout, Card } from '../components/ui'
import { CertificateIcon, CheckIcon, ShieldIcon } from '../components/icons'

/** FR-3.1 (checker category), FR-4.7, NFR-7.1 */
export default function Checkers() {
  const { products, retailPrice } = useStore()
  const checkers = products.filter((p) => p.category === 'checker' && p.active)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <CertificateIcon className="size-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          BECE &amp; WASSCE Result Checkers
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-slate-500">
          Buy a voucher and get the serial number and PIN on screen straight away — plus an SMS copy
          so you do not lose it.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {checkers.map((product) => (
          <Card key={product.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-slate-900">{product.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{product.validity}</p>
              </div>
              <Badge tone="success">In stock</Badge>
            </div>
            <p className="tabular mt-4 text-2xl font-bold text-brand-800">
              {cedis(retailPrice(product))}
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              {[
                'Serial and PIN shown immediately',
                'SMS backup to your number',
                'Works on the official WAEC portal',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand-600" />
                  {line}
                </li>
              ))}
            </ul>
            <Link to={`/buy/${product.id}`} className="mt-5">
              <Button block size="lg">
                Buy {product.name.replace(' Result Checker', '')} checker
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      {/* NFR-7.1 — prominent, not buried. */}
      <div className="mt-6 space-y-3">
        <Callout
          tone="warning"
          title="We are an independent reseller"
          icon={<ShieldIcon className="size-4" />}
        >
          JamesDataConsult is not affiliated with, endorsed by, or acting on behalf of the West
          African Examinations Council (WAEC). We resell genuine vouchers obtained from authorised
          suppliers. WAEC alone controls result availability and the checking portal.
        </Callout>
        <Callout tone="info">
          <strong className="font-semibold">Before you buy:</strong> each voucher allows a limited
          number of result checks, as set by WAEC. Once a serial and PIN have been revealed to you
          they cannot be refunded or exchanged.
        </Callout>
      </div>

      <div className="mt-10">
        <h2 className="font-bold text-slate-900">How it works</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-4">
          {[
            ['Pick BECE or WASSCE', 'Choose the checker you need.'],
            ['Enter your number', 'This is where the SMS copy goes.'],
            ['Pay from your wallet', 'Or top up with MoMo first.'],
            ['Check your result', 'Use the serial and PIN on the WAEC portal.'],
          ].map(([title, detail], index) => (
            <li key={title}>
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">
                {index + 1}
              </span>
              <p className="mt-2.5 text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-0.5 text-sm text-slate-500">{detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
