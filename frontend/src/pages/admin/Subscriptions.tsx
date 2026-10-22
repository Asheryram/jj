import { PageHead } from '../../components/ui'
import { SubscriptionCard } from '../../components/license'

/**
 * This platform's own subscription and the invoice to pay.
 *
 * Nothing else lives here. What the platform runs on (hosting, the domain,
 * payment and delivery providers) and when each falls due is looked after in
 * the invoicing application, so the shop keeps no list of external services of
 * its own. The only thing anybody can do on this page is pay.
 */
export default function Subscriptions() {
  return (
    <div>
      <PageHead
        title="Subscriptions"
        subtitle="What this platform costs to run, and the invoices waiting. This is managed for you, so all you do here is pay."
      />

      <SubscriptionCard />
    </div>
  )
}
