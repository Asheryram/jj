// Shared by the invoicing series. Everything here works on the LOCAL apps only: the billing
// app on :3100 with its local file database, the shop API on :3001 and the shop on :5173.
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'

export const DIAG = 'C:/Users/YramAsherTetteh-Abot/Downloads/diag'
export const BACKEND = 'C:/Users/YramAsherTetteh-Abot/Downloads/jj/backend'
export const SHOP = process.env.SHOP_URL ?? 'http://localhost:5173'
export const SHOP_API = 'http://localhost:3001'
export const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234'
export const OWNER = 'james@jamesdataconsult.com'
export const AGENT = 'kwame.boateng@example.com'
export const CUSTOMER = 'efua.asante@example.com'
export const APP_KEY = 'app_81a62db95cd8a4d0a83b907d' // the sample project, 'Example App'
export const HUB = '8a482fea03' // its plan
export const HOSTING = 'c84a46bbe1' // its hosting

// What any connected app is told about the sample project: its billing history page.
export async function appView(page) {
  const p = await jkbk()
  await page.goto(`http://localhost:3100/admin/projects/${p.id}`)
  await page.waitForLoadState('networkidle').catch(() => {})
}
const require = createRequire(DIAG + '/')
const { createClient } = require('@libsql/client')

export const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10)
export const at = (o) => new Date(Date.now() + o * 86400000).toISOString()

// A fresh connection per statement, retried while the billing app is mid-write.
export async function sql(text, args = []) {
  for (let i = 0; ; i++) {
    const c = createClient({ url: `file:${DIAG}/data/local-dev.db` })
    try {
      return (await c.execute({ sql: text, args })).rows
    } catch (e) {
      if (e.code !== 'SQLITE_BUSY' || i > 60) throw e
      await new Promise((r) => setTimeout(r, 150))
    } finally {
      c.close()
    }
  }
}

export async function jkbk() {
  // The sample project, found by its licence key so its name can be anything.
  const [project] = await sql('SELECT * FROM projects WHERE app_key = ?', [APP_KEY])
  return project
}

// The sample back to normal: both JKBK services paid well ahead, nothing open, no credit.
export async function resetSample() {
  await clearLoginLimit()
  const p = await jkbk()
  await sql(
    "UPDATE subscriptions SET paid_through = ?, mode = 'auto', ends_at = NULL, end_effect = NULL, courtesy_until = NULL, discount_percent = 0, paused_at = NULL, pause_until = NULL, last_stage = 'active' WHERE project_id = ?",
    [at(40), p.id]
  )
  await sql("UPDATE invoices SET status = 'canceled' WHERE status = 'pending'")
  await sql('DELETE FROM credit_entries WHERE client_id = ?', [p.client_id])
  await sql('DELETE FROM subscription_charges WHERE invoice_id IS NULL')
  await sql(
    'UPDATE projects SET public_notice = NULL, sms_numbers = NULL, notice_note = NULL, billing_emails = NULL, default_grace_days = NULL, default_suspend_after_days = NULL WHERE id = ?',
    [p.id]
  )
  await shopCheck()
}

// Moves a subscription's paid-through date (days from today; negative is overdue).
export async function setPaidThrough(subId, offsetDays) {
  await sql('UPDATE subscriptions SET paid_through = ?, courtesy_until = NULL WHERE id = ?', [at(offsetDays), subId])
}

// The shop asks the billing app now, instead of waiting for its hourly check.
export async function shopCheck() {
  try {
    const login = await fetch(`${SHOP_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: OWNER, password: PASSWORD }),
    })
    const { accessToken } = await login.json()
    const r = await fetch(`${SHOP_API}/api/license/check`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } })
    return (await r.json()).stage
  } catch {
    return null
  }
}

// The billing app allows 10 sign-in attempts per 15 minutes; a recording signs in many
// times in a row, so on the LOCAL copy the counter is cleared first.
export async function clearLoginLimit() {
  await sql('DELETE FROM login_attempts')
  // A recording that was stopped halfway through the two-factor scene can leave it on.
  await sql('UPDATE admin_credentials SET totp_secret = NULL, totp_last_counter = NULL WHERE id = 1')
}

export function billingMeta(title) {
  return {
    title,
    async login({ page, go }) {
      page.on('dialog', (dialog) => dialog.accept().catch(() => {}))
      await clearLoginLimit()
      await go('/admin/login')
      await page.fill('input[name=password]', PASSWORD)
      await page.click('button[type=submit]')
      await page.waitForURL(/\/admin(\/)?$/, { timeout: 15000 })
    },
  }
}

// Opens every <details> around something, so a form inside a collapsed section can be used.
export const reveal = (page, selector) =>
  page.evaluate((sel) => {
    let el = document.querySelector(sel)
    while (el) {
      if (el.tagName === 'DETAILS') el.open = true
      el = el.parentElement
    }
  }, selector)

export async function shopLogout(page) {
  await page.goto(`${SHOP}/`)
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('jdc.storageNoticeSeen', '1')
      localStorage.setItem('jdc.learn.collapsed', '1')
    } catch {}
  })
}

export async function shopAs(page, email, path) {
  await shopLogout(page)
  await page.goto(`${SHOP}/login`)
  await page.fill('#login-email', email)
  await page.fill('#login-password', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 }).catch(() => {})
  await page.goto(`${SHOP}${path}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1800)
}

export async function guest(page, path) {
  await shopLogout(page)
  await page.goto(`${SHOP}${path}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1800)
}

// ---------------------------------------------------------------- stopping and starting the apps

function pidOn(port) {
  try {
    const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, { encoding: 'utf8' })
    const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s`).test(l))
    return line ? line.trim().split(/\s+/).pop() : null
  } catch {
    return null
  }
}

export function stop(port) {
  const pid = pidOn(port)
  if (pid) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' })
}

async function waitFor(url, up = true) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url)
      if (up && r.status < 500) return
    } catch {
      if (!up) return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

export async function startBilling() {
  const log = openSync(`${DIAG}/data/video-billing.log`, 'a')
  spawn(process.execPath, ['scripts/dev-local.js'], { cwd: DIAG, detached: true, stdio: ['ignore', log, log] }).unref()
  await waitFor('http://localhost:3100/admin/login')
}

// The shop API with the licence settings a scene needs.
export async function startShopApi(licenceEnv = {}) {
  stop(3001)
  await new Promise((r) => setTimeout(r, 1500))
  const keys = JSON.parse(readFileSync(`${DIAG}/data/local-keys.json`, 'utf8'))
  const env = {
    ...process.env,
    SUPERADMIN_EMAIL: 'operator@example.com',
    PUBLIC_APP_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://jdc:jdc_dev_password@localhost:5433/demo_video',
    DIRECT_URL: 'postgresql://jdc:jdc_dev_password@localhost:5433/demo_video',
    ANALYTICS_DATABASE_URL: 'postgresql://jdc:jdc_dev_password@localhost:5433/demo_video_analytics',
    GMPL_LIVE: 'false',
    DATAHUB_LIVE: 'false',
    PORT: '3001',
    LICENSE_URL: 'http://localhost:3100/license/app_81a62db95cd8a4d0a83b907d',
    LICENSE_PUBLIC_KEY: keys.publicKeyBase64,
    LICENSE_ENFORCE: 'true',
    LICENSE_WARN_AGENTS: 'true',
    LICENSE_STRICT_SUSPEND: 'false',
    ...licenceEnv,
  }
  const log = openSync(`${DIAG}/data/video-shop-api.log`, 'a')
  spawn(process.execPath, ['dist/main'], { cwd: BACKEND, env, detached: true, stdio: ['ignore', log, log] }).unref()
  await waitFor(`${SHOP_API}/api/health/ping`)
  await new Promise((r) => setTimeout(r, 2500))
  await shopCheck()
}

// A TOTP code for a base32 secret, from the billing app's own implementation.
export function codeFor(secret, stepOffset = 0) {
  const totp = require('./src/totp')
  return totp.codeAt(secret, totp.counterFor(Date.now()) + stepOffset)
}
