import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useShopPath } from '../lib/shopPath'
import { Button, Callout, Card, Field, TextInput } from '../components/ui'
import { AlertIcon, CheckIcon } from '../components/icons'

/**
 * Asking for a password reset link.
 *
 * The confirmation deliberately does not say whether the address has an account.
 * Anything that distinguished "sent" from "no such account" would make this a way
 * to find out who has access to the platform — and this is a form anybody on the
 * internet can submit.
 *
 * That means the wording has to be honest about its own vagueness rather than
 * implying certainty: "if that address has an account" is the true statement, and
 * pretending otherwise leaves somebody waiting for mail that was never sent.
 */
export default function ForgotPassword() {
  const shopPath = useShopPath()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!email.includes('@')) {
      setError('Enter the email address on your account.')
      return
    }

    setBusy(true)
    try {
      await api.forgotPassword(email.trim())
      setSent(true)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not send that just now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="p-6">
        {sent ? (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">
              <CheckIcon className="size-6" />
            </span>
            <h1 className="mt-4 text-center text-lg font-bold text-slate-900 dark:text-slate-50">Check your email</h1>
            <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-300">
              If <strong className="font-semibold">{email.trim()}</strong> has an account here, a
              reset link is on its way to it. The link works once and expires in an hour.
            </p>
            <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">
              Nothing has changed yet — your current password keeps working until you use the link.
            </p>
            <Link to={shopPath('/login')} className="mt-5 block">
              <Button block variant="outline">
                Back to sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Forgotten your password?</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
              Tell us the address you sign in with and we will email you a link to choose a new
              password.
            </p>

            <div className="mt-5 space-y-4">
              <Field label="Your email" htmlFor="forgot-email" error={error}>
                <TextInput
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  invalid={Boolean(error)}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError('')
                  }}
                />
              </Field>

              <Callout tone="info" icon={<AlertIcon className="size-4" />}>
                Buying with Mobile Money needs no account, so there is nothing to reset — this is
                for agents and admins.
              </Callout>

              <Button block loading={busy} onClick={() => void submit()}>
                Email me a link
              </Button>

              <Link to={shopPath('/login')} className="block text-center text-sm font-semibold text-brand-700 dark:text-brand-300">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
