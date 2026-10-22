// Agent chapter 3 of 5: prices, the shop's look and a web address.
// Opens dialogs and picks options, but never saves or sends anything.
import { agentMeta } from './_agent.mjs'

export const meta = agentMeta('Agent 3: Prices and your shop')

export const scenes = [
  {
    caption: 'Agent series, part 3: Prices and your shop',
    say: 'In this video you will learn how to set your own prices, make the shop look like yours, and ask for a web address of your own.',
    open: ({ go }) => go('/app/pricing'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'My prices',
    say: 'Open My prices. This is where you decide what your customers pay. You buy at your own cost and charge what you like, and the difference is yours. Pick a category along the top, data or checkers, and narrow it to one network with the filters, all, M T N, Telecel, or Airtel Tigo.',
    open: ({ go }) => go('/app/pricing'),
    do: async ({ click, point, wait }) => {
      await wait(3000)
      await click('button:has-text("Checkers") >> nth=0').catch(() => {})
      await wait(3500)
      await click('button:has-text("Data") >> nth=0').catch(() => {})
      await wait(2500)
      await click('button:has-text("Telecel")').catch(() => {})
      await wait(3500)
      await click('button:has-text("All") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Set the price of one product',
    say: 'To change one product, click Edit on its row, type your resale price, and click Save price. It can be anything from your own cost upward, and there is no ceiling. If you change your mind, the Reset button on a row puts it back to the standard price.',
    open: ({ go }) => go('/app/pricing'),
    do: async ({ click, point, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Edit") >> nth=0').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
      await wait(1000)
      await point('button:has-text("Reset") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Set every price at once',
    say: 'To change everything at once, click Apply markup to all. Pick a percentage over your cost, from five percent to thirty, check the live example it shows you, and confirm. It is the quickest way to price your whole shop, and you can still adjust any single product afterwards.',
    open: ({ go }) => go('/app/pricing'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Apply markup to all")').catch(() => {})
      await wait(9000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Your shop look',
    say: 'Open Shop look. Here you set your shop name, up to forty characters, and your logo, a P N G, J P E G or Web P file under a hundred kilobytes. Click Send for approval, and your shop keeps its current name and logo until they are approved, usually quickly. Sending again replaces whatever was waiting.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Shop name and mark').catch(() => {})
      await wait(6000)
      await point('button:has-text("Send for approval")').catch(() => {})
    },
  },
  {
    caption: 'What gets refused',
    say: 'A name or logo that looks like a bank, a mobile network, or another company will be refused. Your shop takes payment details, and customers have to be able to tell who they are paying. The payment page and receipts always show the platform\'s own registered business name, whatever your shop is called.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Checked before it goes live').catch(() => {})
      await wait(8000)
    },
  },
  {
    caption: 'Colour and product tiles',
    say: 'Colour is different, because it needs no approval. Pick one from the gallery, or choose your own and type a hex code, with an optional separate colour for dark mode, then click Apply colour, and it goes live straight away. You can also choose how your product tiles look, classic, bold, minimal, or compact, and apply that the same way.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, click, wait, page }) => {
      await wait(2500)
      await page.evaluate(() => window.scrollBy(0, 400))
      await wait(1500)
      await click('button:has-text("Emerald")').catch(() => {})
      await wait(4000)
      await point('button:has-text("Or pick your own colour")').catch(() => {})
      await wait(5000)
      await click('button:has-text("Bold")').catch(() => {})
    },
  },
  {
    caption: 'Your own web address',
    say: 'At the bottom is your own web address. You can pick a free subdomain, or use a domain you already own, such as your shop dot com. Type just the domain, with no https and no www, choose monthly or yearly billing, and click Send for approval. Asking for a different one replaces the one you have.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, wait, page }) => {
      await wait(2000)
      await page.evaluate(() => window.scrollTo(0, 99999))
      await wait(3000)
      await point('text=Your own web address').catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'Going live',
    say: 'Once it is approved, add the C name record shown on the page at your domain\'s registrar. The platform checks every six hours, and switches it on once it points at us, so you do not need to keep checking. The monthly or yearly price is charged from your balance once it is live. When it is live, it shows as a clickable link on your dashboard.',
    open: ({ go }) => go('/app/shop-look'),
    do: async ({ point, wait, page }) => {
      await wait(2000)
      await page.evaluate(() => window.scrollTo(0, 99999))
      await wait(4000)
      await point('button:has-text("Copy") >> nth=-1').catch(() => {})
    },
  },
  {
    caption: 'Next: sales and money',
    say: 'Your shop is set up. Next, follow your sales, check your earnings, and get paid.',
    open: ({ go }) => go('/app/pricing'),
    do: ({ wait }) => wait(1000),
  },
]
