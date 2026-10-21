// Agent chapter 4 of 5: sales, earnings, withdrawals and reports.
// Opens the withdrawal dialog and types an amount, but never sends it.
import { agentMeta } from './_agent.mjs'

export const meta = agentMeta('Agent 4: Sales, earnings and withdrawals')

export const scenes = [
  {
    caption: 'Agent series, part 4: Sales and money',
    say: 'In this video you will learn how to follow your sales, check a customer\'s order, read your earnings, withdraw your money, and pull a report.',
    open: ({ go }) => go('/app/orders'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Your sales',
    say: 'Open Sales to see every order placed through your shop and your chain. The line at the top tells you how many orders there are, how much you earned from them, and how many failed and were reversed. Filter by all, completed, in progress, or failed, or search by a number, a reference, or a product.',
    open: ({ go }) => go('/app/orders'),
    do: async ({ click, point, wait }) => {
      await wait(3000)
      await click('button:has-text("Completed")').catch(() => {})
      await wait(3500)
      await click('button:has-text("Failed")').catch(() => {})
      await wait(3500)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(1000)
      await point('input[placeholder*="Number"]').catch(() => {})
    },
  },
  {
    caption: 'Check on a customer order',
    say: 'To check on a customer\'s order, find it, and click the row. You see its status, the recipient, how it was paid, and exactly how the sale was split between you, the supplier, and anyone above you. If an order failed, it is refunded automatically, and any margin you were credited is reversed. You do not need to do anything.',
    open: ({ go }) => go('/app/orders'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('tbody tr >> nth=0').catch(() => {})
      await wait(10000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Earnings',
    say: 'Open Earnings. The three tiles show what is available to withdraw, what you have earned from your own sales, and what you have withdrawn so far. Below is a chart of the last seven days, then the earnings ledger. Filter it by all, my sales, or withdrawals. It shows the newest first, and it only ever grows: nothing in it can be edited, only added to.',
    open: ({ go }) => go('/app/earnings'),
    do: async ({ point, click, wait, page }) => {
      await wait(2500)
      await point('text=Available to withdraw').catch(() => {})
      await wait(5000)
      await point('text=Earnings, last 7 days').catch(() => {})
      await wait(4000)
      await page.evaluate(() => window.scrollTo(0, 99999))
      await wait(1500)
      await click('button:has-text("Withdrawals") >> nth=-1').catch(() => {})
      await wait(3500)
      await click('button:has-text("My sales")').catch(() => {})
    },
  },
  {
    caption: 'Request a withdrawal',
    say: 'To get paid, open Withdraw and click Request withdrawal. Enter an amount, or click Withdraw the max, which already leaves room for the fee. Pick your mobile money network, and the number to pay. It does not have to be the one you sign in with. Click Send request.',
    open: ({ go }) => go('/app/withdrawals'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Request withdrawal")').catch(() => {})
      await wait(9000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Fees and limits',
    say: 'The amount, plus a flat one cedi sending fee, leaves your available balance right away and is held until the request is decided. The smallest withdrawal is ten cedis, and you can have up to three requests waiting at once. The admin reviews and pays each request by hand, usually within twenty four hours, and you get a text once the money has been sent.',
    open: ({ go }) => go('/app/withdrawals'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Awaiting approval').catch(() => {})
      await wait(6000)
      await point('text=How payouts work right now').catch(() => {})
    },
  },
  {
    caption: 'Cancel a request',
    say: 'Changed your mind? Find the request under your requests, and click Cancel. It is only shown while the request is still awaiting review. The amount, and the sending fee, return to your available balance immediately.',
    open: ({ go }) => go('/app/withdrawals'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Your requests').catch(() => {})
      await wait(5000)
      await point('button:has-text("Cancel") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Reports',
    say: 'Finally, Reports. Pick a range from the date list, today, last seven days, this month, this year and more, or choose your own dates. You see how much you sold and kept, what sells best, and a breakdown by category. Click Export C S V to download the same figures as a spreadsheet.',
    open: ({ go }) => go('/app/reports'),
    do: async ({ click, point, wait }) => {
      await wait(3000)
      await click('button:has-text("Last 7 days")').catch(() => {})
      await wait(5000)
      await point('button:has-text("Export CSV")').catch(() => {})
    },
  },
  {
    caption: 'Next: help and feedback',
    say: 'That is your money. In the last video, you will see where to get help, how to send feedback to the admin, and where announcements appear.',
    open: ({ go }) => go('/app/reports'),
    do: ({ wait }) => wait(1000),
  },
]
