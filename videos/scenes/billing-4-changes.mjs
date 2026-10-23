// Invoicing series, part 4: changes to what a project pays for. LOCAL apps only.
import { billingMeta, resetSample, setPaidThrough, appView, sql, jkbk, reveal, HUB, HOSTING, day } from './_billing.mjs'

export const meta = billingMeta('Invoicing 4: changing what a project pays for')

const RUN = String(Date.now()).slice(-5)
const B = 'http://localhost:3100'
const post = (page, url, form) => page.request.post(B + url, { form, maxRedirects: 0 }).catch(() => {})

async function fillAndSubmit(page, click, formSel, values, waitMs = 2500) {
  await reveal(page, formSel)
  await page.locator(formSel).scrollIntoViewIfNeeded()
  for (const [name, value] of Object.entries(values)) {
    const field = page.locator(`${formSel} [name=${name}]`)
    const tag = await field.evaluate((el) => `${el.tagName}:${el.type}`).catch(() => '')
    if (tag.startsWith('SELECT')) await field.selectOption(value)
    else if (tag.endsWith('checkbox')) await field.check()
    else await field.fill(value)
  }
  await page.waitForTimeout(waitMs)
  await click(`${formSel} button[type=submit]`)
  await page.waitForLoadState('networkidle').catch(() => {})
}

export const scenes = [
  {
    caption: 'Part 4: changing what a project pays for',
    say: 'Part four: changes. Installments, cancelling a service the client no longer needs, ending an app, bringing it back, pausing for a season, free trials, a few extra days, exempt projects, and moving a project to a new owner.',
    open: async ({ go }) => {
      await resetSample()
      await go('/admin/subscriptions')
    },
    do: ({ wait }) => wait(1500),
  },
  {
    caption: 'Installments',
    say: 'A bigger one time payment can be split. Here three cedis for the build, in three monthly installments. Each part gets its own due date and its own reminders, and they always add up to the exact total.',
    open: ({ go }) => go('/admin/invoices'),
    do: async ({ page, click, wait }) => {
      const p = await jkbk()
      await fillAndSubmit(page, click, 'form[method="POST"][action="/admin/invoices"]', {
        clientId: p.client_id, projectId: p.id, description: 'Build', amount: '3', dueDate: day(20), installments: '3',
      }, 4000)
      await page.goto(`${B}/admin/invoices?status=pending`)
      await wait(5000)
      await sql("UPDATE invoices SET status = 'canceled' WHERE status = 'pending' AND description LIKE 'Build (%'")
    },
  },
  {
    caption: 'Cancel a service they no longer need',
    say: 'The client moved their hosting elsewhere, but hosting is fifteen days overdue, so their app is restricted. Cancel it now, and choose: it stops counting. The app is told active again, and the hosting bill is never chased again.',
    open: async ({ go }) => {
      await setPaidThrough(HOSTING, -15)
      await go(`/admin/subscriptions/${HOSTING}`)
    },
    do: async ({ page, click, wait }) => {
      await fillAndSubmit(page, click, 'form[action$="/cancel"]', { when: 'now', effect: 'release', reason: 'Moved hosting to their own server' }, 4500)
      await appView(page)
      await wait(6000)
    },
  },
  {
    caption: 'Reactivate',
    say: 'If they come back, open the cancelled subscription and reactivate it, from a date they have already paid up to, or billed from today, with an optional reactivation fee.',
    open: ({ go }) => go(`/admin/subscriptions/${HOSTING}`),
    do: async ({ page, click, wait }) => {
      await fillAndSubmit(page, click, 'form[action$="/reactivate"]', { paidThrough: day(30), reason: 'Back on our hosting' }, 4000)
      await wait(2500)
    },
  },
  {
    caption: 'End the app itself',
    say: 'If the app itself is ending, cancel its plan and choose the app pauses. You can add a final invoice for anything still owed. The app is told suspended and shows its paused page, but the client is never chased for renewals again.',
    open: ({ go }) => go(`/admin/subscriptions/${HUB}`),
    do: async ({ page, click, wait }) => {
      await fillAndSubmit(page, click, 'form[action$="/cancel"]', { when: 'now', effect: 'pause', finalAmount: '1', reason: 'Contract ended' }, 4500)
      await appView(page)
      await wait(6000)
      await post(page, `/admin/subscriptions/${HUB}/reactivate`, { paidThrough: day(40), reason: 'Demo: back' })
      await sql("UPDATE invoices SET status = 'canceled' WHERE status = 'pending'")
    },
  },
  {
    caption: 'Pause for a season',
    say: 'Pause until a date, for a holiday or a closed season. Nothing is billed or limited meanwhile, the time they already paid for is kept for afterwards, and it resumes on its own.',
    open: ({ go }) => go(`/admin/subscriptions/${HUB}`),
    do: async ({ page, click, wait }) => {
      await fillAndSubmit(page, click, 'form[action$="/pause"]', { until: day(30), reason: 'Closed for the holidays' }, 4000)
      await page.locator('summary:has-text("Paused")').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(3000)
      await post(page, `/admin/subscriptions/${HUB}/resume`, {})
    },
  },
  {
    caption: 'A few extra days',
    say: 'When a client promises to pay on Friday, give extra days with a reason. Here the app plan is fifteen days late and the app is restricted. With seven courtesy days, the app is told active again while you wait for the money.',
    open: async ({ go }) => {
      await setPaidThrough(HUB, -15)
      await go(`/admin/subscriptions/${HUB}`)
    },
    do: async ({ page, click, wait }) => {
      await fillAndSubmit(page, click, 'form[action$="/courtesy"]', { days: '7', reason: 'Salary delayed, paying Friday' }, 3500)
      await appView(page)
      await wait(6000)
    },
  },
  {
    caption: 'Exempt',
    say: 'Exempt is for a friend, a pilot, or your own app: never invoiced and never limited. Paused mode is the same, for a short break. Both are in Exempt, pause or cancel, and always ask for a reason.',
    open: ({ go }) => go(`/admin/subscriptions/${HUB}`),
    do: async ({ page, wait }) => {
      await reveal(page, 'form[action$="/mode"]')
      await page.locator('form[action$="/mode"]').scrollIntoViewIfNeeded()
      await wait(6500)
      await resetSample()
    },
  },
  {
    caption: 'A free trial',
    say: 'For a new client, set free trial days when you add the subscription. It starts today, the app runs normally, and the first invoice goes out before the trial ends. The app is told when the trial ends, so it can show it.',
    open: async ({ page, go }) => {
      await post(page, '/admin/clients', { name: `Kojo Mensah`, email: `kojo.${RUN}@example.com`, note: 'Trial client' })
      await go('/admin/subscriptions')
    },
    do: async ({ page, click, wait }) => {
      const [client] = await sql('SELECT id FROM clients WHERE email = ?', [`kojo.${RUN}@example.com`])
      await fillAndSubmit(page, click, 'form[action="/admin/subscriptions"]', {
        clientId: client.id, newProjectName: 'Kojo Bookings', planName: 'Bookings app', amount: '1', paidThrough: day(0), trialDays: '30',
      }, 4500)
      await wait(4500)
    },
  },
  {
    caption: 'Move a project to a new owner',
    say: 'When an app changes hands, open its full billing history and move it to the new client. Its subscriptions and unpaid invoices go with it. Paid invoices stay as the record of who paid, and the old owner keeps their credit.',
    open: async ({ page }) => {
      const [project] = await sql("SELECT id FROM projects WHERE name = 'Kojo Bookings' ORDER BY created_at DESC LIMIT 1")
      await page.goto(`${B}/admin/projects/${project.id}`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, wait }) => {
      await reveal(page, 'form[action$="/move"]')
      await page.locator('form[action$="/move"]').scrollIntoViewIfNeeded()
      await wait(8000)
    },
  },
]
