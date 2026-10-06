import type { Tour } from './types'

/** Admin page tours. */
export const adminPageTours: Tour[] = [
  {
    id: 'admin-overview',
    role: 'admin',
    kind: 'page',
    title: 'Overview',
    summary: 'Your home screen: what needs you today and how the shop is doing.',
    route: '/admin',
    steps: [
      {
        target: 'learn-card',
        title: 'Learn the admin',
        body: 'Every tour lives here. A tick means you have finished it, and you can replay any tour at any time if you forget how a screen works.',
      },
      {
        target: 'overview-attention',
        title: 'Needs your attention',
        body: 'When something is waiting on you, it shows up here: stuck orders, agents waiting to be paid, or failed orders. Press **Review** or **View** to go straight to the page that deals with it. When nothing is waiting, this box is hidden.',
      },
      {
        target: 'overview-stat-tiles',
        title: 'This week at a glance',
        body: 'Money customers paid in the last 7 days, what you kept after supplier, Paystack and agent costs, how many people are active, and how many orders are still being delivered.',
      },
      {
        target: 'overview-money',
        title: 'Actually free to spend',
        body: 'The cash you could take out today without touching money owed to agents, customers or orders still being delivered. If it turns red, you owe more than you hold. Press **Finance** for the full picture.',
      },
      {
        target: 'overview-agents-orders',
        title: 'Top agents and latest orders',
        body: 'Your best selling agents by volume, and the newest orders across the whole shop. Use **All users** or the **All orders** page to see everything.',
      },
      {
        target: 'overview-integrations',
        title: 'Is everything switched on?',
        body: 'Shows whether DataHub, GMPL and Paystack are really live. **Simulated** means no real bundles are sent, and **Misconfigured** or **Not configured** means something needs fixing in **Integration settings**.',
      },
    ],
  },
  {
    id: 'admin-orders',
    role: 'admin',
    kind: 'page',
    title: 'All orders',
    summary: 'Every order on the platform, with what each one earned you.',
    route: '/admin/orders',
    steps: [
      {
        target: 'orders-money-tiles',
        title: 'Where the money went',
        body: 'From **Customers paid** to **Paid to agents**, these are all-time totals and do not change with the filters below. Only **Orders matching** follows your filter, dates and search.',
      },
      {
        target: 'orders-money-tiles',
        title: 'Profit earned',
        body: 'Your profit for all time, counting finished sales only: delivered orders, and failed ones whose refund was paid or refused. Orders still being delivered are not in it yet.',
      },
      {
        target: 'orders-money-tiles',
        title: 'Profit once open orders finish',
        body: 'Profit earned, plus what the orders still being delivered should add if they all succeed. Think of it as where your profit is heading.',
      },
      {
        target: 'orders-money-tiles',
        title: 'Free to spend now',
        body: 'This is cash, not profit: what you could take out of Paystack today without touching money owed to agents, customers or open orders. **Analytics**, on the **Cash** tab, explains why it differs from your profit.',
      },
      {
        target: 'orders-filters',
        title: 'Find an order',
        body: 'Pick **Completed**, **Processing**, **Unresolved** or **Failed**, set a date range, or search by number, reference, agent or product. It opens on the last 7 days, so press **Clear dates** to search further back.',
      },
      {
        target: 'orders-table',
        title: 'Each order in detail',
        body: 'Each row shows who sold it, what the customer paid, what the supplier really charged and your profit on it. On a failed or processing order, press **Why?** to see what the delivery partner said and what to do next.',
      },
      {
        target: 'orders-export',
        title: 'Export to a spreadsheet',
        body: '**Export CSV** downloads the orders that match your current filter, dates and search, up to 2,000 at a time, ready to open in Excel or Google Sheets.',
      },
    ],
  },
  {
    id: 'admin-needs-attention',
    role: 'admin',
    kind: 'page',
    title: 'Needs attention',
    summary: 'Orders the system will not guess at, waiting for you to decide.',
    route: '/admin/needs-attention',
    steps: [
      {
        title: 'Orders only you can settle',
        body: 'Sometimes a supplier never gives a clear answer about an order. Rather than guess and risk paying twice or refunding a customer who got their bundle, the order waits here for you.',
      },
      {
        target: 'attention-check-now',
        title: 'Check now',
        body: 'The shop rechecks stuck orders on its own about every ten minutes. Press **Check now** to ask the suppliers straight away, and to see if any waiting numbers were approved. Anything that settles drops off this page.',
      },
      {
        target: 'attention-stuck-orders',
        title: 'Stuck orders',
        body: 'Red means the supplier never replied at all, so only you can check. Amber means it is in DataHub\'s manual queue: copy the ticket number and quote it to DataHub support. Blue is still being checked automatically and usually needs nothing from you.',
      },
      {
        title: 'Resolve by hand',
        body: 'When there is a stuck order, press **Resolve by hand** to see what happened. You can **Check now**, or, once you are certain, **Mark as delivered** or **Mark as failed** (a failed one goes to **Refunds**). **Retry dispatch** only appears when the supplier never replied, so check their dashboard first.',
      },
      {
        title: 'Flagged for review',
        body: 'When there is one, a red **Flagged for review** box appears: an order settled one way, then a supplier said the opposite. Check nothing was paid twice, fix any money separately, then press **Acknowledge** and say what you checked.',
      },
      {
        title: 'Stuck transfers',
        body: 'When a refund or agent payout is stuck at Paystack, waiting for an OTP or with no answer, it appears under **Stuck transfers**. Check your Paystack dashboard, then use **Go to Refunds** or **Go to Withdrawals** to settle it.',
      },
    ],
  },
  {
    id: 'admin-approvals',
    role: 'admin',
    kind: 'page',
    title: 'Number approvals',
    summary: 'MTN numbers your suppliers must approve before they can be sold to.',
    route: '/admin/approvals',
    steps: [
      {
        target: 'approvals-list',
        title: 'Numbers waiting on approval',
        body: 'Some MTN numbers must be approved by a supplier before they can receive a bundle. Until then the sale is turned away without charging the customer, so every number here is a lost sale you can win back.',
      },
      {
        target: 'approvals-recheck',
        title: 'Re-check',
        body: 'Press **Re-check** to ask DataHub and GMPL which numbers they have approved. Any orders held for an approved number are sent for delivery at once. It can only run about once a minute.',
      },
      {
        title: 'Getting numbers approved',
        body: 'When numbers are waiting, press **Copy all** and add the numbers in your DataHub dashboard, since DataHub\'s automatic sending is not working. **Try sending automatically** sends them to GMPL for you. Then come back and press **Re-check**.',
      },
      {
        title: 'Reading the list',
        body: 'Work down by **Sales refused**, the numbers that turned away the most customers. Under DataHub and GMPL, **Pending** means not sent yet, **Awaiting answer** means sent, and a number leaves the list once every supplier says **Approved**.',
      },
      {
        title: 'Money held',
        body: 'When you see **Orders held**, those customers paid before this check existed. They are released the moment their number is approved, and refunded automatically if the hold runs out first.',
      },
    ],
  },
  {
    id: 'admin-refunds',
    role: 'admin',
    kind: 'page',
    title: 'Refunds',
    summary: 'Money owed back to customers whose orders failed.',
    route: '/admin/refunds',
    steps: [
      {
        target: 'refunds-tiles',
        title: 'What you owe',
        body: 'How much is owed back to customers, and how long the oldest one has waited. Nothing is returned until you approve it, so start with the oldest.',
      },
      {
        target: 'refunds-tabs',
        title: 'Waiting, Refunded, Refused',
        body: '**Waiting** is your to-do list. **Refunded** shows what you approved, including any you still need to send by hand. **Refused** keeps the reason you gave.',
      },
      {
        target: 'refunds-table',
        title: 'Each refund',
        body: 'Each row shows the customer, the order, why it failed and where the money goes back to: their wallet or Mobile Money. Tick several to use **Refund selected** or **Refuse selected** together.',
      },
      {
        target: 'refunds-table',
        title: 'Refund, Refuse or Reorder',
        body: '**Refund** puts wallet money straight back, or asks which Mobile Money network to send to. **Refuse** needs a reason that is kept on record. **Reorder instead?** tries the bundle again, and the refund is cancelled if it delivers.',
      },
      {
        title: 'Sending a refund by hand',
        body: 'While your Paystack account is a Starter account it cannot send refunds itself, so an approved Mobile Money refund shows **send by hand** on the **Refunded** tab. Send the money from your own MoMo, then press **Paid another way?**, say how you sent it and press **Mark as sent**. That tells the customer.',
      },
      {
        title: 'Paid out of pocket',
        body: 'When there is one, the **Paid out of pocket, not yet reimbursed** box lists refunds you sent from your own money. The customer\'s original payment is still with Paystack, so take it back from there, then press **Reimbursed**.',
      },
    ],
  },
  {
    id: 'admin-withdrawals',
    role: 'admin',
    kind: 'page',
    title: 'Withdrawals',
    summary: 'Agents asking to be paid their earnings on Mobile Money.',
    route: '/admin/withdrawals',
    steps: [
      {
        target: 'withdrawals-tiles',
        title: 'Who is waiting to be paid',
        body: 'How many agents are waiting on you and the total they asked for, what you have paid out so far, and the biggest single request.',
      },
      {
        target: 'withdrawals-how-it-works',
        title: 'What approving does',
        body: 'The money is taken from the agent\'s balance when they ask, together with a small transfer fee. If you **Reject**, all of it goes back to their balance. While your Paystack account is a Starter account it cannot send payouts, so approving means you send it by hand.',
      },
      {
        target: 'withdrawals-tabs',
        title: 'Pending and All',
        body: '**Pending** is your to-do list. **All** shows every request, including approved ones you still need to send by hand.',
      },
      {
        target: 'withdrawals-table',
        title: 'Approve or reject',
        body: 'Each row shows the agent, the Mobile Money number and network to pay, and the amount. Press **Approve** or **Reject**, or tick several to do them together. A suspended agent must be reactivated before you can approve.',
      },
      {
        title: 'Paying by hand',
        body: 'After approving, send the money from your own MoMo to the number shown, then press **Paid another way?**, say how you sent it and press **Mark as sent**. Changed your mind before sending? **Not sending it?** returns the money to the agent.',
      },
      {
        title: 'Paid out of pocket',
        body: 'When there is one, the **Paid out of pocket, not yet reimbursed** box lists payouts you covered from your own money. Take the amount back for yourself, then press **Reimbursed**.',
      },
    ],
  },
]
