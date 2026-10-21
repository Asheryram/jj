// The agent walkthrough. Each scene has:
//   caption  the on-screen line
//   say      the narration (follows the agent guide in frontend/src/data/helpGuide.ts)
//   open     brings the right page up BEFORE the voice starts
//   do       what the cursor does WHILE the voice speaks
//
// Scenes only look and type; they never press a button that saves or sends
// anything (prices, withdrawals, branding), so a run changes nothing.
const EMAIL = process.env.DEMO_EMAIL ?? 'kwame.boateng@example.com'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234'

export const meta = {
  title: 'How to sell as an agent',
  async login({ page, go, type, click }) {
    await go('/login')
    await type('#login-email', EMAIL)
    await type('#login-password', PASSWORD)
    await click('button[type=submit]')
    await page.waitForURL('**/app**', { timeout: 15000 })
    await page.waitForLoadState('networkidle').catch(() => {})
  },
}

export const scenes = [
  {
    caption: 'Selling as an agent',
    say: 'Welcome to JKBK Data Hub. In this video you will learn how to sell as an agent: get your shop link, set your prices, track your sales, and withdraw your earnings.',
    open: ({ go }) => go('/app'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Your dashboard',
    say: 'This is your dashboard. It shows your balance, your recent sales, and your sell link, all in one place. The menu on the left takes you everywhere else.',
    open: ({ go }) => go('/app'),
    do: async ({ point, wait }) => {
      await wait(1500)
      await point('text=Your sell link').catch(() => {})
      await wait(3000)
      await point('nav >> text=Sell & refer').catch(() => {})
    },
  },
  {
    caption: 'Step 1: Get your sell link',
    say: 'First, your sell link. Open Sell and refer. This is the one link that earns you money. Customers who buy through it pay your prices, and your margin lands in your earnings the moment the order completes. You never touch the money, and you never hold stock.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ point, wait }) => {
      await wait(4000)
      await point('text=Share my shop on WhatsApp').catch(() => {})
      await wait(6000)
      await point('text=Your referral link').catch(() => {})
    },
  },
  {
    caption: 'Step 2: Set your own prices',
    say: 'Next, your prices. Open My prices. To change one product, click Edit on its row and type your resale price. It can be anything from your own cost upward. To change everything at once, use Apply markup to all, and pick a percentage over your cost.',
    open: ({ go }) => go('/app/pricing'),
    do: async ({ click, point, wait, page }) => {
      await wait(3500)
      await click('button:has-text("Edit") >> nth=0').catch(() => {})
      await wait(4500)
      await page.keyboard.press('Escape')
      await wait(1500)
      await point('button:has-text("Apply markup to all")').catch(() => {})
    },
  },
  {
    caption: 'Step 3: Make the shop yours',
    say: 'Under Shop look, you can set your shop name and your logo. Send them for approval, and your shop keeps its current name and logo until they are approved. Names that look like a bank or a mobile network are refused, so customers always know who they are paying. Your colour and your product tile style are different: apply them and they go live straight away, with no review.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Shop name').catch(() => {})
      await wait(5000)
      await point('text=Logo').catch(() => {})
    },
  },
  {
    caption: 'Step 4: See your sales',
    say: 'To follow your sales, open Sales. Filter by completed, in progress, or failed, or search by number or reference. Click any order to see how the sale was split. If an order fails, it is refunded automatically and your margin is reversed. You do nothing.',
    open: ({ go }) => go('/app/orders'),
    do: async ({ click, point, wait, page }) => {
      await wait(2500)
      await point('text=Completed').catch(() => {})
      await wait(3500)
      await click('tbody tr >> nth=0').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Step 5: Check your earnings',
    say: 'Earnings shows every credit, reversal and withdrawal, newest first. It only ever grows: nothing in this list can be edited, only added to, so you can always trust it.',
    open: ({ go }) => go('/app/earnings'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Available to withdraw').catch(() => {})
      await wait(4000)
      await point('text=Earnings, last 7 days').catch(() => {})
    },
  },
  {
    caption: 'Step 6: Withdraw your money',
    say: 'When you are ready to be paid, open Withdraw and click Request withdrawal. Enter an amount, pick your Mobile Money network, and the number to pay. The amount, plus a flat one cedi sending fee, is held right away. The smallest withdrawal is ten cedis, and you can have up to three requests waiting at once. Each request is reviewed and paid by hand, usually within twenty four hours, and you get a text when it is sent. Until then, you can cancel it, and both the amount and the fee come back.',
    open: ({ go }) => go('/app/withdrawals'),
    do: async ({ click, wait, page }) => {
      await wait(3500)
      await click('button:has-text("Request withdrawal")').catch(() => {})
      await wait(9000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Step 7: Reports',
    say: 'Finally, Reports. Pick a range from the date list, like today, last seven days, this month, or this year, or choose your own dates, and export the figures as a spreadsheet.',
    open: ({ go }) => go('/app/reports'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Export CSV').catch(() => {})
    },
  },
  {
    caption: 'You are ready to sell',
    say: 'That is everything. Share your link, set fair prices, and watch your earnings grow. If you ever get stuck, ask the assistant in the menu, or open the help page. Happy selling.',
    open: ({ go }) => go('/app'),
    do: ({ wait }) => wait(1000),
  },
]
