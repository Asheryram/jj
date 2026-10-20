// Admin chapter 4 of 8: refunds and withdrawals, the two queues where money leaves.
import { adminMeta } from './_admin.mjs'

export const meta = adminMeta('Admin 4: Refunds and withdrawals')

export const scenes = [
  {
    caption: 'Admin series, part 4: Refunds and withdrawals',
    say: 'In this video you will learn how to approve or refuse a refund, and how to pay or reject an agent withdrawal. Both move real money, so we will go slowly.',
    open: ({ go }) => go('/admin/refunds'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Refunds',
    say: 'When an order fails after the customer has paid, the money is owed back, and nothing is returned until you approve it. The refunds page shows how much is owed, and how long the oldest customer has been waiting. Three tabs sort the list: waiting, refunded, and refused. The queue is sorted oldest first, so work from the top.',
    open: ({ go }) => go('/admin/refunds'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await point('text=Owed to customers').catch(() => {})
      await wait(4000)
      await click('button:has-text("Refunded")').catch(() => {})
      await wait(4000)
      await click('button:has-text("Refused")').catch(() => {})
      await wait(4000)
      await click('button:has-text("Waiting")').catch(() => {})
    },
  },
  {
    caption: 'Pay a refund',
    say: 'To pay one, click Refund. A refund to a wallet lands instantly. A mobile money refund opens a window where you confirm the network and send the amount. On a Starter Paystack account nothing is sent automatically: the row is marked send by hand, so you send the money yourself, then click Paid another way, and record how you sent it, so the books still match.',
    open: ({ go }) => go('/admin/refunds'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('button:has-text("Refund") >> nth=0').catch(() => {})
      await wait(9000)
    },
  },
  {
    caption: 'Refuse a refund',
    say: 'To turn one down, click Refuse, and give a reason of at least five characters. That reason is kept on the record. Be careful before you refuse: the customer has paid and received nothing, so refuse only when the order really was delivered, or the claim is not genuine.',
    open: ({ go }) => go('/admin/refunds'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Refuse") >> nth=0').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Reorder instead',
    say: 'Sometimes the failure was not real, because a mapping has been fixed, or stock is back. Click Reorder instead, and the platform tries to deliver the bundle again. If it delivers, the refund is cancelled automatically, and the customer gets what they paid for.',
    open: ({ go }) => go('/admin/refunds'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Reorder instead?") >> nth=0').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Withdrawals',
    say: 'Agents ask to withdraw their earnings from the withdrawals page. It shows how many requests are waiting, how much has been paid to date, and the largest pending request. Pending and all tabs filter the list. Each pending row shows the agent, the number, the network, the amount, and the transfer fee that is held and not sent.',
    open: ({ go }) => go('/admin/withdrawals'),
    do: async ({ point, click, wait }) => {
      await wait(3500)
      await point('text=Awaiting your decision').catch(() => {})
      await wait(5000)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(5000)
      await click('button:has-text("Pending") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Approve a withdrawal',
    say: 'Click Approve. The banner at the top tells you which case you are in. On a live Paystack business account, the balance is checked and the transfer goes out automatically. On a Starter account, as here, approving only accepts the request and nothing is sent, so you send the amount, not the fee, to the number yourself. You cannot approve a payout to your own agent profile. Only the platform owner can.',
    open: ({ go }) => go('/admin/withdrawals'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=You send the money by hand').catch(() => {})
      await wait(7000)
      await point('button:has-text("Approve") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Paid another way',
    say: 'After you send the money by hand, a row marked decided offers two buttons. Paid another way is for recording how and where you sent it, then Mark as sent. Not sending it gives the agent their money back, if you change your mind before paying. If you paid from the business mobile money linked to Paystack, also click Reimbursed under paid out of pocket, so your books stay straight.',
    open: ({ go }) => go('/admin/withdrawals'),
    do: async ({ click, point, wait }) => {
      await wait(2500)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(3500)
      await point('button:has-text("Paid another way?")').catch(() => {})
      await wait(6000)
      await point('button:has-text("Not sending it?")').catch(() => {})
    },
  },
  {
    caption: 'Reject a withdrawal',
    say: 'Click Reject if a request should not be paid, for example if the number looks wrong or the account looks suspicious. The held amount, and the fee, go straight back to the agent. If the agent behind a request is suspended, the row shows a suspended badge and Approve is switched off, until you reactivate them on the users page, or reject the request instead.',
    open: ({ go }) => go('/admin/withdrawals'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('button:has-text("Reject") >> nth=0').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Next: finance',
    say: 'Next, we look at the books: the supplier float, what is free to spend, and where the money goes.',
    open: ({ go }) => go('/admin/withdrawals'),
    do: ({ wait }) => wait(1000),
  },
]
