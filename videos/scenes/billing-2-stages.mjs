// Invoicing series, part 2: every stage of a project's bill, and what any connected app
// does at each. Only the invoicing app is shown. LOCAL copy only.
import { billingMeta, resetSample, setPaidThrough, appView, reveal, sql, HUB, HOSTING } from './_billing.mjs'

export const meta = billingMeta('Invoicing 2: every stage of an unpaid bill')

const stage = async (page, dh, host = 40) => {
  await setPaidThrough(HUB, dh)
  await setPaidThrough(HOSTING, host)
  await appView(page)
}

export const scenes = [
  {
    caption: 'Every stage of an unpaid bill',
    say: 'Part two: the stages. As a bill goes unpaid, a project moves from paid up, to due soon, to grace, to restricted, to suspended. For each one you will see what the invoicing app shows and what every connected app does. The box at the top of a project\'s history, the app is told, is exactly what its app hears. We move the dates by hand so you do not wait weeks.',
    open: async ({ page }) => {
      await resetSample()
      await appView(page)
    },
    do: ({ wait }) => wait(2000),
  },
  {
    caption: 'Paid up',
    say: 'Paid up. The app is told active, and nothing shows anywhere in the app.',
    open: ({ page }) => stage(page, 40),
    do: ({ wait }) => wait(5000),
  },
  {
    caption: 'Due soon',
    say: 'Due soon. In the two weeks before a renewal the invoice is already out. The app\'s owner sees a quiet note that a payment is due soon, with a pay button. Customers and staff see nothing.',
    open: async ({ page }) => {
      await sql("UPDATE invoices SET status = 'canceled' WHERE status = 'pending'")
      await setPaidThrough(HUB, 5)
      await page.goto(`http://localhost:3100/admin/subscriptions/${HUB}`)
      await reveal(page, 'form[action$="/renewal-invoice"]')
      await page.locator('form[action$="/renewal-invoice"] button[type=submit]').click().catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await appView(page)
    },
    do: async ({ page, wait }) => {
      await wait(4500)
      await page.locator('h2:has-text("Invoices")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(3500)
    },
  },
  {
    caption: 'Grace: overdue, still working',
    say: 'Grace. The due date passed three days ago. For the grace days, seven by default, everything in the app still works. Only its owner sees a warning, with the date selling would pause and a pay button. The client also gets an overdue reminder by email.',
    open: ({ page }) => stage(page, -3),
    do: ({ wait }) => wait(8000),
  },
  {
    caption: 'Last day of grace',
    say: 'On the last day of grace the client gets a final reminder. An app can also give its own staff a day\'s notice, if its owner switches that on in the app.',
    open: ({ page }) => stage(page, -6.6),
    do: ({ wait }) => wait(6000),
  },
  {
    caption: 'Restricted: new sales pause',
    say: 'Restricted, fifteen days late. The app pauses whatever brings in new money: new sign ups, new orders, top ups. Everything already paid for keeps working, people can still check on their orders, staff can still log in, and payouts and refunds are never blocked. Its owner sees a red banner with the pay button.',
    open: ({ page }) => stage(page, -15),
    do: ({ wait }) => wait(10000),
  },
  {
    caption: 'Suspended: the app pauses for the public',
    say: 'Suspended, forty five days late. The app shows the public a paused page, with your own message if you set one. Its owner and staff can still sign in, pay, and pay out. Nothing is deleted: when the bill is paid, it comes straight back.',
    open: ({ page }) => stage(page, -45),
    do: ({ wait }) => wait(9000),
  },
  {
    caption: 'One unpaid service is enough',
    say: 'A project is only as healthy as its worst bill. Here the app plan is late but hosting is paid: the project is still restricted, and the list shows which one. Pay that one and it clears.',
    open: ({ page }) => stage(page, -15, 40),
    do: async ({ page, wait }) => {
      await page.locator('h2:has-text("What it pays for")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(8000)
    },
  },
  {
    caption: 'Each project stands alone',
    say: 'Other projects of the same client are separate. While the example app is restricted, the same client\'s inventory app is paid up and keeps running. An app only ever hears about its own project.',
    open: async ({ page }) => {
      const [inv] = await sql("SELECT id FROM projects WHERE name = 'Inventory app'")
      await page.goto(`http://localhost:3100/admin/projects/${inv.id}`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: ({ wait }) => wait(7000),
  },
  {
    caption: 'Where you see it all',
    say: 'You never have to check each project by hand. The Subscriptions page lists everything worst first, overdue at the top, with when each app last checked in.',
    open: ({ go }) => go('/admin/subscriptions'),
    do: ({ wait }) => wait(7000),
  },
  {
    caption: 'Paid again',
    say: 'When the bill is paid, by link or recorded by hand, the next check clears every stage at once. Back to paid up.',
    open: async ({ page }) => {
      await resetSample()
      await appView(page)
    },
    do: ({ wait }) => wait(4500),
  },
]
