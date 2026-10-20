// Agent chapter 1 of 5: joining, waiting for approval, and finding your way round.
// Starts signed out. Nothing is submitted on the registration form.
import { signIn, AGENT_EMAIL, APPLICANT_EMAIL } from './_agent.mjs'

export const meta = { title: 'Agent 1: Getting started' }

export const scenes = [
  {
    caption: 'Agent series, part 1: Getting started',
    say: 'Welcome to JKBK Data Hub. This is the first of five short videos on selling as an agent. Together they cover everything you can do. In this one, you will see how to join, what happens while you wait, and how to find your way around once you are in.',
    open: ({ go }) => go('/'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Step 1: Apply to become an agent',
    say: 'To join, click Become an agent, which opens the register page. If another agent sent you a link, it fills in their referral code for you. Fill in your full name, your phone number, your email, and a password of at least eight characters. Your phone number is also your login.',
    open: ({ go }) => go('/register'),
    do: async ({ type, wait }) => {
      await wait(2500)
      await type('#reg-name', 'Ama Mensah')
      await type('#reg-phone', '0244998877')
      await type('#reg-email', 'ama.mensah@example.com')
      await type('#reg-password', 'a long password')
      await wait(1500)
    },
  },
  {
    caption: 'Terms, age and referral code',
    say: 'The referral code box is optional. It is for the agent who invited you. Then tick the box to confirm you are eighteen or over, and that you accept the terms of service and the privacy policy. Both are links, so you can read them first. You cannot continue without ticking it. Then click Create account.',
    open: ({ go }) => go('/register'),
    do: async ({ point, click, wait }) => {
      await wait(2500)
      await point('#reg-referral').catch(() => {})
      await wait(5000)
      await click('#accept-terms').catch(() => {})
      await wait(5000)
      await point('button:has-text("Create account")').catch(() => {})
    },
  },
  {
    caption: 'Step 2: Wait for approval',
    say: 'Someone checks each new agent before switching them on, usually inside a day. When you sign in, you land on a status page that says your application is being reviewed. You get an email the moment you are approved, and your shop link works from then on.',
    open: (tools) => signIn(tools, APPLICANT_EMAIL, /\/app\/status/),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('h1').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'While you wait',
    say: 'Waiting does not stop you shopping. Click Browse the shop to buy bundles for yourself at the standard prices. When you are done, sign out, and come back later. We will sign back in as an approved agent now.',
    open: ({ go }) => go('/app/status'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('button:has-text("Browse the shop")').catch(() => {})
      await wait(6000)
      await point('button:has-text("Sign out")').catch(() => {})
    },
  },
  {
    caption: 'Step 3: Sign in',
    say: 'To sign in, open the log in page, enter your email and your password, and click Log in. If you forget your password, use the forgot password link, and you will be sent a one time link to choose a new one.',
    open: async (tools) => {
      await tools.page.evaluate(() => { try { localStorage.clear() } catch {} })
      await tools.go('/login')
    },
    do: async (tools) => {
      const { type, click, wait, page } = tools
      await wait(2500)
      await type('#login-email', AGENT_EMAIL)
      await type('#login-password', process.env.DEMO_PASSWORD ?? 'demo1234')
      await wait(1000)
      await click('button[type=submit]')
      await page.waitForURL(/\/app/, { timeout: 15000 }).catch(() => {})
      await wait(2500)
    },
  },
  {
    caption: 'Your dashboard',
    say: 'This is your dashboard. At the top is the money available to withdraw. Below it are what you earned today, what you have earned all time, how many orders you completed, and how many agents are under you. Then your sell link, your recent sales, and a chart of your last seven days.',
    open: ({ go }) => go('/app'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Earnings available to withdraw').catch(() => {})
      await wait(5000)
      await point('text=Your sell link').catch(() => {})
      await wait(5000)
      await point('text=Recent sales').catch(() => {})
    },
  },
  {
    caption: 'The menu',
    say: 'The menu on the left is grouped by job. Sell holds your sell link, your prices, and your shop look. Money holds your earnings and your withdrawals. Activity holds your sales and your reports. Feedback and announcements are at the bottom. On a phone, a few of these sit at the bottom of the screen, and the rest are behind more.',
    open: ({ go }) => go('/app'),
    do: async ({ point, wait }) => {
      await wait(1500)
      await point('nav >> text=Sell & refer').catch(() => {})
      await wait(5000)
      await point('nav >> text=Earnings').catch(() => {})
      await wait(5000)
      await point('nav >> text=Sales').catch(() => {})
      await wait(5000)
      await point('nav >> text=Feedback').catch(() => {})
    },
  },
  {
    caption: 'Learn how selling works',
    say: 'New to this? The learn how selling works card lists every page and every situation, and walks you through each one with a guided tour on the real screen. Take the tour button in the top bar starts a guided tour of the page you are on. Your progress is remembered.',
    open: ({ go }) => go('/app'),
    do: async ({ click, point, wait, page }) => {
      await wait(2000)
      await point('button:has-text("Take the tour")').catch(() => {})
      await wait(4000)
      await click('text=Learn how selling works').catch(() => {})
      await wait(8000)
      await page.evaluate(() => window.scrollTo(0, 0))
    },
  },
  {
    caption: 'Next: your sell link',
    say: 'That is how you get started. In the next video, we get your sell link, and invite other agents.',
    open: ({ go }) => go('/app'),
    do: ({ wait }) => wait(1000),
  },
]
