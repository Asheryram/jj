// Invoicing series, part 1: the whole loop, for any app that uses the invoicing app.
// Only the invoicing app is shown. LOCAL copy only (APP_URL=http://localhost:3100).
import { billingMeta, resetSample, setPaidThrough, appView, reveal, sql, HUB, day } from './_billing.mjs'

export const meta = billingMeta('Invoicing 1: the whole loop, end to end')

const RUN = String(Date.now()).slice(-5)

export const scenes = [
  {
    caption: 'The invoicing app, end to end',
    say: 'This series shows how to run the invoicing app for any app you build and charge for. The idea is simple. You record each client, each of their apps as a project, and what each project pays for. Every connected app asks the invoicing app once an hour whether its project is paid. Paid, it works normally. Not paid, it pauses new sales and sign ups until it is, and it comes back the moment the payment is recorded.',
    open: async ({ go }) => {
      await resetSample()
      await go('/admin')
    },
    do: ({ wait }) => wait(1500),
  },
  {
    caption: '1. Add the client',
    say: 'Step one: add the client, the person or business who pays you. Open Clients, enter their name and email, and click Add client.',
    open: ({ go }) => go('/admin/clients'),
    do: async ({ page, type, click, wait }) => {
      await type('form[action="/admin/clients"] input[name=name]', 'Ama Owusu')
      await page.fill('form[action="/admin/clients"] input[name=email]', `ama.owusu.${RUN}@example.com`)
      await wait(800)
      await click('form[action="/admin/clients"] button[type=submit]')
      await wait(1500)
    },
  },
  {
    caption: '2. One project for each app',
    say: 'Step two: open the client and add a project for each app you run for them. Every project is billed and checked on its own, so if one is unpaid, the client\'s other apps keep working.',
    open: async ({ page }) => {
      const [client] = await sql('SELECT id FROM clients WHERE email = ?', [`ama.owusu.${RUN}@example.com`])
      await page.goto(`http://localhost:3100/admin/clients/${client.id}`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ type, click, wait }) => {
      await type('form[action$="/projects"] input[name=name]', 'Ama Online Store')
      await wait(600)
      await click('form[action$="/projects"] button[type=submit]')
      await wait(1500)
    },
  },
  {
    caption: '3. Connect the app',
    say: 'Step three: connect the app. Open Licence settings for this app. Copy these two lines, the licence address and the public key, into the app\'s server settings, once. The app then asks that address every hour. The answer is signed, so the app can trust it and nobody can fake it. Leave enforcement off at first, so the app only reports its status while you check everything is right.',
    open: ({ page }) => page.waitForLoadState('networkidle').catch(() => {}),
    do: async ({ page, click, wait }) => {
      await click('summary:has-text("Licence settings for this app")')
      await page.locator('pre.code-block').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(11000)
    },
  },
  {
    caption: '4. Add what the project pays for',
    say: 'Step four: add a subscription for each thing the project pays for: the app itself, hosting, maintenance. Choose the client and project, name the plan, set the price, how often it renews, and the date their current payment runs out. Leave the three timings blank for the defaults: seven days of grace, then new sales pause, and after thirty days the whole app pauses.',
    open: ({ go }) => go('/admin/subscriptions'),
    do: async ({ page, wait, click }) => {
      const form = 'form[action="/admin/subscriptions"]'
      await page.locator(form).scrollIntoViewIfNeeded()
      const [{ id: client }] = await sql('SELECT id FROM clients WHERE email = ?', [`ama.owusu.${RUN}@example.com`])
      await page.selectOption(`${form} select[name=clientId]`, client)
      await page.waitForTimeout(400)
      const [{ id: project }] = await sql('SELECT id FROM projects WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', [client])
      await page.selectOption(`${form} select[name=projectId]`, project)
      await page.fill(`${form} input[name=planName]`, 'Online store')
      await page.fill(`${form} input[name=amount]`, '1')
      await page.fill(`${form} input[name=paidThrough]`, day(20))
      await wait(6000)
      await click(`${form} button[type=submit]`)
      await wait(2500)
    },
  },
  {
    caption: 'The subscription page',
    say: 'Each subscription has its own page: where it stands, the settings for the app, its invoices, everything you can do under Actions, and a history of every change. Further down you can even see exactly what the app is told right now.',
    open: ({ page }) => page.waitForLoadState('networkidle').catch(() => {}),
    do: async ({ page, wait }) => {
      await wait(3000)
      await page.locator('h2:has-text("Actions")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(4000)
      await page.locator('h2:has-text("What the app is told right now")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(4000)
    },
  },
  {
    caption: '5. Invoices and reminders go out by themselves',
    say: 'Step five runs by itself every morning. Two weeks before each renewal, the invoice is created and emailed with a pay link. Reminders follow at a week, three days and one day, then after the due date. Each goes once. A dry run shows what any day would bring, without changing anything.',
    open: ({ go }) => go('/admin/subscriptions'),
    do: async ({ page, click, wait }) => {
      const form = 'form[action="/admin/subscriptions/run"]'
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.fill(`${form} input[name=asOf]`, day(30))
      await page.check(`${form} input[name=dry]`)
      await wait(1500)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.locator('text=would').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'When a payment is missed',
    say: 'Now, a missed payment. We take an example project and move its plan fifteen days past the due date. Look at the top: the app is now told restricted. Every connected app shows its owner a warning with a pay button, and pauses new sales and sign ups. Payouts, refunds and staff log in keep working.',
    open: async ({ page }) => {
      await setPaidThrough(HUB, -15)
      await page.goto(`http://localhost:3100/admin/subscriptions/${HUB}`)
      await reveal(page, 'form[action$="/renewal-invoice"]')
      await page.locator('form[action$="/renewal-invoice"] button[type=submit]').click().catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
      await appView(page)
    },
    do: async ({ page, wait }) => {
      await wait(7000)
      await page.locator('h2:has-text("Invoices")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(5000)
    },
  },
  {
    caption: '6. Record the payment',
    say: 'Step six: the payment. Paid with the link, Paystack confirms it and everything updates by itself. Paid by bank or cash, open Invoices, choose Mark as paid, and say how they paid.',
    open: ({ go }) => go('/admin/invoices?status=pending'),
    do: async ({ page, click, wait }) => {
      const [inv] = await sql("SELECT id FROM invoices WHERE status = 'pending' AND subscription_id = ? ORDER BY created_at DESC LIMIT 1", [HUB])
      const form = `form[action="/admin/invoices/${inv.id}/mark-paid"]`
      await reveal(page, form)
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=note]`).fill('Bank transfer')
      await wait(2500)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(1500)
    },
  },
  {
    caption: 'The app comes back',
    say: 'The project is paid up again. The app hears it at its next check, or straight away if its owner clicks check again, and everything works again. The client gets a receipt with their new paid through date.',
    open: ({ page }) => appView(page),
    do: ({ wait }) => wait(7000),
  },
  {
    caption: '7. Keep an eye on it',
    say: 'Step seven: keep an eye on things. Reports shows your monthly income, who owes what and for how long, and what renews soon. The audit log records every change and who made it.',
    open: ({ go }) => go('/admin/reports'),
    do: async ({ page, go, wait }) => {
      await wait(4000)
      await page.mouse.wheel(0, 900)
      await wait(3000)
      await go('/admin/audit')
      await wait(4000)
    },
  },
]
