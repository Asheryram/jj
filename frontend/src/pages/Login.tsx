import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { Button, Callout, Card, Field, TextInput } from '../components/ui'
import { AlertIcon } from '../components/icons'
import { isAdmin } from '../lib/roles'

/**
 * FR-1.3.
 *
 * Logging in is for people who sell or administer, not for people who buy —
 * buying needs no account (FR-4.8). The destination comes from the role inside
 * the token, so there is no role picker: the server decides what you are.
 */
export default function Login() {
  const { login } = useStore()
  const navigate = useNavigate()
  const shopPath = useShopPath()
  const registerPath = useRegisterPath()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.')
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('That does not look like an email address.')
      return
    }

    setError('')
    setBusy(true)

    try {
      // Trimmed and lowercased here as well as server-side: a phone keyboard
      // will happily capitalise the first letter of an address.
      const session = await login(email.trim().toLowerCase(), password)
      navigate(isAdmin(session.role) ? '/admin' : '/app', { replace: true })
    } catch (caught) {
      // The API's message is already written for this reader (NFR-4.3).
      setError(
        caught instanceof Error
          ? caught.message
          : 'We could not sign you in. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Welcome back</h1>
      <p className="mt-1.5 text-slate-500 dark:text-slate-400">
        For agents and admin. If you just want to buy a bundle,{' '}
        <Link to={shopPath('/')} className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
          go straight to the shop
        </Link>{' '}
        — no account needed.
      </p>

      <Card className="mt-6 p-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="Email address" htmlFor="login-email">
            <TextInput
              id="login-email"
              type="email"
              // `email` keyboard and no auto-capitalisation: on a phone the
              // default would capitalise the first letter of the address.
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              invalid={Boolean(error)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="login-password">
            <TextInput
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error && (
            <Callout tone="danger" icon={<AlertIcon className="size-4" />}>
              {error}
            </Callout>
          )}

          <Button type="submit" block size="lg" loading={busy}>
            Log in
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          {/* FR-1.4. This was a button wired to nothing — it looked like a working
              reset and was the reason nobody noticed there was not one. */}
          <Link to={shopPath('/forgot-password')} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">
            Forgot password?
          </Link>
          <Link to={registerPath} className="font-medium text-brand-700 dark:text-brand-300 hover:underline">
            Create an account
          </Link>
        </div>
      </Card>
    </div>
  )
}
