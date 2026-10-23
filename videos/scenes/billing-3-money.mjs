// Invoicing series, part 3: every money situation. LOCAL apps only.
import { billingMeta, resetSample, appView, sql, jkbk, reveal, HUB, day } from './_billing.mjs'

export const meta = billingMeta('Invoicing 3: every money situation')

const invoiceForm = 'form[method="POST"][action="/admin/invoices"]'

async function newInvoice(page, { description, amount, due = null, pauses = false, installments = 1 }) {
  const p = await jkbk()
  await page.goto('http://localhost:3100/admin/invoices')
  await page.waitForLoadState('networkidle').catch(() => {})
  const form = page.locator(invoiceForm)
  await form.locator('select[name=clientId]').selectOption(p.client_id)
  await form.locator('select[name=projectId]').selectOption(p.id)
  await form.locator('input[name=description]').fill(description)
  await form.locator('input[name=amount]').fill(String(amount))
  if (due) {
    await reveal(page, `${invoiceForm} input[name=dueDate]`)
    await form.locator('input[name=dueDate]').fill(due)
    if (pauses) await form.locator('input[name=pausesProject]').check()
    await form.locator('input[name=installments]').fill(String(installments))
  }
}

// The newest pending invoice whose description starts with this text.
async function invoiceRow(text) {
  const [row] = await sql("SELECT * FROM invoices WHERE status = 'pending' AND description LIKE ? ORDER BY created_at DESC LIMIT 1", [`${text}%`])
  return row
}

export const scenes = [
  {
    caption: 'Part 3: every money situation',
    say: 'Part three: money, for any project. One time items, payments in parts, paying too much, credit, waiving, refunds, paying ahead, discounts and extra charges. Everything happens on the Invoices page, the client page, or the subscription page.',
    open: async ({ go }) => {
      await resetSample()
      await go('/admin/invoices')
    },
    do: ({ wait }) => wait(1500),
  },
  {
    caption: 'A one-time item that can pause the app',
    say: 'A one time item, like a setup fee of two cedis, due ten days ago. Ticking the box means that if it stays unpaid it limits the app like an overdue subscription. Leave it unticked for something that should never pause the app, like a domain renewal.',
    open: async ({ page }) => {
      await newInvoice(page, { description: 'Setup fee', amount: 2, due: day(-10), pauses: true })
    },
    do: async ({ page, click, wait }) => {
      await page.locator(`${invoiceForm} input[name=pausesProject]`).scrollIntoViewIfNeeded()
      await wait(6000)
      await click(`${invoiceForm} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(1500)
    },
  },
  {
    caption: 'Paying in parts',
    say: 'The client pays one cedi in cash. Open Part payment on that invoice and record it. The invoice stays open with one cedi still owed, and the client gets a receipt.',
    open: ({ go }) => go('/admin/invoices?status=pending'),
    do: async ({ page, click, wait }) => {
      const inv = await invoiceRow('Setup fee')
      const form = `form[action="/admin/invoices/${inv.id}/part-payment"]`
      await reveal(page, form)
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=amount]`).fill('1')
      await page.locator(`${form} input[name=note]`).fill('Cash')
      await wait(2500)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.locator('text=still owed').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(3500)
    },
  },
  {
    caption: 'The pay link asks only for what is left',
    say: 'This is the page the client opens from their email. It asks only for the one cedi still owed, and says what was already paid. Pay now takes them to Paystack, and the payment is recorded on its own.',
    open: async ({ page }) => {
      const inv = await invoiceRow('Setup fee')
      await page.goto(`http://localhost:3100/pay/${inv.id}`)
    },
    do: ({ wait }) => wait(8000),
  },
  {
    caption: 'What the app is told',
    say: 'The app hears the same: one cedi of two already paid, one still owed, and because this item can pause the app and is overdue, the project is restricted until the rest arrives.',
    open: ({ page }) => appView(page),
    do: async ({ page, wait }) => {
      await wait(4000)
      await page.locator('h2:has-text("Invoices")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(4000)
    },
  },
  {
    caption: 'Paying too much becomes credit',
    say: 'Now the client sends three cedis by bank for the one cedi owed. Record it as usual. The invoice is settled, and the extra two cedis is kept as credit on their account, counted as income once.',
    open: ({ go }) => go('/admin/invoices?status=pending'),
    do: async ({ page, click, wait }) => {
      const inv = await invoiceRow('Setup fee')
      const form = `form[action="/admin/invoices/${inv.id}/part-payment"]`
      await reveal(page, form)
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=amount]`).fill('3')
      await page.locator(`${form} input[name=note]`).fill('Bank, paid extra')
      await wait(2000)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(1500)
    },
  },
  {
    caption: 'Account credit',
    say: 'On the client\'s page, account credit shows two cedis, with every line explained. You can also give credit yourself, for goodwill or a correction. Credit pays the client\'s next invoices automatically.',
    open: async ({ page }) => {
      const p = await jkbk()
      await page.goto(`http://localhost:3100/admin/clients/${p.client_id}`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, wait }) => {
      await page.locator('h2:has-text("Account credit")').scrollIntoViewIfNeeded()
      await reveal(page, 'form[action$="/credit"]')
      await wait(8000)
    },
  },
  {
    caption: 'Credit pays the next invoice',
    say: 'Watch: a new one cedi invoice is created, and the credit pays it straight away. The client is never asked to pay, and the credit balance goes down.',
    open: async ({ page }) => {
      await newInvoice(page, { description: 'Extra report', amount: 1 })
    },
    do: async ({ page, click, wait }) => {
      await click(`${invoiceForm} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.goto('http://localhost:3100/admin/invoices?status=paid')
      await wait(5000)
    },
  },
  {
    caption: 'Waive an invoice',
    say: 'To let an invoice go without payment, open Waive and give a reason. It closes like a paid one, it is never counted as income, and if it was a renewal the subscription moves on by exactly that period.',
    open: async ({ page }) => {
      await newInvoice(page, { description: 'Old support hours', amount: 5 })
      await page.locator(`${invoiceForm} button[type=submit]`).click()
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.goto('http://localhost:3100/admin/invoices?status=pending')
    },
    do: async ({ page, click, wait }) => {
      const inv = await invoiceRow('Old support hours')
      if (!inv) return wait(6000)
      const form = `form[action="/admin/invoices/${inv.id}/waive"]`
      await reveal(page, form)
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=reason]`).fill('Goodwill after the outage')
      await wait(2500)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(2000)
    },
  },
  {
    caption: 'Refund a payment',
    say: 'On a paid invoice, Refund gives money back. Paid through Paystack, tick the box and Paystack sends it back. Paid by hand, give it back yourself and record it here. A full refund of a renewal takes back the time it paid for.',
    open: async ({ page }) => {
      await page.goto('http://localhost:3100/admin/invoices?status=paid')
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, click, wait }) => {
      const [inv] = await sql("SELECT * FROM invoices WHERE status = 'paid' AND waived_reason IS NULL AND description LIKE 'Setup fee%' ORDER BY created_at DESC LIMIT 1")
      const form = `form[action="/admin/invoices/${inv.id}/refund"]`
      await reveal(page, form)
      await page.locator(form).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=amount]`).fill('0.50')
      await page.locator(`${form} input[name=reason]`).fill('Charged for a day of downtime')
      await wait(3000)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.locator('text=refunded').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(3000)
    },
  },
  {
    caption: 'Pay ahead, discounts, extra charges',
    say: 'On a subscription: bill several periods upfront, here six months with ten percent off, in one invoice. A standing discount takes a percentage off every renewal. Extra charges, like extra text messages, go on the next renewal once.',
    open: ({ go }) => go(`/admin/subscriptions/${HUB}`),
    do: async ({ page, click, wait }) => {
      await reveal(page, 'form[action$="/upfront"]')
      await page.locator('form[action$="/upfront"]').scrollIntoViewIfNeeded()
      await page.locator('form[action$="/upfront"] input[name=periods]').fill('6')
      await page.locator('form[action$="/upfront"] input[name=discount]').fill('10')
      await wait(2500)
      await reveal(page, 'form[action$="/discount"]')
      await reveal(page, 'form[action$="/charge"]')
      await page.locator('form[action$="/charge"] input[name=description]').fill('2,000 extra SMS')
      await page.locator('form[action$="/charge"] input[name=amount]').fill('0.5')
      await page.locator('form[action$="/charge"]').scrollIntoViewIfNeeded()
      await wait(2500)
      await click('form[action$="/charge"] button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      await reveal(page, 'form[action$="/upfront"]')
      await page.locator('form[action$="/upfront"] input[name=periods]').fill('6')
      await page.locator('form[action$="/upfront"] input[name=discount]').fill('10')
      await click('form[action$="/upfront"] button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.locator('h2:has-text("Invoices")').first().scrollIntoViewIfNeeded().catch(() => {})
      await wait(4000)
    },
  },
  {
    caption: 'Every payment, on one page',
    say: 'Finally, the project\'s full billing history shows every invoice and every payment: by Paystack, by hand, in parts, or from credit, with refunds and waivers marked.',
    open: async ({ page }) => {
      const p = await jkbk()
      await page.goto(`http://localhost:3100/admin/projects/${p.id}`)
    },
    do: async ({ page, wait }) => {
      await page.locator('h2:has-text("Payments")').scrollIntoViewIfNeeded()
      await wait(7000)
      await resetSample()
    },
  },
]
