// Admin chapter 2 of 8: prices and the catalogue.
import { adminMeta } from './_admin.mjs'

export const meta = adminMeta('Admin 2: Prices and catalogue')

export const scenes = [
  {
    caption: 'Admin series, part 2: Prices and catalogue',
    say: 'In this video you will learn how to price your catalogue, keep those prices correct, and spot products that could lose you money.',
    open: ({ go }) => go('/admin/prices'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Pick a category',
    say: 'Open Cost prices. The page is titled Prices. Along the top are the categories: data, airtime, voice, SMS, A F A, and checkers. Pick one and every product in it is listed, grouped by network, with what you pay the supplier, what agents pay you, and the walk up price a customer pays at your own shop.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ click, point, wait }) => {
      await wait(2500)
      await click('button:has-text("Airtime")').catch(() => {})
      await wait(4000)
      await click('button:has-text("Data")').catch(() => {})
      await wait(3000)
      await point('text=Data Bundles').catch(() => {})
    },
  },
  {
    caption: 'Which supplier sells each network',
    say: 'You can sell through more than one supplier. The card at the top says which supplier sells each network, and you can filter the table to all providers, just Data Hub, or just G M P L. Switching a network to a different supplier takes effect on the storefront immediately.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ point, click, wait }) => {
      await wait(2000)
      await point('text=Which supplier sells each network').catch(() => {})
      await wait(5000)
      await click('button:has-text("GMPL") >> nth=0').catch(() => {})
      await wait(3500)
      await click('button:has-text("All providers")').catch(() => {})
    },
  },
  {
    caption: 'Price a whole category',
    say: 'To price a category in one go, click Set markup. Enter what agents pay over cost, and what walk up customers pay over cost. It starts at fifteen and twenty five percent. You see a live example before you commit, and then Apply prices every product in the category. The markup is remembered, so when the supplier changes a cost, your prices move with it and your margin holds.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ click, wait, page }) => {
      await wait(2500)
      await click('button:has-text("Set markup")').catch(() => {})
      await wait(9000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Price one product',
    say: 'To price one product, click Edit on its row, and type exact prices for your agents and for walk up customers. Both must be above what you pay the supplier, or the page will not let you save. Save prices, and it is live.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Edit") >> nth=0').catch(() => {})
      await wait(8000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'On sale and off sale',
    say: 'Each row has an on sale button. Products you priced with Set markup go on sale straight away. If you priced one by hand, or want to stop selling something for a while, flip it here. A product cannot go on sale until its price is above cost. The filters above the table, outdated, up to date, and not bought yet, help you find products that need a look.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ point, click, wait }) => {
      await wait(2500)
      await point('button:has-text("On sale") >> nth=0').catch(() => {})
      await wait(5000)
      await click('button:has-text("Outdated")').catch(() => {})
      await wait(4000)
      await click('button:has-text("All") >> nth=-1').catch(() => {})
    },
  },
  {
    caption: 'Sync the supplier catalogue',
    say: 'Scroll down to the supplier catalogue and click Sync. It pulls what your suppliers really sell and really charge. A message tells you how many products were created, repriced, or withdrawn from stock. This is also how costs change: you can never type a cost by hand. If new products arrive without a price, publish them with a markup so they can sell.',
    open: ({ go }) => go('/admin/prices'),
    do: async ({ point, wait, page }) => {
      await wait(2000)
      await page.evaluate(() => document.querySelector('main')?.scrollTo?.(0, 99999) ?? window.scrollTo(0, 99999))
      await wait(3500)
      await point('text=Supplier catalogue').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Catalogue accuracy',
    say: 'The catalogue accuracy page finds prices that are wrong. It lists every product you have sold, biggest loss first, going only by the latest sale. If a row shows a loss, sync the supplier catalogue to pull the real cost, then reprice that product, so future sales stop losing money.',
    open: ({ go }) => go('/admin/catalogue-accuracy'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Products sold at least once').catch(() => {})
      await wait(8000)
    },
  },
  {
    caption: 'Float risk',
    say: 'Float risk looks at your supplier float, the prepaid balance every order spends from. Products priced above what the float can cover are listed worst first, and the Turn off button stops selling one until the float catches up. Below it, the currently inactive list shows anything off sale that may be safe to turn back on. It is a suggestion, never an automatic switch.',
    open: ({ go }) => go('/admin/float-risk'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Priced above the float').catch(() => {})
      await wait(5000)
      await point('button:has-text("Turn off") >> nth=0').catch(() => {})
      await wait(5000)
      await point('text=Currently inactive').catch(() => {})
    },
  },
  {
    caption: 'Next: orders',
    say: 'Your catalogue is priced and protected. Next, we follow the orders that come in, and fix the ones that get stuck.',
    open: ({ go }) => go('/admin/prices'),
    do: ({ wait }) => wait(1000),
  },
]
