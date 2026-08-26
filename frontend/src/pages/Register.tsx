import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { checkPhone } from '../lib/networks'
import { Button, Callout, Card, Field, TextInput, cn } from '../components/ui'
import { AlertIcon, CheckIcon, StoreIcon, UsersIcon } from '../components/icons'

/**
 * Only agents register.
 *
 * A buyer needs no account: they enter a number, pay with Mobile Money, and the
 * bundle goes where they said. The buyer option existed to hold a wallet, and a
 * wallet is somebody else's money parked on the platform — a balance to top up,
 * reconcile and refund, in exchange for skipping one Mobile Money prompt.
 * Deferred, not deleted: the role and its ledger are still in the schema.
 */
type AccountType = 'agent'

/** FR-1.1, FR-1.2, FR-1.6, FR-1.7, NFR-7.3 */
export default function Register() {
  const { register, pushToast } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Fixed: this page only creates agents.
  const accountType: AccountType = 'agent'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // FR-1.2 — a referral link pre-fills this and it stays editable.
  const [referral, setReferral] = useState(params.get('ref') ?? '')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const phoneCheck = phone.trim() ? checkPhone(phone) : null

  const submit = async () => {
    const next: Record<string, string> = {}
    if (name.trim().length < 3) next.name = 'Enter your full name as it appears on your ID.'
    if (!phoneCheck?.ok) next.phone = phoneCheck?.ok === false ? phoneCheck.reason : 'Enter your phone number.'
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter an email we can send your receipts to.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (!accepted) next.accepted = 'You need to accept the Terms and Privacy Policy to continue.'

    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)

    try {
      await register({
        name: name.trim(),
        // Normalised, so +233 and 0-prefixed forms both reach the API as
        // 0XXXXXXXXX. The validation above guarantees `ok` here.
        phone: phoneCheck?.ok ? phoneCheck.phone : phone.replace(/\D/g, ''),
        email: email.trim(),
        password,
        accountType,
        referralCode: referral.trim() || undefined,
      })

      pushToast({
        tone: 'success',
        title: 'Application sent',
        // An agent is not live until approved, and saying "account created" would
        // send them looking for a shop link that does not work yet.
        detail: 'We will email you as soon as it is approved.',
      })
      navigate('/app', { replace: true })
    } catch (caught) {
      // A duplicate number or an unknown referral code both land here, and the
      // API already phrased them for this reader. Attach to the field it is
      // about so the fix is where the eye already is.
      const message =
        caught instanceof Error ? caught.message : 'We could not create your account.'
      const field = /referral/i.test(message)
        ? 'referral'
        : /phone|number/i.test(message)
          ? 'phone'
          : /email/i.test(message)
            ? 'email'
            : 'form'
      setErrors({ [field]: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Create your account</h1>
      <p className="mt-1.5 text-slate-500 dark:text-slate-400">
        Takes under a minute. You do not need an account to buy —{' '}
        <Link to="/" className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
          the shop is open to everyone
        </Link>
        . Register if you want to sell, or to keep a wallet balance.
      </p>

      {referral && (
        <div className="mt-5">
          <Callout tone="success" icon={<UsersIcon className="size-4" />} title="You were invited">
            You are signing up under referral code{' '}
            <strong className="font-mono font-bold">{referral.toUpperCase()}</strong>. They will see
            you in their agent list.
          </Callout>
        </div>
      )}

      <Card className="mt-5 p-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {/* FR-1.6. No account-type choice any more: this page exists to sign up
              agents, and buying needs no account at all. */}
          <Callout tone="info" icon={<StoreIcon className="size-4" />}>
            <p>
              <strong className="font-semibold">This is for agents.</strong> You get your own shop
              link, set your own prices, and keep the margin on every sale.
            </p>
            <p className="mt-1.5">
              Just buying a bundle? You do not need an account —{' '}
              <Link to="/shop" className="font-semibold underline">
                go straight to the shop
              </Link>{' '}
              and pay with Mobile Money.
            </p>
          </Callout>

          <Field label="Full name" htmlFor="reg-name" error={errors.name}>
            <TextInput
              id="reg-name"
              autoComplete="name"
              placeholder="Kwame Boateng"
              invalid={Boolean(errors.name)}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field
            label="Phone number"
            htmlFor="reg-phone"
            error={errors.phone}
            hint="This is also your login and where we send order confirmations."
          >
            <div className="relative">
              <TextInput
                id="reg-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="024 000 0000"
                invalid={Boolean(errors.phone)}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </Field>

          <Field label="Email address" htmlFor="reg-email" error={errors.email}>
            <TextInput
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              invalid={Boolean(errors.email)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="reg-password"
            error={errors.password}
            hint="At least 8 characters."
          >
            <TextInput
              id="reg-password"
              type="password"
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Field
            label="Referral code (optional)"
            htmlFor="reg-referral"
            error={errors.referral}
            hint="If an agent invited you, put their code here."
          >
            <TextInput
              id="reg-referral"
              placeholder="KWAME77"
              invalid={Boolean(errors.referral)}
              value={referral}
              onChange={(event) => setReferral(event.target.value.toUpperCase())}
              className="font-mono tracking-wide uppercase"
            />
          </Field>

          {/* Anything the server rejected that does not belong to one field. */}
          {errors.form && (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {errors.form}
            </Callout>
          )}

          {/* NFR-7.3 */}
          <div>
            <button
              type="button"
              onClick={() => setAccepted(!accepted)}
              className="flex w-full items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                  accepted ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600',
                )}
                role="checkbox"
                aria-checked={accepted}
              >
                {accepted && <CheckIcon className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                I accept the{' '}
                <span className="font-semibold text-brand-700 dark:text-brand-300 underline">Terms of Service</span> and{' '}
                <span className="font-semibold text-brand-700 dark:text-brand-300 underline">Privacy Policy</span>, and I
                consent to my details being used to fulfil my orders.
              </span>
            </button>
            {errors.accepted && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                {errors.accepted}
              </p>
            )}
          </div>

          <Button type="submit" block size="lg" loading={busy}>
            Create account
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  )
}
