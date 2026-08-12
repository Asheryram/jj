import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import type { Role } from '../data/types'
import { Button, Callout, Card, Field, Segmented, TextInput } from '../components/ui'
import { AlertIcon } from '../components/icons'

/**
 * FR-1.3.
 *
 * Logging in is for people who sell or administer, not for people who buy —
 * buying needs no account (FR-4.8). The role picker exists only because there
 * is no API yet; once the NestJS backend is wired in the role comes back inside
 * the JWT and this control disappears.
 */
export default function Login() {
  const { login } = useStore()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('0551234567')
  const [password, setPassword] = useState('demo1234')
  const [role, setRole] = useState<Role>('agent')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = () => {
    if (!phone.trim() || !password) {
      setError('Enter your phone number and password to continue.')
      return
    }
    setError('')
    setBusy(true)
    window.setTimeout(() => {
      login(role)
      navigate(role === 'admin' ? '/admin' : '/app', { replace: true })
    }, 500)
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
      <p className="mt-1.5 text-slate-500">
        For agents and admin. If you just want to buy a bundle,{' '}
        <Link to="/" className="font-semibold text-brand-700 hover:underline">
          go straight to the shop
        </Link>{' '}
        — no account needed.
      </p>

      <Card className="mt-6 p-5">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Field label="Phone number" htmlFor="login-phone">
            <TextInput
              id="login-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="024 000 0000"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
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

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Demo account type</p>
            <Segmented<Role>
              className="w-full"
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'admin', label: 'Admin' },
              ]}
              value={role}
              onChange={setRole}
            />
          </div>

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
          {/* FR-1.4 */}
          <button type="button" className="font-medium text-brand-700 hover:underline">
            Forgot password?
          </button>
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </div>
      </Card>
    </div>
  )
}
