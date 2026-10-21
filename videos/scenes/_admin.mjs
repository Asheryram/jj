// Shared by every admin chapter: how to sign in, and the two accounts used.
// A plain admin cannot see Platform team, Custom domains, Float corrections or
// the editable half of Subscriptions, so the chapters that cover those sign in
// as the superadmin instead.
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234'

export const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'james@jamesdataconsult.com'
export const SUPERADMIN_EMAIL = process.env.DEMO_SUPERADMIN_EMAIL ?? 'operator@example.com'

export function adminMeta(title, email = ADMIN_EMAIL) {
  return {
    title,
    async login({ page, go, type, click }) {
      await go('/login')
      await type('#login-email', email)
      await type('#login-password', PASSWORD)
      await click('button[type=submit]')
      await page.waitForURL(/\/(admin|analytics)/, { timeout: 15000 })
      await page.waitForLoadState('networkidle').catch(() => {})
    },
  }
}
