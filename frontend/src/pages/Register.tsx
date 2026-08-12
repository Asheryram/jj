import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { checkPhone } from '../lib/networks'
import { Button, Callout, Card, Field, NetworkChip, Segmented, TextInput, cn } from '../components/ui'
import { AlertIcon, CheckIcon, UsersIcon } from '../components/icons'

type AccountType = 'customer' | 'agent'

/** FR-1.1, FR-1.2, FR-1.6, FR-1.7, NFR-7.3 */
export default function Register() {
  const { login, pushToast } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [accountType, setAccountType] = useState<AccountType>('agent')
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

  const submit = () => {
    const next: Record<string, string> = {}
    if (name.trim().length < 3) next.name = 'Enter your full name as it appears on your ID.'
    if (!phoneCheck?.ok) next.phone = phoneCheck?.ok === false ? phoneCheck.reason : 'Enter your phone number.'
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter an email we can send your receipts to.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (!accepted) next.accepted = 'You need to accept the Terms and Privacy Policy to continue.'

    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    window.setTimeout(() => {
      login(accountType)
      pushToast({
        tone: 'success',
        title: 'Account created',
        detail:
          accountType === 'agent'
            ? 'Your referral code is ready on the Referrals page.'
            : 'Top up your wallet to place your first order.',
      })
      navigate('/app', { replace: true })
    }, 600)
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1.5 text-slate-500">
        Takes under a minute. You do not need an account to buy —{' '}
        <Link to="/" className="font-semibold text-brand-700 hover:underline">
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
            submit()
          }}
        >
          {/* FR-1.6 */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">I am registering as</p>
            <Segmented<AccountType>
              className="w-full"
              options={[
                { value: 'agent', label: 'An agent — I want to sell' },
                { value: 'customer', label: 'A buyer — wallet only' },
              ]}
              value={accountType}
              onChange={setAccountType}
            />
            <p className="mt-2 text-sm text-slate-500">
              {accountType === 'agent'
                ? 'You get your own shop link, set your own prices, and keep the margin on every sale.'
                : 'Optional. Keeps a topped-up balance so you skip the Mobile Money prompt, and saves your order history. You can become an agent later.'}
            </p>
          </div>

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
                className={phoneCheck?.ok ? 'pr-28' : undefined}
              />
              {phoneCheck?.ok && (
                <span className="absolute inset-y-0 right-2.5 flex items-center">
                  <NetworkChip network={phoneCheck.network} />
                </span>
              )}
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
            hint="If an agent invited you, put their code here."
          >
            <TextInput
              id="reg-referral"
              placeholder="KWAME77"
              value={referral}
              onChange={(event) => setReferral(event.target.value.toUpperCase())}
              className="font-mono tracking-wide uppercase"
            />
          </Field>

          {/* NFR-7.3 */}
          <div>
            <button
              type="button"
              onClick={() => setAccepted(!accepted)}
              className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3.5 text-left hover:bg-slate-50"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                  accepted ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300',
                )}
                role="checkbox"
                aria-checked={accepted}
              >
                {accepted && <CheckIcon className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="text-sm leading-relaxed text-slate-600">
                I accept the{' '}
                <span className="font-semibold text-brand-700 underline">Terms of Service</span> and{' '}
                <span className="font-semibold text-brand-700 underline">Privacy Policy</span>, and I
                consent to my details being used to fulfil my orders.
              </span>
            </button>
            {errors.accepted && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-red-600">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                {errors.accepted}
              </p>
            )}
          </div>

          <Button type="submit" block size="lg" loading={busy}>
            Create account
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  )
}
