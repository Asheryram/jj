// Invoicing series, part 5: safety, settings and running it day to day. Only the invoicing
// app is shown, plus two plain explanation cards for what happens inside a connected app.
// LOCAL copy only.
import { billingMeta, resetSample, appView, sql, jkbk, reveal, codeFor, clearLoginLimit, PASSWORD } from './_billing.mjs'

export const meta = billingMeta('Invoicing 5: safety, settings and running it')

const RUN = String(Date.now()).slice(-5)
const B = 'http://localhost:3100'

async function billingLogin(page, email = '') {
  await clearLoginLimit()
  await page.goto(`${B}/admin/login`)
  if (email) await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', email ? 'viewer-password-1' : PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForLoadState('networkidle').catch(() => {})
}

// A plain card explaining something that happens inside the connected app, not on screen here.
function card(page, title, lines) {
  const items = lines.map((l) => `<li>${l}</li>`).join('')
  return page.setContent(`<!doctype html><html><body style="margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#0f1222;color:#e8eaf6;display:flex;align-items:center;justify-content:center;height:100vh">
    <div style="max-width:880px;padding:48px 56px;border-radius:20px;background:#191d36;border:1px solid #2c3260">
      <div style="font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#8f97d6">Inside any connected app</div>
      <h1 style="margin:10px 0 22px;font-size:38px">${title}</h1>
      <ul style="font-size:23px;line-height:1.7;margin:0;padding-left:26px">${items}</ul>
    </div></body></html>`)
}

export const scenes = [
  {
    caption: 'Safety, settings and running it',
    say: 'Part five: what keeps this safe, and how to run it day to day. What a connected app does if the invoicing app is down, starting new apps in report only mode, your own pause message, reminders by text, your team and their roles, two factor sign in, and the health checks.',
    open: async ({ go }) => {
      await resetSample()
      await go('/admin')
    },
    do: ({ wait }) => wait(1500),
  },
  {
    caption: 'If the invoicing app is down',
    say: 'If the invoicing app is ever down or cannot be reached, connected apps do not guess and do not block. They carry on as if everything were paid, the subscription simply shows blank, and their owner sees a note that billing could not be confirmed. The next answer from the invoicing app counts again straight away. A problem on the billing side never stops a client\'s business.',
    open: ({ page }) => card(page, 'If the invoicing app is down', [
      'The app cannot reach it, so it carries on as if everything is paid',
      'Nothing is blocked; the subscription shows blank',
      'The app\'s owner sees: billing could not be confirmed',
      'The next answer counts again, with nothing to restart',
    ]),
    do: ({ wait }) => wait(16000),
  },
  {
    caption: 'Start every new app in report only mode',
    say: 'When you connect a new app, set enforcement to false in its server settings at first. The app reads its status and its owner sees the banner, but nothing is blocked. Watch it for a few days. When the status is right, set it to true. Apps can offer two more options: a stricter pause once suspended, and a day\'s notice to their staff before new sales pause. When you change the signing key, give apps both the old and the new public key until the change is done.',
    open: ({ page }) => card(page, 'The app\'s own settings', [
      'LICENSE_URL and LICENSE_PUBLIC_KEY: from the project, once',
      'LICENSE_ENFORCE=false first: report only, nothing blocked',
      'LICENSE_ENFORCE=true once the status looks right',
      'Optional: a stricter pause, and a warning to staff',
      'New signing key: list both public keys, then drop the old one',
    ]),
    do: ({ wait }) => wait(22000),
  },
  {
    caption: 'Each project\'s billing settings',
    say: 'Back in the invoicing app. On the client page, each project has billing settings: its own grace, pause and invoice timings, extra people who get its billing emails, phone numbers for text or WhatsApp reminders once something is overdue, a note added to every billing email, like your bank details, and the message its app shows the public while paused.',
    open: async ({ page }) => {
      const p = await jkbk()
      await page.goto(`${B}/admin/clients/${p.client_id}`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, click, wait }) => {
      const p = await jkbk()
      const form = `form[action="/admin/clients/${p.client_id}/projects/${p.id}/billing"]`
      await reveal(page, form)
      await page.locator(`${form} input[name=graceDays]`).scrollIntoViewIfNeeded()
      await wait(5000)
      await page.locator(`${form} input[name=noticeNote]`).fill('Pay by bank: GCB 1234567, use your invoice number')
      await page.locator(`${form} input[name=publicNotice]`).scrollIntoViewIfNeeded()
      await page.locator(`${form} input[name=publicNotice]`).fill('We are upgrading our service and will be back very soon.')
      await wait(6000)
      await click(`${form} button[type=submit]`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(1500)
    },
  },
  {
    caption: 'Texts, tax, currencies, quiet hours',
    say: 'Text and WhatsApp reminders start once you connect a provider, Hubtel, Twilio, or your own, in the invoicing app\'s settings. The same settings add tax on top of every invoice, allow other currencies, and hold reminders during quiet hours at night.',
    open: ({ page }) => card(page, 'Optional settings in the invoicing app', [
      'SMS_PROVIDER: hubtel, twilio, or webhook (WhatsApp through Twilio)',
      'TAX_NAME and TAX_PERCENT: tax added on top of each invoice',
      'SUPPORTED_CURRENCIES: bill in more than one currency',
      'QUIET_HOURS and BUSINESS_TIMEZONE: no reminders at night',
    ]),
    do: ({ wait }) => wait(14000),
  },
  {
    caption: 'Your team and their roles',
    say: 'Under People, add someone with their own sign in. Finance can do all the billing work. A viewer can look at everything and change nothing. Let us sign in as a viewer and try to add a client: it is refused.',
    open: async ({ page }) => {
      await page.goto(`${B}/admin/users`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, click, wait }) => {
      await page.fill('form[action="/admin/users"] input[name=email]', `viewer.${RUN}@example.com`)
      await page.fill('form[action="/admin/users"] input[name=name]', 'Abena (viewer)')
      await page.selectOption('form[action="/admin/users"] select[name=role]', 'viewer')
      await page.fill('form[action="/admin/users"] input[name=password]', 'viewer-password-1')
      await wait(2000)
      await click('form[action="/admin/users"] button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(2000)
      await page.context().clearCookies()
      await billingLogin(page, `viewer.${RUN}@example.com`)
      await page.goto(`${B}/admin/reports`)
      await wait(2500)
      await page.goto(`${B}/admin/clients`)
      await page.fill('form[action="/admin/clients"] input[name=name]', 'Test')
      await page.fill('form[action="/admin/clients"] input[name=email]', 'test@example.com')
      await click('form[action="/admin/clients"] button[type=submit]')
      await wait(4500)
      await page.context().clearCookies()
      await billingLogin(page)
    },
  },
  {
    caption: 'Two-factor sign-in',
    say: 'Under Account and sign in, turn on two factor sign in. Add the key to any authenticator app, type the code it shows, and from then on signing in needs your password and a code from your phone. This is the most important setting on the live app.',
    open: async ({ page }) => {
      await page.goto(`${B}/admin/account`)
      await page.waitForLoadState('networkidle').catch(() => {})
    },
    do: async ({ page, click, wait }) => {
      await click('form[action="/admin/account/2fa/start"] button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(3500)
      const secret = (await page.locator('pre.code-block').first().innerText()).replace(/\s/g, '')
      await page.fill('form[action="/admin/account/2fa/confirm"] input[name=code]', codeFor(secret))
      await wait(1500)
      await click('form[action="/admin/account/2fa/confirm"] button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      await wait(3000)
      await page.context().clearCookies()
      await billingLogin(page)
      await wait(3500)
      await page.fill('input[name=code]', codeFor(secret, 1))
      await page.click('button[type=submit]')
      await page.waitForLoadState('networkidle').catch(() => {})
      // Off again, so the local demo keeps signing in with a password only.
      await page.goto(`${B}/admin/account`)
      await reveal(page, 'form[action="/admin/account/2fa/off"]')
      await page.fill('form[action="/admin/account/2fa/off"] input[name=code]', codeFor(secret, 2))
      await page.locator('form[action="/admin/account/2fa/off"] button[type=submit]').click()
      await page.waitForLoadState('networkidle').catch(() => {})
    },
  },
  {
    caption: 'The audit log',
    say: 'Everything you just did is in the audit log: the new person, the viewer\'s refused attempt, the settings change, with who, when and from where. Passwords and codes are never stored.',
    open: ({ go }) => go('/admin/audit'),
    do: ({ wait }) => wait(7000),
  },
  {
    caption: 'Health checks and alerts',
    say: 'Reports shows whether the daily job is running. If it stops, every billing screen says so. You also get an urgent email whenever a project is paused for non payment, and a daily summary listing any app that has stopped checking in, which usually means it is down or its settings were removed.',
    open: ({ go }) => go('/admin/reports'),
    do: async ({ page, wait }) => {
      await page.locator('h2:has-text("Daily job")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(9000)
    },
  },
  {
    caption: 'Exports',
    say: 'At the bottom of Reports, download invoices, payments, subscriptions, account credit, transactions and the audit log as spreadsheets, for your accountant or your own records.',
    open: ({ go }) => go('/admin/reports'),
    do: async ({ page, wait }) => {
      await page.locator('h2:has-text("Download as CSV")').scrollIntoViewIfNeeded().catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'That is everything',
    say: 'That is the whole invoicing app: clients, projects, subscriptions and one time items, every way of paying, every change, every stage, and what any connected app does at each. Remember three things. Each project stands alone. Payouts, refunds and staff log in are never blocked. And if the invoicing app is down, every app keeps working.',
    open: async ({ go }) => {
      await resetSample()
      await go('/admin')
    },
    do: ({ wait }) => wait(2000),
  },
]
