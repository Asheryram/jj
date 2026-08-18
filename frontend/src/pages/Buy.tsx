import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { momoLabel, useStore } from '../state/store'
import { useShopPath } from '../lib/shopPath'
import { api } from '../lib/api'
import { cedis, dateTime } from '../lib/format'
import { NETWORKS, checkPhone, prettyPhone } from '../lib/networks'
import type { Network, OrderSplit } from '../data/types'
import { CATEGORY_META } from '../components/categories'
import {
  Badge,
  Button,
  Callout,
  Card,
  CopyField,
  EmptyState,
  Field,
  NetworkChip,
  Spinner,
  Stepper,
  TextInput,
  cn,
} from '../components/ui'
import {
  AlertIcon,
  CertificateIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  ReceiptIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  TrendUpIcon,
  WalletIcon,
  XIcon,
} from '../components/icons'

const STEPS = ['Bundle', 'Number', 'Confirm', 'Done']

/**
 * NFR-4.2 — four steps, and the stepper says so out loud. Step 1 is already
 * satisfied by arriving here with a product chosen.
 *
 * Works signed in or as a guest (FR-4.8): a customer arriving on an agent's
 * sell link must be able to buy without creating an account, or the sell link
 * is worthless.
 */
export default function Buy() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const {
    products,
    session,
    sellerCode,
    sellerName,
    customerBalance,
    retailPrice,
    previewSplit,
    placeOrder,
    watchOrder,
    orders,
  } = useStore()

  const shopPath = useShopPath()
  const [params] = useSearchParams()

  const product = products.find((p) => p.id === productId)

  const [step, setStep] = useState(1)
  const [recipient, setRecipient] = useState('')
  const [touched, setTouched] = useState(false)
  const [ownNumber, setOwnNumber] = useState(true)
  const [buyerPhone, setBuyerPhone] = useState('')
  const [payChoice, setPayChoice] = useState<'wallet' | 'momo' | null>(null)
  const [momoNetwork, setMomoNetwork] = useState<Network>('MTN')
  const [orderId, setOrderId] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [failure, setFailure] = useState('')
  /**
   * Whether this number needs the provider's one-time setup before it can
   * receive anything.
   *
   * Informational, never a block. It used to stop the sale outright, on the
   * reasoning that DataHub refuses to deliver to an unapproved number — true,
   * but the wrong response to it: it turned away every first-time MTN customer
   * with a message about somebody else's approved list. The order is taken and
   * held instead, and this just sets the expectation before they pay.
   */
  const [checking, setChecking] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const placed = useMemo(
    () => (orderId ? orders.find((o) => o.id === orderId) : undefined),
    [orderId, orders],
  )

  /**
   * Re-enter at the receipt: /buy/:productId?order=<id>.
   *
   * Used by the return trip from Paystack, so a paid order lands on the same
   * receipt — with the same delivery watching and the same wording — as one paid
   * from the wallet. The alternative was a second copy of this screen on the
   * payment page, which would drift out of step with this one.
   */
  const resumeId = params.get('order')
  useEffect(() => {
    if (!resumeId || orderId) return
    setOrderId(resumeId)
    setStep(3)
    watchOrder(resumeId)
  }, [resumeId, orderId, watchOrder])

  if (!product) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card>
          <EmptyState
            icon={<SearchIcon className="size-6" />}
            title="We could not find that bundle"
            detail="It may have been removed or renamed. Pick another from the shop."
            action={
              <Link to={shopPath('/shop')}>
                <Button>Back to shop</Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  // The seller is whoever's link the buyer arrived through. An agent shopping
  // in their own store sells to themselves, which nets them down to cost.
  const effectiveSeller = sellerCode ?? (session?.role === 'agent' ? session.referralCode : null)
  const price = retailPrice(product, effectiveSeller)
  const split = previewSplit(product, effectiveSeller)
  const myShare = split.shares.find((s) => s.userId === session?.id)

  const check = recipient.trim() ? checkPhone(recipient) : null

  const receiptCheck = ownNumber ? check : buyerPhone.trim() ? checkPhone(buyerPhone) : null

  const isCustomer = session?.role === 'customer'
  const canUseWallet = isCustomer && customerBalance >= price
  const meta = CATEGORY_META[product.category]
  const isChecker = product.category === 'checker'

  // The wallet is the default whenever it can cover the order — that is the
  // whole point of NFR-4.2. Derived rather than stored, so it stays correct if
  // the price or the balance changes underneath.
  const payWith = payChoice ?? (canUseWallet ? 'wallet' : 'momo')
  const walletShort = isCustomer && customerBalance < price

  const confirm = async () => {
    if (!check?.ok) return
    if (!ownNumber && !receiptCheck?.ok) return
    if (placing) return // guard the double-tap before the request even leaves

    const phone = ownNumber ? check.phone : (receiptCheck as { phone: string }).phone
    setPlacing(true)
    setFailure('')

    try {
      const order = await placeOrder({
        product,
        recipient: check.phone,
        buyerName: session?.name ?? 'Guest',
        buyerPhone: phone,
        payWith,
        sellerCode: effectiveSeller,
      })
      if (order.paymentUrl) {
        // Off to Paystack to actually pay. `replace` rather than `assign` so the
        // back button does not land them on a confirm screen for an order that
        // already exists — they would place a second one.
        //
        // The reference is remembered because the return trip carries only that,
        // and the receipt has to be findable again afterwards.
        window.sessionStorage.setItem(
          'jdc.pendingOrder',
          JSON.stringify({ orderId: order.id, productId: product.id }),
        )
        window.location.replace(order.paymentUrl)
        return
      }

      setOrderId(order.id)
      setStep(3)
    } catch (caught) {
      // Nothing was charged — the server places the order and debits inside one
      // transaction. Stay on the confirm screen so the buyer can adjust and retry.
      setFailure(
        caught instanceof Error
          ? caught.message
          : 'We could not place that order. Please try again.',
      )
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6 sm:py-8">
      {/* Every page needs exactly one h1. Checkout leads with the stepper
          visually, so the heading is present for assistive tech and search
          engines without competing with it on screen. */}
      <h1 className="sr-only">
        Buy {product.name}
        {product.network ? ` on ${product.network}` : ''} — checkout
      </h1>
      <button
        type="button"
        onClick={() => (step <= 1 || step === 3 ? navigate(shopPath('/shop')) : setStep(step - 1))}
        className="mb-4 -ml-1 flex items-center gap-1 rounded-lg px-1 py-1 text-sm font-semibold text-slate-500 hover:text-slate-800"
      >
        <ChevronLeftIcon className="size-4" />
        {step <= 1 || step === 3 ? 'Back to shop' : 'Back'}
      </button>

      <Stepper steps={STEPS} current={step} />

      {/* Bundle summary, always visible so the buyer can see what they picked */}
      <Card className="mt-5 p-4">
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl',
              meta.accent,
            )}
          >
            <meta.icon className="size-5.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{product.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <NetworkChip network={product.network} />
              <span className="text-sm text-slate-500">{product.validity}</span>
            </div>
          </div>
          <p className="tabular shrink-0 text-lg font-bold text-brand-800">{cedis(price)}</p>
        </div>
        {sellerName && sellerCode && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Sold by <strong className="font-semibold text-slate-700">{sellerName}</strong>, an
            authorised agent.
          </p>
        )}
      </Card>

      {/* ── Step 2: recipient number (FR-4.1, FR-4.2) ── */}
      {step === 1 && (
        <Card className="mt-3 p-5">
          <Field
            label={isChecker ? 'Phone number for the voucher SMS' : 'Recipient phone number'}
            htmlFor="recipient"
            error={touched && check?.ok === false ? check.reason : undefined}
            hint={
              isChecker
                ? 'We send the serial and PIN here, and show them on screen.'
                : 'The number that will receive this bundle.'
            }
          >
            <div className="relative">
              <TextInput
                id="recipient"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="024 000 0000"
                value={recipient}
                invalid={touched && check?.ok === false}
                onChange={(event) => {
                  setRecipient(event.target.value)
                  setNeedsSetup(false)
                }}
                onBlur={() => setTouched(true)}
                className="text-lg tracking-wide"
              />
            </div>
          </Field>

          <Button
            block
            size="lg"
            className="mt-4"
            loading={checking}
            disabled={checking || !check?.ok}
            /* `needsSetup` deliberately does NOT disable this. It is something to
               know before paying, not a reason to be turned away. */
            onClick={() => {
              setTouched(true)
              if (!check?.ok) return

              // Ask the provider whether this number is set up yet, purely so
              // the next screen can say so before any money changes hands.
              //
              // Every path advances. Their check covers MTN only and can be
              // unavailable, and neither a "no" nor an outage is a reason to
              // refuse a sale we can hold and complete later.
              setChecking(true)
              setNeedsSetup(false)
              void api
                .verifyRecipient(product.id, check.phone)
                .then((result) => setNeedsSetup(result.checked && !result.verified))
                .catch(() => undefined)
                .finally(() => {
                  setChecking(false)
                  setStep(2)
                })
            }}
          >
            Continue
          </Button>

          {!session && (
            <p className="mt-3 text-center text-sm text-slate-500">
              No account needed. Pay with Mobile Money and we deliver straight away.
            </p>
          )}
        </Card>
      )}

      {/* ── Step 3: confirm. The highest-stakes screen in the product. ── */}
      {step === 2 && check?.ok && (
        <Card className="mt-3 p-5">
          <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Check this carefully
          </p>

          <div className="mt-3 rounded-xl border-2 border-brand-200 bg-brand-50 p-4 text-center">
            <p className="text-sm text-brand-900">Sending to</p>
            <p className="tabular mt-1 text-2xl font-bold tracking-wide text-brand-900">
              {prettyPhone(check.phone)}
            </p>
            <div className="mt-2 flex justify-center">
              <NetworkChip network={product.network} />
            </div>
          </div>

          <Callout tone="warning" className="mt-3" icon={<AlertIcon className="size-4" />}>
            Bundles sent to a wrong number cannot be recovered. Confirm the digits above before you
            continue.
          </Callout>

          {/* Said before they pay, not after.
              A first purchase to a number needs a one-time setup with the
              delivery partner, and it is not instant. Nobody should find that
              out from a receipt — but it is also not a reason to stop them, so
              it sits here as something to know, with the refund promise
              attached. */}
          {needsSetup && (
            <Callout
              tone="info"
              className="mt-3"
              title="This number needs a quick one-time setup"
              icon={<ClockIcon className="size-4" />}
            >
              It is the first bundle going to {prettyPhone(check.phone)}, so our delivery partner has
              to set it up before anything can be sent. That usually takes a few hours, and your
              bundle goes out the moment it is ready. If the setup does not complete, your money
              comes back automatically.
            </Callout>
          )}

          {/* Where the receipt goes. Defaults to the recipient so most buyers
              never touch this — it keeps the flow inside its step budget. */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setOwnNumber(!ownNumber)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                  ownNumber ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
                )}
                role="checkbox"
                aria-checked={ownNumber}
              >
                {ownNumber && <CheckIcon className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="text-sm text-slate-600">Send my receipt to this same number</span>
            </button>

            {!ownNumber && (
              <Field
                label="Your number for the receipt"
                htmlFor="buyer-phone"
                className="mt-3"
                error={
                  buyerPhone.trim() && receiptCheck?.ok === false ? receiptCheck.reason : undefined
                }
              >
                <TextInput
                  id="buyer-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="024 000 0000"
                  value={buyerPhone}
                  invalid={Boolean(buyerPhone.trim() && receiptCheck?.ok === false)}
                  onChange={(event) => setBuyerPhone(event.target.value)}
                />
              </Field>
            )}
          </div>

          {/* Payment method */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">How would you like to pay?</p>
            <div className="space-y-2">
              {isCustomer && (
                <PayOption
                  selected={payWith === 'wallet'}
                  disabled={!canUseWallet}
                  onSelect={() => setPayChoice('wallet')}
                  icon={<WalletIcon className="size-4.5" />}
                  title="From my wallet"
                  detail={
                    canUseWallet
                      ? `Balance ${cedis(customerBalance)} — no Mobile Money prompt.`
                      : `Balance ${cedis(customerBalance)} — you need ${cedis(price - customerBalance)} more.`
                  }
                />
              )}
              <PayOption
                selected={payWith === 'momo'}
                onSelect={() => setPayChoice('momo')}
                icon={<ShieldIcon className="size-4.5" />}
                title="Mobile Money"
                detail="You will get a prompt on your phone. Handled by Paystack."
              />
            </div>

            {payWith === 'momo' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {NETWORKS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMomoNetwork(option)}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm font-semibold',
                      momoNetwork === option
                        ? 'border-brand-600 bg-brand-700 text-white'
                        : 'border-slate-200 bg-white text-slate-600',
                    )}
                  >
                    {momoLabel(option)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <dl className="mt-4 space-y-2.5 border-t border-slate-100 pt-4 text-sm">
            <Line label="Product" value={product.name} />
            <Line label="You pay" value={cedis(price)} strong />
            {payWith === 'wallet' && (
              <Line label="Wallet after" value={cedis(customerBalance - price)} />
            )}
            {/* An agent buying through their own shop gets their margin back. */}
            {myShare && myShare.margin > 0 && (
              <Line
                label="Comes back to you as earnings"
                value={cedis(myShare.margin, { sign: true })}
                tone="brand"
              />
            )}
            {myShare && myShare.margin > 0 && (
              <Line label="Your net cost" value={cedis(price - myShare.margin)} strong />
            )}
          </dl>

          {/* FR-2.5 + NFR-4.3 — the wallet cannot cover this, said plainly, with
              both ways forward rather than a dead end. */}
          {walletShort && (
            <Callout
              tone="warning"
              className="mt-4"
              title="Your wallet cannot cover this"
              icon={<AlertIcon className="size-4" />}
            >
              You have {cedis(customerBalance)} and need {cedis(price - customerBalance)} more. Pay
              with Mobile Money below, or{' '}
              <Link to="/app/wallet" className="font-semibold underline">
                top up your wallet
              </Link>{' '}
              first.
            </Callout>
          )}

          {/* The order was refused before any money moved — an empty wallet, or a
              bundle that went off sale while this screen was open. */}
          {failure && (
            <Callout tone="danger" className="mt-4" icon={<AlertIcon className="size-4" />}>
              {failure}
            </Callout>
          )}

          <div className="mt-4 space-y-2">
            {/* The one highest-emphasis action in the whole product. */}
            <Button
              block
              size="lg"
              variant="cta"
              loading={placing}
              disabled={placing || (!ownNumber && !receiptCheck?.ok)}
              onClick={() => void confirm()}
            >
              Confirm and pay {cedis(price)}
            </Button>
            <Button block variant="ghost" disabled={placing} onClick={() => setStep(1)}>
              Change number
            </Button>
          </div>

          {/* Transparency for people inside the chain; customers never see this. */}
          {session && session.role !== 'customer' && (
            <SplitBreakdown split={split} salePrice={price} youId={session.id} />
          )}
        </Card>
      )}

      {/* ── Step 4: result (FR-4.4, FR-4.5, FR-4.7, FR-2.7) ── */}
      {step === 3 && placed && (
        <>
          {placed.status === 'awaiting_approval' ? (
            /* A first purchase to this number.
               Said without the plumbing: the customer does not have a
               "beneficiary list", has done nothing wrong, and cannot act on any
               of it. What they need is that their money is safe, that the bundle
               is coming, and that they are not required to sit and watch. */
            <Card className="mt-3 p-8 text-center" role="status" aria-live="polite">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <ClockIcon className="size-7" />
              </span>
              <p className="mt-4 font-semibold text-slate-900">
                Setting up {prettyPhone(placed.recipient)}
              </p>
              <p className="mt-1.5 text-sm text-slate-600">
                This is the first bundle sent to this number, so it needs a one-time setup with our
                delivery partner. It usually finishes within a few hours, and your bundle is sent
                the moment it does.
              </p>
              <p className="mt-3 text-sm font-medium text-slate-800">
                Your {cedis(placed.salePrice)} is safe. If the setup does not complete, it comes
                back to you automatically — you do not need to ask.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                You can close this page. We will text {prettyPhone(placed.buyerPhone)} when it is
                delivered.
              </p>
              <p className="tabular mt-4 text-xs text-slate-500">Reference {placed.reference}</p>
            </Card>
          ) : placed.status === 'processing' || placed.status === 'pending' ? (
            /* The status flips from a provider callback, not from a click, so it
               needs announcing (WCAG 4.1.3). */
            <Card className="mt-3 p-8 text-center" role="status" aria-live="polite">
              <Spinner className="mx-auto size-9 text-brand-600" />
              <p className="mt-4 font-semibold text-slate-900">
                Sending to {prettyPhone(placed.recipient)}
              </p>
              <p className="mt-1.5 text-sm text-slate-500">
                {placed.paidWith === 'wallet' ? 'Paid from your wallet.' : 'Payment confirmed.'} We
                are waiting for the network to confirm delivery — this usually takes a few seconds.
              </p>
              <p className="tabular mt-4 text-xs text-slate-500">Reference {placed.reference}</p>
            </Card>
          ) : placed.status === 'completed' ? (
            <Card className="mt-3 overflow-hidden">
              <div className="bg-brand-700 px-5 py-6 text-center text-white">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-white/15">
                  <CheckIcon className="size-7" strokeWidth={2.4} />
                </span>
                <p className="mt-3 text-lg font-bold">{product.name} delivered</p>
                <p className="mt-0.5 text-sm text-brand-100">
                  Sent to {prettyPhone(placed.recipient)}
                </p>
              </div>

              <div className="space-y-4 p-5">
                {/* FR-4.7 — voucher on screen and by SMS, immediately. */}
                {isChecker && placed.voucher && (
                  <div className="space-y-3">
                    <Callout
                      tone="success"
                      title="Your voucher"
                      icon={<CertificateIcon className="size-4" />}
                    >
                      Keep these safe — a checker voucher can only be used a limited number of
                      times. We have also sent them by SMS.
                    </Callout>
                    <CopyField label="Serial number" value={placed.voucher.serial} mono />
                    <CopyField label="PIN" value={placed.voucher.pin} mono />
                  </div>
                )}

                <dl className="space-y-2.5 text-sm">
                  <Line label="Reference" value={placed.reference} />
                  <Line label="Amount paid" value={cedis(placed.salePrice)} strong />
                  <Line label="Time" value={dateTime(placed.createdAt)} />
                  {myShare && myShare.margin > 0 && (
                    <Line
                      label="You earned"
                      value={cedis(myShare.margin, { sign: true })}
                      tone="brand"
                    />
                  )}
                </dl>

                {/* A guest has no order history, so the reference is their only
                    handle on this purchase. Make it easy to keep. */}
                {!session && (
                  <Callout tone="info" title="Keep your reference">
                    Save <strong className="font-mono font-bold">{placed.reference}</strong>. With
                    it and your phone number you can look this order up any time at{' '}
                    <Link to={shopPath('/track')} className="font-semibold underline">
                      /track
                    </Link>
                    .
                  </Callout>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link to={shopPath('/shop')} className="flex-1">
                    <Button block>Buy another</Button>
                  </Link>
                  <Link to={session ? '/app/orders' : '/track'} className="flex-1">
                    <Button block variant="outline">
                      <ReceiptIcon className="size-4" /> {session ? 'My orders' : 'Track order'}
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            /* FR-2.7 + NFR-3.3 — a visible failure, with the money already moving back. */
            <Card className="mt-3 overflow-hidden">
              <div className="bg-red-600 px-5 py-6 text-center text-white">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-white/15">
                  <XIcon className="size-7" strokeWidth={2.4} />
                </span>
                <p className="mt-3 text-lg font-bold">Order could not be delivered</p>
                {/* Deliberately does not name a cause. This used to read "the
                    network rejected it after two attempts", which was invented
                    copy: most failures never reach the network, and there is no
                    retry. Claiming a specific reason we do not have sends the
                    buyer chasing the wrong thing — and sent us chasing it too.
                    The real reason is on the order's dispatch log, for admin. */}
                <p className="mt-0.5 text-sm text-red-100">
                  {placed.refunded
                    ? 'Nothing was lost — your money has been returned.'
                    : 'Nothing was lost — your money is owed back to you.'}
                </p>
              </div>
              <div className="space-y-4 p-5">
                {/* Two different truths, and saying the wrong one is the problem.
                    A refund is authorised by a person now, so until that happens
                    the money is *owed*, not returned — and telling a customer it
                    is already back when it is not is the fastest way to lose
                    their trust twice. */}
                {!placed.refunded ? (
                  <Callout
                    tone="info"
                    title="Your refund is being arranged"
                    icon={<ClockIcon className="size-4" />}
                  >
                    {cedis(placed.salePrice)} is owed back to you and has been logged for approval.
                    Refunds are checked by a person rather than sent automatically, so this usually
                    takes a few hours. You do not need to ask — we will text{' '}
                    <strong className="tabular font-bold">{placed.buyerPhone}</strong> when it is
                    done.
                  </Callout>
                ) : placed.paidWith === 'wallet' ? (
                  <Callout
                    tone="success"
                    title="Refunded to your wallet"
                    icon={<CheckIcon className="size-4" />}
                  >
                    {cedis(placed.salePrice)} has gone back into your wallet. Your balance is now{' '}
                    {cedis(customerBalance)}. Nothing was lost.
                  </Callout>
                ) : (
                  <Callout
                    tone="success"
                    title="Your money is ready to claim"
                    icon={<CheckIcon className="size-4" />}
                  >
                    {cedis(placed.salePrice)} is held as credit against{' '}
                    <strong className="tabular font-bold">{placed.buyerPhone}</strong>. We have sent
                    an SMS with a link to claim it as a wallet balance or have it sent back to your
                    Mobile Money.
                  </Callout>
                )}
                <dl className="space-y-2.5 text-sm">
                  <Line label="Reference" value={placed.reference} />
                  <Line label="Recipient" value={prettyPhone(placed.recipient)} />
                  <Line
                    label={placed.refunded ? 'Returned' : 'Owed back to you'}
                    value={cedis(placed.salePrice)}
                    strong
                  />
                </dl>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    block
                    className="flex-1"
                    onClick={() => {
                      setOrderId(null)
                      setStep(2)
                    }}
                  >
                    <RefreshIcon className="size-4" /> Try again
                  </Button>
                  <Link to={shopPath('/shop')} className="flex-1">
                    <Button block variant="outline">
                      Choose another bundle
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function PayOption({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  detail,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
        selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
          selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
        )}
      >
        {selected && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-sm text-slate-500">{detail}</span>
      </span>
    </button>
  )
}

/** Shows where every pesewa of the sale goes. FR-5.8. */
function SplitBreakdown({
  split,
  salePrice,
  youId,
}: {
  split: OrderSplit
  salePrice: number
  youId: string
}) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <TrendUpIcon className="size-3.5" /> How this {cedis(salePrice)} splits
      </p>
      <ul className="mt-2.5 space-y-1.5 text-sm">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600">DataHub GH (supplier)</span>
          <span className="tabular font-medium text-slate-700">{cedis(split.supplierCost)}</span>
        </li>
        {[...split.shares]
          .sort((a, b) => a.depth - b.depth)
          .map((share) => (
            <li key={share.userId} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-slate-600">{share.name}</span>
                {share.userId === youId && <Badge tone="brand">you</Badge>}
                {share.role === 'admin' && <Badge tone="neutral">platform</Badge>}
              </span>
              <span
                className={cn(
                  'tabular font-semibold',
                  share.userId === youId ? 'text-brand-700' : 'text-slate-700',
                )}
              >
                {cedis(share.margin, { sign: true })}
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'danger' | 'brand'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={cn(
          'tabular text-right',
          strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700',
          tone === 'danger' && 'font-bold text-red-600',
          tone === 'brand' && 'font-bold text-brand-700',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
