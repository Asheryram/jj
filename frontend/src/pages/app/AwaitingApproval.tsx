import { Link } from 'react-router-dom'
import { useStore } from '../../state/store'
import { useBranding } from '../../state/branding'
import { Button, Callout, Card } from '../../components/ui'
import { AlertIcon, ClockIcon, StoreIcon } from '../../components/icons'

/**
 * What a new agent sees while their application is waiting.
 *
 * They are deliberately allowed to sign in: refusing the login would tell someone
 * with the right password that it was wrong, and they would try again, and then
 * assume the account was never created. So they get in, and get told exactly where
 * they stand.
 *
 * No selling tools are shown, and that is the honest thing rather than a
 * restriction — a shop link that cannot sell and a price list nobody can buy from
 * would both appear to work and neither would.
 */
export default function AwaitingApproval() {
  const { session, logout } = useStore()
  const branding = useBranding()

  if (!session) return null

  const refused = session.status === 'rejected'

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <Card className="p-6 text-center">
        <span
          className={
            refused
              ? 'mx-auto flex size-14 items-center justify-center rounded-full bg-red-100 text-red-700'
              : 'mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700'
          }
        >
          {refused ? <AlertIcon className="size-7" /> : <ClockIcon className="size-7" />}
        </span>

        <h1 className="mt-4 text-xl font-bold text-slate-900">
          {refused ? 'Your application was not approved' : 'Your application is being reviewed'}
        </h1>

        {refused ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              {session.statusNote ??
                `${branding.shopName} did not approve this application. No reason was recorded.`}
            </p>
            <p className="mt-3 text-sm text-slate-500">
              If you think this is a mistake, call {branding.shopName} on 020 987 6543.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Selling under {branding.shopName}'s name means setting the prices their customers pay,
              so a person checks each new agent before switching them on. It usually takes less than
              a day.
            </p>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                What happens next
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                <li>· We email {session.email} the moment you are approved.</li>
                <li>· Your shop link and prices are waiting for you when you sign back in.</li>
                <li>· Nothing you do now is lost — the account is already yours.</li>
              </ul>
            </div>

            <Callout tone="info" className="mt-4 text-left" icon={<StoreIcon className="size-4" />}>
              You can still buy bundles for yourself in the meantime, at the standard prices.
            </Callout>
          </>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link to="/shop" className="flex-1">
            <Button block variant="outline">
              Browse the shop
            </Button>
          </Link>
          <Button block variant="outline" className="flex-1" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  )
}
