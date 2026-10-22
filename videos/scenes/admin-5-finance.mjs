// Admin chapter 5 of 8: finance, the supplier float, subscriptions and analytics.
// Signs in as the platform owner, because float corrections and the editable
// side of subscriptions are superadmin only.
import { adminMeta, SUPERADMIN_EMAIL } from './_admin.mjs'

export const meta = adminMeta('Admin 5: Finance, float and analytics', SUPERADMIN_EMAIL)

export const scenes = [
  {
    caption: 'Admin series, part 5: Money',
    say: 'In this video you will learn how to read the books: what you can actually spend, how to track your supplier float, how to correct a mistake, and how to follow the business in analytics. You will see a few extra tools here, because we are signed in as the platform owner.',
    open: ({ go }) => go('/admin/finance'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Money held and money owed',
    say: 'Finance starts with money held and money owed. The key line is actually free to spend. It is what should be sitting at Paystack, minus everything already owed to an agent, a customer, or the float. It is cash, not profit, so it can differ from the profit figure on the orders page. If it goes negative, you owe more than you hold.',
    open: ({ go }) => go('/admin/finance'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Money held and money owed').catch(() => {})
      await wait(8000)
    },
  },
  {
    caption: 'The provider float',
    say: 'Every order spends from a prepaid balance at your supplier, called the float. The provider float card has a tab for each supplier, data hub and G M P L. It shows what should be left, going by your logged top ups and costs. If it says the float is short, orders can fail to deliver even though customers have paid, so top up first.',
    open: ({ go }) => go('/admin/finance'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await point('text=Provider float').catch(() => {})
      await wait(4000)
      await click('button:has-text("GMPL") >> nth=0').catch(() => {})
      await wait(4000)
      await click('button:has-text("DataHub GH") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Log a top-up',
    say: 'Top up your supplier account directly with them first, because this platform never moves that money for you. Then click Log a top-up, and record the amount. Choose where it came from. Outside the business is your own money. Paystack, paying the supplier back is for money that came from the business mobile money linked to Paystack, and it is the only kind that clears the already spent on bundles figure.',
    open: ({ go }) => go('/admin/finance'),
    do: async ({ click, wait, page }) => {
      await wait(2500)
      await click('button:has-text("Log a top-up")').catch(() => {})
      await wait(10000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Log money taken out',
    say: 'If you take money back out of the supplier account, log that the same way with Log money taken out, so the float figure stays honest. These entries track your own capital. They never count as revenue or cost, and they do not change profit anywhere else.',
    open: ({ go }) => go('/admin/finance'),
    do: async ({ click, wait, page }) => {
      await wait(2500)
      await click('button:has-text("Log money taken out")').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Where the money goes',
    say: 'Lower down, where the money goes breaks the real picture into parts. Switch between seven days, thirty days, and all time to see how it changes.',
    open: ({ go }) => go('/admin/finance'),
    do: async ({ point, click, wait }) => {
      await wait(2500)
      await point('text=Where the money goes').catch(() => {})
      await wait(3500)
      await click('button:has-text("30 days")').catch(() => {})
      await wait(3500)
      await click('button:has-text("All time")').catch(() => {})
      await wait(3000)
      await click('button:has-text("7 days")').catch(() => {})
    },
  },
  {
    caption: 'Float corrections',
    say: 'Logged a top up as your own money, when it really came from Paystack paying the supplier back? Or logged one that never really happened? Only the platform owner can fix that, on the float corrections page. Nothing is listed until you deliberately type a search, so nobody corrects the wrong entry by accident. Correcting changes figures like free to spend elsewhere, so it is one step more sensitive than logging a new entry.',
    open: ({ go }) => go('/admin/finance/float-corrections'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Search for the entry to correct').catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'Subscriptions',
    say: 'Subscriptions tracks the things the platform pays for, like hosting, your domain name, Paystack, and data hub, so nothing lapses without warning. Each service shows when it expires and a badge for how close that is. The platform owner can add a service, mark it renewed, edit it, or remove it. A plain admin sees what is coming up, but cannot change it.',
    open: ({ go }) => go('/admin/subscriptions'),
    do: async ({ point, click, wait, page }) => {
      await wait(3000)
      await point('text=Tracked services').catch(() => {})
      await wait(5000)
      await click('button:has-text("Add a service")').catch(() => {})
      await wait(6000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Analytics',
    say: 'Analytics answers the bigger questions. It reads a separate reporting store that is updated on a schedule, so it is not a live view like the other pages. Overview asks is the business growing. Money asks where the profit comes from. Sales, operations, agents, and cash each answer one question. Cash asks the most important one: can we keep selling tomorrow.',
    open: ({ go }) => go('/analytics'),
    do: async ({ click, wait }) => {
      await wait(3500)
      for (const tab of ['Money', 'Sales', 'Operations', 'Agents', 'Cash']) {
        await click(`button:has-text("${tab}")`).catch(() => {})
        await wait(4200)
      }
    },
  },
  {
    caption: 'Next: people',
    say: 'That covers the money. Next, the people: approving agents, suspending accounts, and managing your own team.',
    open: ({ go }) => go('/admin/finance'),
    do: ({ wait }) => wait(1000),
  },
]
