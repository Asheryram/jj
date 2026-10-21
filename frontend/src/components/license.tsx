import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminLicenseStatus } from '../lib/api'
import { isAdmin } from '../lib/roles'
import { longDate } from '../lib/format'
import { useShopPath } from '../lib/shopPath'
import { useStore } from '../state/store'
import { useLicense } from '../state/license'
import { AlertIcon, ClockIcon } from './icons'
import { Badge, Button, Callout, Card, CardHead } from './ui'

/**
 * Everything the screens show about the subscription.
 *
 * What a person sees depends on who they are. The admin sees the whole story
 * (when it is due, how to pay, whether anything is actually being blocked).
 * Everyone else sees only what affects them, in plain words, and never that the
 * business is behind on a bill.
 */

const POLL_MS = 5 * 60_000

/** The admin's view, loaded on demand and kept fresh. `null` until it arrives. */
function useAdminLicense(enabled: boolean) {
  const [status, setStatus] = useState<AdminLicenseStatus | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.licenseAdmin())
    } catch {
      // Nothing to show is better than a wrong banner.
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    window.addEventListener('license:refresh', load)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('license:refresh', load)
    }
  }, [enabled, load])

  /** "I have paid": asks the billing server now instead of waiting for the next check. */
  const checkNow = useCallback(async () => {
    setStatus(await api.licenseCheck())
    window.dispatchEvent(new Event('license:refresh'))
  }, [])

  return { status, checkNow }
}

// ------------------------------------------------------------------ banner

/** At the top of every signed-in page. Quiet unless there is something to know. */
export function LicenseBanner() {
  const { session } = useStore()
  const { level } = useLicense()
  const admin = Boolean(session && isAdmin(session.role))
  const { status, checkNow } = useAdminLicense(admin)
  const [checking, setChecking] = useState(false)

  if (!session) return null

  if (!admin) {
    if (level === 'ok') return null
    const message =
      session.role === 'agent'
        ? 'New orders and sign-ups are paused for a short while. Your earnings, withdrawals and sales history are not affected.'
        : 'Mobile Money orders and top-ups are paused for a short while. You can still buy from your wallet balance.'
    return (
      <Shell>
        <Callout tone="info" icon={<ClockIcon className="size-4" />}>
          {message}
        </Callout>
      </Shell>
    )
  }

  if (!status || !status.configured) return null

  if (status.source === 'misconfigured') {
    return (
      <Shell>
        <Callout tone="warning" title="Subscription checking is set up wrongly" icon={<AlertIcon className="size-4" />}>
          The licence settings on the server are incomplete, so nothing is being checked and nothing is blocked. Ask whoever runs the
          server to check <strong className="font-semibold">LICENSE_URL</strong> and{' '}
          <strong className="font-semibold">LICENSE_PUBLIC_KEY</strong>.
        </Callout>
      </Shell>
    )
  }

  // Could not confirm lately. Said once, plainly, and nothing is blocked because of it.
  if (status.stage === 'active' && (status.source === 'stale' || (status.source === 'unverified' && status.lastError))) {
    return (
      <Shell>
        <Callout tone="warning" title="We could not confirm your subscription" icon={<AlertIcon className="size-4" />}>
          The billing server did not answer{status.lastError ? ` (${status.lastError})` : ''}. Nothing is being blocked because of this.
        </Callout>
      </Shell>
    )
  }

  const renewsSoon = status.stage === 'active' && !status.exempt && status.daysUntilDue !== null && status.daysUntilDue <= 14
  if (status.stage === 'active' && !renewsSoon) return null
  if (status.exempt) return null

  const tone = status.stage === 'active' ? 'info' : status.stage === 'grace' ? 'warning' : 'danger'
  const title =
    status.stage === 'active'
      ? 'Your subscription renews soon'
      : status.stage === 'grace'
        ? 'Your subscription is overdue'
        : status.paused
          ? 'Selling is paused: your subscription is overdue'
          : 'Your subscription is overdue'

  const check = async () => {
    setChecking(true)
    try {
      await checkNow()
    } catch {
      // The banner stays as it was; trying again later is fine.
    } finally {
      setChecking(false)
    }
  }

  return (
    <Shell>
      <Callout tone={tone} title={title} icon={<AlertIcon className="size-4" />}>
        <p>{status.message}</p>
        {status.stage !== 'active' && !status.enforced && (
          <p className="mt-1.5 text-xs opacity-90">Report only for now: nothing is being blocked yet.</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {status.payUrl && (
            <a href={status.payUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm">Pay now</Button>
            </a>
          )}
          <Button size="sm" variant="outline" loading={checking} onClick={() => void check()}>
            I have paid, check again
          </Button>
          <Link to="/admin/subscriptions">
            <Button size="sm" variant="ghost">
              See the invoice
            </Button>
          </Link>
        </div>
      </Callout>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-3 pt-3 sm:px-4">{children}</div>
}

// ------------------------------------------------------------------ pause pages

/** Shown in place of a page that would take an order or a sign-up. */
export function PausedNotice({ kind }: { kind: 'buy' | 'signup' }) {
  const shopPath = useShopPath()
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <Card className="p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
          <ClockIcon className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-50">
          {kind === 'buy' ? 'Ordering is paused for a short while' : 'Sign-ups are paused for a short while'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Please try again later. If you have already paid for something, nothing is lost: you can still check on it.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to={shopPath('/track')}>
            <Button>Track your order</Button>
          </Link>
          <Link to={shopPath('/login')}>
            <Button variant="outline">Log in</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}

/** The whole public shop, while it is suspended. Staff can still log in. */
export function ServiceUnavailable() {
  const shopPath = useShopPath()
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <Card className="p-7 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <ClockIcon className="size-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-50">We will be back soon</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          This shop is temporarily unavailable. Please check again a little later.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to={shopPath('/track')}>
            <Button variant="outline">Track an order</Button>
          </Link>
          <Link to={shopPath('/login')}>
            <Button variant="ghost">Staff log in</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}

/**
 * Wraps a public page that sells something.
 *
 *   browse  the shop window: only closes when the whole shop is suspended
 *   buy     checkout: closes as soon as selling is paused
 *   signup  creating an account: closes as soon as selling is paused
 *
 * Only for someone who is not signed in. Signed-in people always get through to
 * the page: the API is the real judge of what they may do (a wallet order still
 * works, a mobile money one is refused with a plain message), and a person
 * should never lose their way to their own account because of it.
 */
export function PauseGate({ kind, children }: { kind: 'browse' | 'buy' | 'signup'; children: ReactNode }) {
  const { session } = useStore()
  const { level } = useLicense()

  if (session) return <>{children}</>
  if (level === 'suspended') return <ServiceUnavailable />
  if (level === 'restricted' && kind !== 'browse') return <PausedNotice kind={kind === 'buy' ? 'buy' : 'signup'} />
  return <>{children}</>
}

// ------------------------------------------------------------------ subscription card

const SOURCE_TEXT: Record<AdminLicenseStatus['source'], string> = {
  disabled: 'Not managed',
  misconfigured: 'Set up wrongly',
  unverified: 'Not heard from the billing server yet',
  live: 'Up to date',
  cached: 'Billing server not answering, using the last answer',
  stale: 'Billing server not answering for too long, ignored',
}

const INTERVAL_TEXT: Record<string, string> = { monthly: 'a month', quarterly: 'every 3 months', yearly: 'a year' }

/** Amounts arrive in pesewas. Falls back to plain digits for a currency the browser does not know. */
function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`
  }
}

function stageBadge(status: AdminLicenseStatus): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!status.configured) return { label: 'Not managed', tone: 'neutral' }
  if (status.exempt) return { label: 'Exempt', tone: 'neutral' }
  if (status.stage === 'grace') return { label: 'Overdue, in grace', tone: 'warning' }
  if (status.stage === 'restricted') return { label: 'Overdue, restricted', tone: 'danger' }
  if (status.stage === 'suspended') return { label: 'Overdue, suspended', tone: 'danger' }
  if (status.daysUntilDue !== null && status.daysUntilDue <= 14) return { label: 'Renews soon', tone: 'warning' }
  return { label: 'Paid up', tone: 'success' }
}

/** How near a subscription's own due date is, for its small badge. */
function subscriptionBadge(item: AdminLicenseStatus['subscriptions'][number]): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (item.mode === 'exempt' || item.mode === 'paused') return { label: item.mode === 'paused' ? 'Paused' : 'Exempt', tone: 'neutral' }
  if (item.stage === 'grace') return { label: 'Overdue, in grace', tone: 'warning' }
  if (item.stage === 'restricted') return { label: 'Overdue, restricted', tone: 'danger' }
  if (item.stage === 'suspended') return { label: 'Overdue, suspended', tone: 'danger' }
  const days = (new Date(item.dueAt).getTime() - Date.now()) / 86_400_000
  return days <= 14 ? { label: 'Renews soon', tone: 'warning' } : { label: 'Paid up', tone: 'success' }
}

/**
 * At the top of the Subscriptions page: the whole bill for THIS app.
 *
 * Everything the app has to keep paying for, how each one stands, and every invoice
 * still waiting, each with its own way to pay. The app as a whole stands at the worst
 * of its subscriptions (one overdue is enough to limit it), and other apps of the same
 * client are separate and are not shown or affected.
 */
export function SubscriptionCard() {
  const { status, checkNow } = useAdminLicense(true)
  const [checking, setChecking] = useState(false)

  if (!status) return null

  const badge = stageBadge(status)
  const check = async () => {
    setChecking(true)
    try {
      await checkNow()
    } catch {
      // Left as it was.
    } finally {
      setChecking(false)
    }
  }

  const { subscriptions, invoices } = status
  const currencies = new Set(invoices.map((invoice) => invoice.currency))
  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)

  const rows: [string, string][] = []
  if (status.configured) {
    if (status.dueAt && !status.exempt) rows.push([status.stage === 'active' ? 'Next payment due' : 'Overdue since', longDate(status.dueAt)])
    if (status.stage !== 'active' && status.graceEndsAt) rows.push(['Everything works until', longDate(status.graceEndsAt)])
    if (status.stage !== 'active' && status.suspendsAt) rows.push(['Public shop pauses from', longDate(status.suspendsAt)])
    rows.push(['What happens when it lapses', status.enforced ? 'New sales pause' : 'Nothing yet (report only)'])
    rows.push(['Billing server', SOURCE_TEXT[status.source]])
    if (status.lastCheckedAt) rows.push(['Last confirmed', longDate(status.lastCheckedAt)])
  }

  return (
    <div data-tour="subscription-card" id="your-subscription">
      <Card className="mt-3">
        <CardHead
          title={status.project ? `${status.project}: what you pay for` : 'What you pay for'}
          subtitle="Everything this app has to keep paying for, the invoices waiting, and what happens if a payment is late."
          action={<Badge tone={badge.tone}>{badge.label}</Badge>}
        />
        <div className="space-y-4 p-4 sm:p-5">
          {!status.configured ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This platform is not tied to a subscription, so nothing is tracked or limited. If it should be, the server needs{' '}
              <strong className="font-semibold">LICENSE_URL</strong> and <strong className="font-semibold">LICENSE_PUBLIC_KEY</strong>.
            </p>
          ) : (
            <>
              {status.message && <p className="text-sm text-slate-700 dark:text-slate-200">{status.message}</p>}

              {/* The bill: every invoice still waiting, each one payable on its own. */}
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                  {invoices.length > 1 ? `Invoices waiting (${invoices.length})` : 'Invoice waiting'}
                </p>
                {invoices.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                    No invoice is waiting. The next one is sent a little before a subscription renews.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {invoices.map((invoice) => {
                      const payUrl = invoice.payUrl ?? status.payUrl
                      return (
                        <div
                          key={invoice.number}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-900/20 px-4 py-3.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
                              Invoice {invoice.number}
                              {invoice.subscription ? ` · ${invoice.subscription}` : ''}
                            </p>
                            <p className="mt-0.5 text-xl font-extrabold text-slate-900 dark:text-slate-50">{money(invoice.amount, invoice.currency)}</p>
                            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                              {invoice.dueDate ? `Due ${longDate(invoice.dueDate)}` : 'Awaiting payment'}
                              {invoice.periodStart && invoice.periodEnd
                                ? `, for ${longDate(invoice.periodStart)} to ${longDate(invoice.periodEnd)}`
                                : ''}
                              {!invoice.subscription && invoice.description ? `. ${invoice.description}` : ''}
                            </p>
                          </div>
                          {payUrl && (
                            <a href={payUrl} target="_blank" rel="noopener noreferrer">
                              <Button size="lg">Pay this invoice</Button>
                            </a>
                          )}
                        </div>
                      )
                    })}
                    {invoices.length > 1 && currencies.size === 1 && (
                      <p className="px-1 text-sm text-slate-600 dark:text-slate-300">
                        Total waiting: <strong className="font-semibold text-slate-900 dark:text-slate-50">{money(total, invoices[0].currency)}</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* What it is made of: each subscription and where it stands on its own. */}
              {subscriptions.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">What you pay for</p>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm">
                    {subscriptions.map((item) => {
                      const itemBadge = subscriptionBadge(item)
                      return (
                        <li key={item.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-50">{item.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {money(item.amount, item.currency)} {INTERVAL_TEXT[item.interval] ?? item.interval}
                              {item.mode === 'exempt' || item.mode === 'paused'
                                ? ''
                                : `, ${item.stage === 'active' ? 'renews' : 'was due'} ${longDate(item.dueAt)}`}
                            </p>
                          </div>
                          <Badge tone={itemBadge.tone}>{itemBadge.label}</Badge>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <dl className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3.5 py-2.5">
                    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-50">{value}</dd>
                  </div>
                ))}
              </dl>
              {status.lastError && (
                <p className="text-xs text-amber-700 dark:text-amber-300">Last problem reaching the billing server: {status.lastError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" loading={checking} onClick={() => void check()}>
                  I have paid, check again
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
