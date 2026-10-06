import type { Tour } from './types'

/**
 * Admin "What do I do when..." walkthroughs. Each one leads across the real
 * screens in the order an admin would actually work through the situation.
 * Targets reuse the `data-tour` ids the page tours already placed.
 */
export const adminTaskTours: Tour[] = [
  {
    id: 'admin-task-paid-no-bundle',
    role: 'admin',
    kind: 'task',
    title: 'A customer paid but got no bundle',
    summary: 'Find the order, see why it is stuck, and settle it.',
    route: '/admin/orders',
    steps: [
      {
        route: '/admin/orders',
        target: 'orders-filters',
        title: 'Find the order',
        body: 'Search the customer\'s phone number or the order reference from their SMS. The list opens on the last 7 days, so press **Clear dates** if the order is older.',
      },
      {
        route: '/admin/orders',
        target: 'orders-table',
        title: 'Read its status',
        body: '**Processing** means it is still with the supplier, most bundles land within an hour. **Failed** means it will be refunded. On either, press **Why?** to see what the supplier said.',
      },
      {
        route: '/admin/needs-attention',
        target: 'attention-check-now',
        title: 'Ask the supplier now',
        body: 'If it has been a long time, open **Needs attention** and press **Check now**. That asks DataHub and GMPL for an answer straight away instead of waiting for the next automatic check.',
      },
      {
        route: '/admin/needs-attention',
        target: 'attention-stuck-orders',
        title: 'Settle it yourself if the supplier is silent',
        body: 'An order listed here has no clear answer. Check the supplier\'s own dashboard first, then press **Resolve by hand** and mark it **delivered** or **failed**. Never guess: marking it failed refunds the customer, so be sure they did not get it.',
      },
      {
        route: '/admin/refunds',
        target: 'refunds-tabs',
        title: 'If it failed, refund them',
        body: 'A failed paid order waits on **Refunds** under **Waiting**. Approve it to send the money back. Tell the customer you are on it, that is usually all they want to hear.',
      },
    ],
  },
  {
    id: 'admin-task-refund-by-hand',
    role: 'admin',
    kind: 'task',
    title: 'Send a refund by hand',
    summary: 'Your Paystack account cannot send refunds, so you send and record them.',
    route: '/admin/refunds',
    steps: [
      {
        route: '/admin/refunds',
        target: 'refunds-tiles',
        title: 'See what is owed',
        body: 'These tiles show how much customers are owed and how long the oldest has waited. Work oldest first.',
      },
      {
        route: '/admin/refunds',
        target: 'refunds-table',
        title: 'Approve the refund',
        body: 'Under **Waiting**, press **Refund** on the row and pick the customer\'s Mobile Money network. On a Starter account nothing is sent yet: it moves to **Refunded** marked **send by hand**.',
      },
      {
        title: 'Send the money yourself',
        body: 'Send the exact amount to the customer\'s Mobile Money number from the business MoMo linked to Paystack, or from your own phone. Note which one, it matters in the last step.',
      },
      {
        route: '/admin/refunds',
        target: 'refunds-tabs',
        title: 'Record that you sent it',
        body: 'Open **Refunded**, find the row marked **send by hand**, press **Paid another way?**, say how you sent it and press **Mark as sent**. The customer is told their money is back.',
      },
      {
        title: 'Who paid it?',
        body: 'The refund now shows under **Paid out of pocket, not yet reimbursed**. If you paid from the business MoMo linked to Paystack, press **Reimbursed** straight away. If you paid from your own pocket, press it once you have taken that amount back from the business.',
      },
    ],
  },
  {
    id: 'admin-task-payout-by-hand',
    role: 'admin',
    kind: 'task',
    title: 'Pay an agent\'s withdrawal',
    summary: 'Approve the request, send the Mobile Money, then record it.',
    route: '/admin/withdrawals',
    steps: [
      {
        route: '/admin/withdrawals',
        target: 'withdrawals-tiles',
        title: 'Who is waiting',
        body: 'How many agents are waiting and how much in total. The agent\'s balance already went down when they asked, including the GHS 1 sending fee, so the money is set aside.',
      },
      {
        route: '/admin/withdrawals',
        target: 'withdrawals-table',
        title: 'Approve it',
        body: 'Check the Mobile Money number and network on the row, then press **Approve**. Something looks wrong? **Reject** returns the full amount and fee to the agent.',
      },
      {
        route: '/admin/withdrawals',
        target: 'withdrawals-how-it-works',
        title: 'Send it yourself',
        body: 'On a Starter account approving does not move money. Send the amount (not the fee) to the number shown, then press **Paid another way?** on the row and **Mark as sent**. Changed your mind before sending? **Not sending it?** gives the agent their money back.',
      },
      {
        title: 'Close it off',
        body: 'The payout then appears under **Paid out of pocket, not yet reimbursed**. If you sent it from the business MoMo linked to Paystack, press **Reimbursed** right away. If it came from your own pocket, press it after you have repaid yourself from the business.',
      },
    ],
  },
  {
    id: 'admin-task-float-low',
    role: 'admin',
    kind: 'task',
    title: 'A float is running low',
    summary: 'See how long it lasts, top it up, and log the top-up correctly.',
    route: '/analytics',
    steps: [
      {
        route: '/analytics',
        target: 'analytics-attention',
        title: 'How long have you got?',
        body: 'Analytics warns you here when a float will run out within a few days, based on how much it spent each day this past week. The **Cash** tab shows the days left for each supplier.',
      },
      {
        title: 'Top it up at the supplier',
        body: 'Send money to DataHub or GMPL the way you normally do, through their own website or app. Top up before the busy evening hours, that is when most orders land.',
      },
      {
        route: '/admin/finance',
        target: 'finance-float-panel',
        title: 'Pick the supplier you paid',
        body: 'Back here on **Finance**, choose the **DataHub GH** or **GMPL** tab for the supplier you just topped up. Each has its own float and its own records.',
      },
      {
        route: '/admin/finance',
        target: 'float-log-topup',
        title: 'Log the top-up, choosing the right source',
        body: 'Press **Log a top-up** and enter the exact amount. Choose **Paystack, paying back** if the money came from the business MoMo linked to Paystack. Choose **Outside the business** if it came from your own pocket. Getting this right is what keeps profit and free to spend in step.',
      },
      {
        route: '/admin/finance',
        target: 'float-should-vs-live',
        title: 'Check it adds up',
        body: '**Should hold** goes up at once. **Live reading** catches up after the next order, or press **Check live** on GMPL. If they still disagree by a lot, a top-up may be missing or logged twice.',
      },
    ],
  },
  {
    id: 'admin-task-numbers-dont-match',
    role: 'admin',
    kind: 'task',
    title: 'Profit and free to spend don\'t match',
    summary: 'Find out why the cash is different from what sales made.',
    route: '/analytics',
    steps: [
      {
        route: '/analytics',
        target: 'analytics-tabs',
        title: 'Start on the Cash tab',
        body: 'Open **Cash** and find **Why isn\'t free to spend the same as profit?**. It steps from your profit earned to the cash that is free, line by line.',
      },
      {
        title: 'Profit moved into a float',
        body: 'If you paid a supplier more than its bundles cost, the extra is still your profit, but it is stock at that supplier now, not cash. That shows as its own line and is normal.',
      },
      {
        title: 'A big "Other" line means a record is wrong',
        body: 'Fees and rounding are a few cedis. A bigger gap almost always means a top-up logged with the wrong source, logged twice, or a refund or payout sent by hand but never recorded.',
      },
      {
        route: '/admin/finance',
        target: 'float-should-vs-live',
        title: 'Check each float',
        body: 'On **Finance**, compare **Should hold** with **Live reading** for each supplier. A float holding much more than it should means a top-up was not logged; much less means one was logged twice.',
      },
      {
        title: 'Fix the entry',
        body: 'A superadmin can open **Float corrections** from the Finance page to mark a top-up as a Paystack reimbursement, or reverse one that never happened. Missing records are fixed by logging them, not by editing numbers.',
      },
    ],
  },
  {
    id: 'admin-task-agent-asks-money',
    role: 'admin',
    kind: 'task',
    title: 'An agent asks where their money is',
    summary: 'Check what they earned and where their withdrawal is.',
    route: '/admin/users',
    steps: [
      {
        route: '/admin/users',
        target: 'users-filters',
        title: 'Find the agent',
        body: 'Search their name or phone number. Pick **Agents** to narrow the list.',
      },
      {
        route: '/admin/users',
        target: 'users-table',
        title: 'What they earned',
        body: 'Tap their **Total earned** amount to see every earning. A sale only earns once it is delivered, so an order still on its way has not paid them yet, and a failed one never will.',
      },
      {
        route: '/admin/withdrawals',
        target: 'withdrawals-tabs',
        title: 'Find their withdrawal',
        body: 'On **Withdrawals**, **Pending** shows requests you have not decided. **All** shows approved ones too, including any you still need to send by hand. That is the usual reason a payout is late.',
      },
      {
        route: '/admin/withdrawals',
        target: 'withdrawals-table',
        title: 'Settle it and tell them',
        body: 'Approve and send it, then record it with **Paid another way?**. They see it marked paid in their app. If you will not send it, use **Not sending it?** so the money goes back to their balance.',
      },
    ],
  },
]
