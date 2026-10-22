// Shared by the agent chapters: the demo accounts and how to sign in as one.
// Ama is an applicant still waiting to be approved; Kwame is a working agent.
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234'

export const AGENT_EMAIL = process.env.DEMO_EMAIL ?? 'kwame.boateng@example.com'
export const APPLICANT_EMAIL = process.env.DEMO_APPLICANT_EMAIL ?? 'ama.mensah@example.com'

/** Type the credentials into the real login form, the way a person would. */
export async function signIn({ go, type, click, page }, email, landing) {
  await go('/login')
  await type('#login-email', email)
  await type('#login-password', PASSWORD)
  await click('button[type=submit]')
  await page.waitForURL(landing, { timeout: 15000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}

export function agentMeta(title) {
  return {
    title,
    login: (tools) => signIn(tools, AGENT_EMAIL, /\/app/),
  }
}
