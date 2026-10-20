// Admin chapter 1 of 8: finding your way around.
import { adminMeta } from './_admin.mjs'

export const meta = adminMeta('Admin 1: Getting started')

export const scenes = [
  {
    caption: 'Admin series, part 1: Getting started',
    say: 'Welcome to the JKBK Data Hub admin series. There are eight short videos, and together they cover everything you can do as an admin. This first one shows you around: the overview, the menu, the help page, and the assistant.',
    open: ({ go }) => go('/admin'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'The overview',
    say: 'This is your overview, and it is where every day should start. It shows revenue and margin for the last seven days, how many orders are in flight, and how many people are active. Below that you will find daily revenue, revenue by category, your top agents, and the latest orders.',
    open: ({ go }) => go('/admin'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Revenue, last 7 days').catch(() => {})
      await wait(5000)
      await point('text=Top agents').catch(() => {})
      await wait(4000)
      await point('text=Latest orders').catch(() => {})
    },
  },
  {
    caption: 'Get set up',
    say: 'At the top is the get set up checklist. It stays until three jobs are done: log a float for one of your suppliers, price your catalogue, and set your own payout number. Nothing sells properly until the first two are finished, so do them first. The later videos show how.',
    open: ({ go }) => go('/admin'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Get set up').catch(() => {})
      await wait(6000)
      await point('text=Price your catalogue').catch(() => {})
    },
  },
  {
    caption: 'Needs your attention',
    say: 'Just below it, the needs your attention card is your to do list. It tells you in plain words when orders failed, when refunds are waiting, when withdrawals are waiting, or when the float is running short. Each line has a link that takes you straight to the right page.',
    open: ({ go }) => go('/admin'),
    do: async ({ point, wait }) => {
      await wait(2000)
      await point('text=Needs your attention').catch(() => {})
      await wait(5000)
      await point('text=Money held and money owed').catch(() => {})
    },
  },
  {
    caption: 'The menu',
    say: 'The menu on the left is grouped by job. Orders holds all orders, needs attention, and number approvals. Money holds refunds, withdrawals, finance, float risk, and subscriptions. Catalogue is for prices, accuracy, and branding. People is for users and your team. Settings is last. Some items, like platform team and custom domains, are only for the platform owner.',
    open: ({ go }) => go('/admin'),
    do: async ({ point, wait }) => {
      await wait(1500)
      await point('nav >> text=All orders').catch(() => {})
      await wait(4500)
      await point('nav >> text=Withdrawals').catch(() => {})
      await wait(5000)
      await point('nav >> text=Settings').catch(() => {})
    },
  },
  {
    caption: 'Learn the admin',
    say: 'New to all this? The learn the admin card on the overview lists every page and every situation, and walks you through each one with a guided tour, step by step on the real screen. You can collapse it once you have finished, and your progress is remembered.',
    open: ({ go, page }) => go('/admin'),
    do: async ({ point, click, wait, page }) => {
      await wait(2000)
      await click('text=Learn the admin').catch(() => {})
      await wait(7000)
      await page.evaluate(() => window.scrollTo(0, 0))
      await point('text=Learn the admin').catch(() => {})
    },
  },
  {
    caption: 'The help page',
    say: 'The what you can do button opens the help page. It is a searchable guide with every task explained in order: getting set up, orders and money, people, shops, and settings. Search for a word like refund or withdraw, and it shows you just the steps you need.',
    open: ({ go }) => go('/info'),
    do: async ({ type, wait }) => {
      await wait(3000)
      await type('input[placeholder*="Search"]', 'refund').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'The assistant',
    say: 'And if you would rather just ask, the assistant answers questions about your own platform. Try is the float okay right now, or any refunds waiting on me, or anything need my attention. It looks at your live numbers and answers in plain words.',
    open: ({ go }) => go('/admin/assistant'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('button:has-text("Is the float okay right now?")').catch(() => {})
      await wait(5000)
      await point('button:has-text("Any refunds waiting on me?")').catch(() => {})
    },
  },
  {
    caption: 'Next: prices and catalogue',
    say: 'That is the lay of the land. In the next video, we price the catalogue, because nothing sells until it is priced.',
    open: ({ go }) => go('/admin'),
    do: ({ wait }) => wait(1000),
  },
]
