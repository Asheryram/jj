// Admin chapter 3 of 8: orders, stuck orders and number approvals.
import { adminMeta } from './_admin.mjs'

export const meta = adminMeta('Admin 3: Orders and stuck orders')

export const scenes = [
  {
    caption: 'Admin series, part 3: Orders',
    say: 'In this video you will learn how to read your orders, sort out stuck or disputed ones, and get new mobile numbers approved for delivery.',
    open: ({ go }) => go('/admin/orders'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'All orders',
    say: 'All orders lists every sale on the platform. The tiles at the top show profit earned, and the free to spend now figure, which is cash and so can differ from profit. Filter by completed, processing, unresolved, or failed, narrow it by date, and export the lot to a spreadsheet.',
    open: ({ go }) => go('/admin/orders'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await click('button:has-text("Completed")').catch(() => {})
      await wait(3500)
      await click('button:has-text("Failed")').catch(() => {})
      await wait(3500)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(1500)
      await point('tbody tr >> nth=2').catch(() => {})
      await wait(3000)
      await point('button:has-text("Export CSV")').catch(() => {})
    },
  },
  {
    caption: 'Read the badges',
    say: 'The small badges tell you what happened without opening anything. A data hub manual badge, with a number, means the supplier sent the order to a person on their side, so it can take much longer. A code badge means an automated system handled it. Resolved by admin means somebody here settled it by hand. On a failed order, refund pending or refund rejected tells you where the refund stands, and never paid means the customer was never charged. The Why button explains any of them.',
    open: ({ go }) => go('/admin/orders'),
    do: async ({ click, point, wait, page }) => {
      await wait(1500)
      await point('tbody tr >> nth=0').catch(() => {})
      await wait(4500)
      await click('button:has-text("Why?") >> nth=0').catch(() => {})
      await wait(7000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Needs your attention',
    say: 'Open Needs attention for orders that cannot sort themselves out. Press Check now first, which asks the suppliers for an answer straight away, because many clear on their own.',
    open: ({ go }) => go('/admin/needs-attention'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await click('button:has-text("Check now")').catch(() => {})
      await wait(5000)
      await point('text=Stuck orders').catch(() => {})
    },
  },
  {
    caption: 'Flagged for review',
    say: 'Under flagged for review are orders that were settled one way, and then a later signal disagreed. Maybe one system said delivered and another said failed. Check the supplier or Paystack dashboard, or ask the customer, then click Acknowledge, and write what you checked, at least five characters. This never moves any money by itself.',
    open: ({ go }) => go('/admin/needs-attention'),
    do: async ({ point, click, wait, page }) => {
      await wait(3000)
      await point('text=Flagged for review').catch(() => {})
      await wait(4000)
      await click('button:has-text("Acknowledge")').catch(() => {})
      await wait(7000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Stuck orders: resolve by hand',
    say: 'Stuck orders were paid for, but the supplier never gave a final answer. Click Resolve by hand, and choose Mark as delivered, or Mark as failed, depending on what really happened. Explain how you know, and click Confirm. This runs the real settlement path: the agent is credited, or the customer is refunded, exactly as if the supplier had answered. Be sure before you press it.',
    open: ({ go }) => go('/admin/needs-attention'),
    do: async ({ click, wait, page }) => {
      await wait(3500)
      await click('button:has-text("Resolve by hand") >> nth=0').catch(() => {})
      await wait(10000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Number approvals',
    say: 'Open Number approvals. Some mobile numbers have to be approved by the supplier before they can receive an order, and until then the order is held. Each row shows a number and where it stands with each supplier. Click Try sending automatically first. G M P L numbers are submitted for real this way, and a message tells you how many went.',
    open: ({ go }) => go('/admin/approvals'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('button:has-text("Try sending automatically")').catch(() => {})
      await wait(6000)
      await point('text=Waiting on approval').catch(() => {})
    },
  },
  {
    caption: 'Copy and re-check',
    say: 'Data hub numbers usually need a manual step. Click Copy all, paste the list into your data hub dashboard, and add them there. A badge then shows when each number was copied. If just one number changed, use the small copy icon on that row. When you are done, click Re-check. Anything the supplier has approved releases its held order for delivery automatically.',
    open: ({ go }) => go('/admin/approvals'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('button:has-text("Copy all")').catch(() => {})
      await wait(7000)
      await point('button:has-text("Re-check")').catch(() => {})
    },
  },
  {
    caption: 'Next: refunds and withdrawals',
    say: 'That is orders. Next, the two queues where real money leaves the business: refunds, and withdrawals.',
    open: ({ go }) => go('/admin/orders'),
    do: ({ wait }) => wait(1000),
  },
]
