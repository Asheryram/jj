import type { Tour } from './types'

/** Agent page tours and walkthroughs. */
export const agentTours: Tour[] = [
  // Page tours
  {
    id: 'agent-dashboard',
    role: 'agent',
    kind: 'page',
    title: 'Dashboard',
    summary: 'Your money, your sell link and your latest sales in one place.',
    route: '/app',
    steps: [
      {
        target: 'learn-card',
        title: 'Learn as you go',
        body: 'This list has a short tour for every page, plus walkthroughs for common jobs. Ticks show what you have done, and you can press **Replay** on any tour, any time you need a reminder.',
      },
      {
        target: 'agent-dash-balance',
        title: 'Your money',
        body: 'This is what you have earned and can take out right now. Press **Withdraw** to send it to your Mobile Money, or **Earnings** to see every credit.',
      },
      {
        target: 'agent-dash-stats',
        title: 'Today at a glance',
        body: 'What you earned today and all time, how many orders completed, and how many agents joined under you. What you earn on a sale is your price minus your cost.',
      },
      {
        target: 'agent-dash-sell-link',
        title: 'Your sell link',
        body: 'This link is your shop. Copy it and send it to customers: they buy at your prices and your margin is added for you. **Share it** opens more ways to share.',
      },
      {
        target: 'agent-dash-activity',
        title: 'Recent sales',
        body: 'Your latest sales show here with what you made on each and where the order is. The side panel shows your earnings for the last 7 days, and **See all** or **Full report** take you deeper.',
      },
      {
        target: 'agent-dash-quick-actions',
        title: 'Quick actions',
        body: 'Shortcuts to the jobs you will do most: share your shop, set your prices, invite an agent and withdraw. **What can I do here?** opens a searchable guide.',
      },
    ],
  },
  {
    id: 'agent-sell',
    role: 'agent',
    kind: 'page',
    title: 'Sell & refer',
    summary: 'Your sell link for customers, and your referral link for new agents.',
    route: '/app/referrals',
    steps: [
      {
        target: 'agent-sell-link',
        title: 'Your sell link',
        body: 'This is the link that makes you money. Customers who open it buy at your prices and pay online, and your margin lands in your earnings when the order completes. You never hold stock.',
      },
      {
        target: 'agent-sell-whatsapp',
        title: 'Share it on WhatsApp',
        body: 'Press **Share my shop on WhatsApp** to send the link with a ready-made message. Post it on your status and in groups so more people see it.',
      },
      {
        target: 'agent-referral-link',
        title: 'Your referral link',
        body: 'This one is different: it is for people who want to sell, not buy. Anyone who signs up with it becomes an agent under you.',
      },
      {
        target: 'agent-invite-note',
        title: 'What inviting gives you',
        body: 'You are not paid anything from what the agents you invite sell. Every agent earns only from their own sales, so your sell link is where your money comes from.',
      },
      {
        target: 'agent-chain-stats',
        title: 'Your chain',
        body: 'How many agents are under you, how much they have sold, and how many have gone quiet with no sale in 30 days. These numbers are for your information only.',
      },
      {
        target: 'agent-chain-list',
        title: 'Agents in your chain',
        body: 'Everyone who joined through you, with their orders, last sale and status. Once there are more than 5, a search box appears so you can find someone by name or number.',
      },
    ],
  },
  {
    id: 'agent-prices',
    role: 'agent',
    kind: 'page',
    title: 'My prices',
    summary: 'Set what you charge for each bundle and see what you keep.',
    route: '/app/pricing',
    steps: [
      {
        target: 'agent-prices-stats',
        title: 'Your prices at a glance',
        body: 'How many products you have set your own price for, and your average and best margin. Products you have not priced yourself use your default markup.',
      },
      {
        target: 'agent-prices-cost-note',
        title: 'You can never sell at a loss',
        body: 'Your cost is the least you can charge for a product. The app will not let you go below it, and there is no maximum.',
      },
      {
        target: 'agent-prices-categories',
        title: 'Pick a product type',
        body: 'Switch between **Data**, **Airtime** and the other product types here. Where there is more than one network, the **Network** buttons below show just MTN, Telecel or AirtelTigo.',
      },
      {
        target: 'agent-prices-table',
        title: 'Your price list',
        body: 'Each row shows **You pay**, **Your price** and **Your margin**, which is what you keep per sale. A **default** tag means the price comes from your markup. **Sold, last 30 days** shows what is actually selling.',
      },
      {
        target: 'agent-prices-table',
        title: 'Change a price',
        body: 'Press **Edit** on a row, type your price and press **Save price**. The form shows your profit per order as you type, and **Reset** puts a product back on your default markup.',
      },
      {
        target: 'agent-prices-markup',
        title: 'Price everything at once',
        body: '**Apply markup to all** sets every price to your cost plus a percentage you pick, from 5% to 30%. You can still edit single products afterwards.',
      },
    ],
  },
  {
    id: 'agent-shop-look',
    role: 'agent',
    kind: 'page',
    title: 'Shop look',
    summary: 'Give your shop its own name, logo, colour and web address.',
    route: '/app/shop-look',
    steps: [
      {
        target: 'agent-look-name',
        title: 'Name and logo',
        body: 'Give your shop its own name (up to 40 characters) and a logo (PNG, JPEG or WebP, under 100KB). Customers see them at the top of your shop.',
      },
      {
        target: 'agent-look-send',
        title: 'Send for approval',
        body: 'Name and logo changes are checked first, and your shop keeps its current look until they are approved. Names that look like a bank, a network or another company are refused. Press **Send for approval** when you are happy.',
      },
      {
        target: 'agent-look-colour',
        title: 'Shop colour',
        body: 'Pick the colour for your buttons, header and highlights. This one needs no approval and applies right away.',
      },
      {
        target: 'agent-look-tiles',
        title: 'Product tiles',
        body: 'Choose how each bundle looks in your shop and preview it here. Press **Apply this style** to make it live, no review needed.',
      },
      {
        target: 'agent-look-domain',
        title: 'Your own web address',
        body: 'Want a nicer address than your sell link? Ask for one here: it is checked before it carries your shop, and any monthly or yearly price is taken from your earnings once it is live.',
      },
    ],
  },
  {
    id: 'agent-earnings',
    role: 'agent',
    kind: 'page',
    title: 'Earnings',
    summary: 'What you have earned, and every credit and withdrawal behind it.',
    route: '/app/earnings',
    steps: [
      {
        target: 'agent-earnings-balance',
        title: 'What you have',
        body: '**Available to withdraw** is your money right now. Next to it are your total from your own sales and what has already been paid out to you.',
      },
      {
        target: 'agent-earnings-how',
        title: 'How you earn',
        body: 'When someone buys through your sell link, you are credited your price minus your cost as soon as the order completes. You never buy stock or hold a float.',
      },
      {
        target: 'agent-earnings-chart',
        title: 'The last 7 days',
        body: 'Your earnings day by day for the past week, so you can spot your busy days.',
      },
      {
        target: 'agent-earnings-ledger',
        title: 'Every entry',
        body: 'Every credit, reversal and withdrawal, with your balance after each. If an order fails, its earning is taken back as a **Reversed** line. Entries are never edited or deleted.',
      },
      {
        target: 'agent-earnings-ledger',
        title: 'Filter the list',
        body: 'On a larger screen, use **All**, **My sales** or **Withdrawals** at the top of the list to show just one kind of entry.',
      },
      {
        target: 'agent-earnings-withdraw',
        title: 'Take it out',
        body: 'Press **Withdraw** to send your earnings to your Mobile Money.',
      },
    ],
  },
  {
    id: 'agent-withdraw',
    role: 'agent',
    kind: 'page',
    title: 'Withdraw',
    summary: 'Send your earnings to Mobile Money and follow each payout.',
    route: '/app/withdrawals',
    steps: [
      {
        target: 'agent-withdraw-stats',
        title: 'Your payout numbers',
        body: '**Available to withdraw** is what you can ask for. **Awaiting approval** is money you have asked for that has not been decided yet, and **Paid out to date** is what has been sent to you.',
      },
      {
        target: 'agent-withdraw-how',
        title: 'How payouts work',
        body: 'Each request is reviewed and sent by hand, usually within 24 hours, and you get an SMS once it is sent. A GHS 1 sending fee is held on top of the amount you ask for.',
      },
      {
        target: 'agent-withdraw-request',
        title: 'Request a withdrawal',
        body: 'Press **Request withdrawal**, enter the amount, then pick your Mobile Money network and the number to pay. The button stays greyed out until your balance is more than the fee.',
      },
      {
        target: 'agent-withdraw-requests',
        title: 'Follow your requests',
        body: '**Awaiting review** means it has not been decided yet, and you can still **Cancel** it. **On its way** means it was approved and is being sent. **Paid** means the money was sent.',
      },
      {
        target: 'agent-withdraw-requests',
        title: 'If it does not go through',
        body: '**Rejected** (also what a cancelled request shows) and **Could not be sent, returned to you** both put the amount and the fee back in your balance. Any reason is shown under the status.',
      },
    ],
  },
  {
    id: 'agent-sales',
    role: 'agent',
    kind: 'page',
    title: 'Sales',
    summary: 'Every order you have sold, its status and what you earned.',
    route: '/app/orders',
    steps: [
      {
        target: 'agent-sales-summary',
        title: 'Your sales in one line',
        body: 'How many orders you have, what you earned on the completed ones, and how many failed and were reversed. You only ever see your own sales.',
      },
      {
        target: 'agent-sales-filters',
        title: 'Filter and search',
        body: 'Use **All**, **Completed**, **In progress** and **Failed** to narrow the list, or search by phone number, reference or product.',
      },
      {
        target: 'agent-sales-list',
        title: 'Each sale',
        body: 'Every order shows the product, the number it went to, its status, what the customer paid and **You earned**. You earn only once an order is **Completed**, until then it shows a dash.',
      },
      {
        target: 'agent-sales-list',
        title: 'Open an order',
        body: 'Tap any row for the full details, including how the money was split. From there, **Buy again** or **Order again** starts the same bundle for the same number.',
      },
      {
        title: 'When an order fails',
        body: 'If the network cannot deliver, the order is marked failed and any earning on it is reversed. The platform handles the customer\'s refund, nothing comes out of your own pocket.',
      },
    ],
  },
  {
    id: 'agent-reports',
    role: 'agent',
    kind: 'page',
    title: 'Reports',
    summary: 'How much you sold and kept over any range of dates.',
    route: '/app/reports',
    steps: [
      {
        target: 'agent-reports-range',
        title: 'Pick a time range',
        body: 'Choose today, the last 7, 30 or 90 days, a month, a year, or your own dates. Everything below updates to match.',
      },
      {
        target: 'agent-reports-stats',
        title: 'The headline numbers',
        body: '**Volume sold** is what your customers paid, and **You earned** is what you kept. **Average order** and **Failed orders** help you spot what to work on.',
      },
      {
        target: 'agent-reports-categories',
        title: 'What sells',
        body: 'See which kinds of product bring in the most money, so you know what to promote and where your prices matter most.',
      },
      {
        target: 'agent-reports-detail',
        title: 'More detail',
        body: 'Open **Daily sales and top customers** for a day by day chart and your best customers in this range. Your regulars are worth a thank you message.',
      },
      {
        target: 'agent-reports-export',
        title: 'Export to a spreadsheet',
        body: '**Export CSV** downloads one line per sale in this range, with what the customer paid and what you earned.',
      },
    ],
  },

  // Walkthroughs
  {
    id: 'agent-task-first-sale',
    role: 'agent',
    kind: 'task',
    title: 'Make my first sale',
    summary: 'Set your prices, share your sell link, and see the money arrive.',
    route: '/app/pricing',
    steps: [
      {
        route: '/app/pricing',
        target: 'agent-prices-table',
        title: 'Step 1: check your prices',
        body: 'Every product already has a price from your default markup. Press **Edit** on any row to change it, and keep **Your margin** above zero so each sale earns you something.',
      },
      {
        route: '/app/pricing',
        target: 'agent-prices-markup',
        title: 'Or set them all at once',
        body: 'In a hurry? **Apply markup to all** prices every product at your cost plus a percentage you pick. You can fine tune single products later.',
      },
      {
        route: '/app/referrals',
        target: 'agent-sell-link',
        title: 'Step 2: copy your sell link',
        body: 'Press **Copy** next to your sell link. This link is your shop, and customers who open it see your prices.',
      },
      {
        route: '/app/referrals',
        target: 'agent-sell-whatsapp',
        title: 'Step 3: share it',
        body: 'Press **Share my shop on WhatsApp**, or paste the link on your status and in groups. Customers pay online themselves, so you never handle their money.',
      },
      {
        route: '/app/orders',
        target: 'agent-sales-list',
        title: 'Step 4: watch the sale arrive',
        body: 'When a customer buys, the order shows up here. Once it says **Completed**, your margin appears under **You earned**.',
      },
      {
        route: '/app/earnings',
        target: 'agent-earnings-ledger',
        title: 'Step 5: see the money',
        body: 'Your margin is added to your balance the moment the order completes, as a **Your sale** line here. From here you can withdraw it whenever you like.',
      },
    ],
  },
  {
    id: 'agent-task-withdraw',
    role: 'agent',
    kind: 'task',
    title: 'Get my money out',
    summary: 'Withdraw your earnings to Mobile Money and know what to expect.',
    route: '/app/earnings',
    steps: [
      {
        route: '/app/earnings',
        target: 'agent-earnings-balance',
        title: 'Check what you have',
        body: '**Available to withdraw** is money from your completed sales that you can take out now.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-request',
        title: 'Start a request',
        body: 'Press **Request withdrawal**. In the form, **Withdraw the max** fills in the most you can take, which is your balance minus the GHS 1 sending fee.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-how',
        title: 'The minimum and the fee',
        body: 'There is a smallest amount you can withdraw (GHS 10 unless the admin changes it), and the form tells you if you go below it. The GHS 1 fee is held with your request and only kept once it is approved.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-request',
        title: 'Choose where it goes',
        body: 'Pick your Mobile Money network and type the 10 digit number to pay, like 0209876543. It does not have to be your sign in number, so check it carefully before you press **Send request**.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-requests',
        title: 'Your money is set aside',
        body: 'As soon as you send the request, the amount and the fee leave your available balance so they cannot be spent twice. Your earnings list shows them as two **Withdrawal** lines.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-requests',
        title: 'What each status means',
        body: '**Awaiting review**: not decided yet, you can still **Cancel** it. **On its way**: approved and being sent. **Paid**: the money has been sent to your number.',
      },
      {
        route: '/app/withdrawals',
        target: 'agent-withdraw-requests',
        title: 'If it is rejected or fails',
        body: '**Rejected** and **Could not be sent, returned to you** both put the amount and the fee back in your balance straight away. Read the note under the status, fix the problem, and ask again.',
      },
      {
        route: '/app/withdrawals',
        title: 'If it is taking a while',
        body: 'Payouts are sent by hand, usually within 24 hours, so a short wait is normal. If nothing has moved after a day, send a message from **Feedback**. You can have up to 3 requests waiting at once.',
      },
    ],
  },
]
