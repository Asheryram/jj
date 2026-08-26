import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useStore } from '../state/store'
import { Button, Callout, Card, Field, Spinner, TextInput } from '../components/ui'
import { AlertIcon, CheckIcon, ShieldIcon } from '../components/icons'

/** Matches the server. Length only — see SetupTokensService for why. */
const MIN_PASSWORD = 10

/**
 * Choosing your own password from a one-time link.
 *
 * This is how every platform account comes into existence. Nobody is handed a
 * password: the superadmin is announced a link in the server log on first boot,
 * and creates the admin the same way. The person following the link is the only
 * one who ever knows what they typed here.
 *
 * The link is checked before a password field is shown. Typing a new password
 * twice and then being told the link died is a small cruelty that costs nothing
 * to avoid.
 */
export default function SetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { pushToast } = useStore()

  const token = params.get('token') ?? ''
  const [check, setCheck] = useState<
    { valid: boolean; name?: string; purpose?: string } | null
  >(null)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setCheck({ valid: false })
      return
    }
    let live = true
    api
      .checkSetupLink(token)
      .then((result) => live && setCheck(result))
      .catch(() => live && setCheck({ valid: false }))
    return () => {
      live = false
    }
  }, [token])

  const submit = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== again) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await api.setPassword(token, password)
      pushToast({
        tone: 'success',
        title: 'Password set',
        detail: 'Sign in with your email and the password you just chose.',
      })
      navigate('/login', { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not set that password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card className="p-6">
        {check === null ? (
          <div className="py-8 text-center">
            <Spinner className="mx-auto size-6 text-brand-600 dark:text-brand-300" />
          </div>
        ) : !check.valid ? (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">
              <AlertIcon className="size-6" />
            </span>
            <h1 className="mt-4 text-center text-lg font-bold text-slate-900 dark:text-slate-50">
              This link no longer works
            </h1>
            <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-300">
              Setup links expire after 48 hours and stop working once they have been used. Ask
              whoever set up your account for a new one.
            </p>
            <Link to="/login" className="mt-4 block">
              <Button block variant="outline">
                Go to sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
              <ShieldIcon className="size-6" />
            </span>
            <h1 className="mt-4 text-center text-lg font-bold text-slate-900 dark:text-slate-50">
              {check.purpose === 'reset' ? 'Choose a new password' : 'Choose your password'}
            </h1>
            <p className="mt-1.5 text-center text-sm text-slate-600 dark:text-slate-300">
              {check.name ? `Signing in as ${check.name}. ` : ''}
              Nobody else knows this password, including whoever created your account.
            </p>

            <div className="mt-5 space-y-4">
              <Field
                label="New password"
                htmlFor="new-password"
                hint={`At least ${MIN_PASSWORD} characters. A phrase you will remember beats a short complicated one.`}
              >
                <TextInput
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  invalid={Boolean(error)}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError('')
                  }}
                />
              </Field>

              <Field label="Type it again" htmlFor="again-password" error={error}>
                <TextInput
                  id="again-password"
                  type="password"
                  autoComplete="new-password"
                  value={again}
                  invalid={Boolean(error)}
                  onChange={(event) => {
                    setAgain(event.target.value)
                    setError('')
                  }}
                />
              </Field>

              <Callout tone="info" icon={<CheckIcon className="size-4" />}>
                This link stops working as soon as you use it.
              </Callout>

              <Button block loading={busy} onClick={() => void submit()}>
                Set password and sign in
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
