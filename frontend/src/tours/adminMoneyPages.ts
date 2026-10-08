import type { Tour } from './types'

/**
 * Page tours for the admin money screens: Finance, Float corrections, Prices,
 * Users, Settings and Analytics.
 *
 * Analytics keeps every step on its Overview tab on purpose. The tour engine
 * compares `location.pathname` with a step's `route`, so a route carrying
 * `?tab=cash` would never match and would navigate again and again. The other
 * tabs, including Cash, are explained from the tab bar instead.
 */
export const adminMoneyPageTours: Tour[] = [
  {
    id: 'admin-finance',
    role: 'admin',
    kind: 'page',
    title: 'Finance',
    summary: 'See what money is yours, what is owed, and how much each supplier float holds.',
    route: '/admin/finance',
    steps: [
      {
        target: 'finance-reserve',
        title: 'Money held and money owed',
        body: 'Every payment lands in one Paystack balance, but not all of it is yours. **Should be at Paystack** is worked out from your own records, then everything owed to agents, customers and orders still being delivered is taken off. Press **Refresh** to recheck it.',
      },
      {
        target: 'finance-free-to-spend',
        title: 'Actually free to spend',
        body: 'This is the cash at Paystack that is truly yours after everyone else is covered, including bundle costs a float paid for that Paystack has not paid back yet. It is normally the same as your profit earned. If it is red, more is owed than you hold, so do not move money out.',
      },
      {
        target: 'finance-float-panel',
        title: 'Supplier floats',
        body: 'DataHub and GMPL each have their own prepaid float that pays for bundles. Use the **DataHub GH** and **GMPL** tabs to look at one at a time. When a float runs out, customers pay and get nothing, so keep an eye on it.',
      },
      {
        target: 'float-should-vs-live',
        title: 'Should hold vs Live reading',
        body: '**Should hold** is every top-up and withdrawal you logged, minus every order the supplier charged. **Live reading** is what the supplier last told us. If they disagree, a top-up or withdrawal was probably not logged.',
      },
      {
        target: 'float-refresh-buttons',
        title: 'Refresh and Check live',
        body: '**Refresh** re-reads the figures we already have. On the GMPL tab, **Check live** asks GMPL for its balance right now. DataHub does not share its balance, so its reading only updates after an order.',
      },
      {
        target: 'float-log-topup',
        title: 'Log every top-up',
        body: 'Each time you send money to a supplier, press **Log a top-up** and pick where it came from. Choose **Outside the business** if it came from your own pocket. Choose **Paystack, paying back** if it came from the business MoMo linked to Paystack, as that repays the bundles the float already bought.',
      },
      {
        target: 'finance-where-money-goes',
        title: 'Where the money goes',
        body: 'For the last 7 days, 30 days or all time, this splits what customers paid into supplier costs, the Paystack fee, your agents\' share and **Your margin**. It uses what was really charged, not catalogue estimates.',
      },
    ],
  },
  {
    id: 'admin-float-corrections',
    role: 'admin',
    kind: 'page',
    title: 'Float corrections',
    summary: 'Fix a float top-up that was logged as the wrong kind, or one that never happened.',
    route: '/admin/finance/float-corrections',
    steps: [
      {
        title: 'What this page is for',
        body: 'Use this when a top-up was logged wrongly on the Finance page. Only a superadmin can open it, because a correction changes the profit and free to spend figures everywhere else.',
      },
      {
        target: 'float-corrections-search',
        title: 'Find the entry',
        body: 'Nothing is listed until you search. Type the amount, the date, or part of the note you wrote when you logged it.',
      },
      {
        target: 'float-corrections-panel',
        title: 'Paid from Paystack money?',
        body: 'If you logged a top-up as your own money but it was really sent from the business MoMo linked to Paystack, press **Mark as Paystack reimbursement**. It then counts as paying the supplier back, not as new money from you.',
      },
      {
        target: 'float-corrections-panel',
        title: 'Never really happened?',
        body: 'If the entry was a mistake, such as the same top-up logged twice, press **Wasn\'t real, reverse it**. It is cancelled completely and nothing is logged in its place.',
      },
      {
        target: 'float-corrections-panel',
        title: 'Undoing a correction',
        body: 'An entry already marked as a reimbursement shows it underneath. **Reverse just the reimbursement** undoes only that part, and **Reverse capital (and its reimbursement)** cancels the whole thing.',
      },
    ],
  },
  {
    id: 'admin-prices',
    role: 'admin',
    kind: 'page',
    title: 'Prices',
    summary: 'Set what agents and walk-up customers pay, and keep every bundle profitable.',
    route: '/admin/prices',
    steps: [
      {
        target: 'prices-margins',
        title: 'Your average margin',
        body: 'What you keep on an average bundle, once selling to agents and once selling direct in your own shop. It is your cut only, never the agent\'s.',
      },
      {
        target: 'prices-alerts',
        title: 'Things to fix first',
        body: 'Warnings show here for bundles not on sale yet and bundles priced at a loss. When prices change, press **Review & notify agents** to tell them. Changing a price never changes past orders.',
      },
      {
        target: 'prices-category',
        title: 'Pick a category',
        body: 'Switch between data, airtime and the other product types. The table below shows only the category you pick.',
      },
      {
        target: 'prices-routing',
        title: 'Which supplier sells each network',
        body: 'For data, choose whether DataHub or GMPL delivers each network\'s bundles. This changes what customers are offered straight away, so change it on purpose.',
      },
      {
        target: 'prices-review-filter',
        title: 'Outdated prices',
        body: '**Outdated** means a real order cost something different from the price you set against. Pick it to see only the bundles worth repricing.',
      },
      {
        target: 'prices-set-markup',
        title: 'Set markup',
        body: 'Press **Set markup** to price a whole category at once, as a percentage on top of what the supplier charges. The markup is remembered, so your margin holds when supplier costs change.',
      },
      {
        target: 'prices-table',
        title: 'One bundle at a time',
        body: 'Each row shows **You pay**, **Agents pay**, your margin and the **Walk-up price**. Press **Edit** to change one price, or **On sale** / **Off sale** to show or hide it in the shop.',
      },
      {
        target: 'prices-supplier-catalogue',
        title: 'Supplier catalogue',
        body: 'What each supplier sells and charges you. Press **Sync** to fetch their latest list and costs.',
      },
    ],
  },
  {
    id: 'admin-users',
    role: 'admin',
    kind: 'page',
    title: 'Users',
    summary: 'Approve new agents and look after every customer and agent account.',
    route: '/admin/users',
    steps: [
      {
        target: 'users-applications',
        title: 'Agents waiting for you',
        body: 'New agents cannot sell until you decide. Press **Approve** to let them start, and they are emailed straight away. Press **Refuse** and give a reason they can act on, since they are shown it. This box only appears when someone is waiting.',
      },
      {
        target: 'users-stats',
        title: 'Your people at a glance',
        body: 'How many users and agents you have, who is suspended, and how much customer money sits in wallets. Wallet money belongs to your users, it is not income.',
      },
      {
        target: 'users-filters',
        title: 'Find someone',
        body: 'Filter by **Agents**, **Customers** or **Suspended**, or search by name, phone or email.',
      },
      {
        target: 'users-table',
        title: 'The user list',
        body: 'Each row shows orders, sales and wallet balance. For an agent, tap the **Total earned** amount to see every earning credited to them.',
      },
      {
        target: 'users-suspend-note',
        title: 'Suspend or reactivate',
        body: 'Press **Suspend** to stop an account placing orders, topping up or withdrawing. Nothing is deleted, and **Reactivate** gives full access back. Admin accounts are managed under **Platform team** instead.',
      },
    ],
  },
  {
    id: 'admin-settings',
    role: 'admin',
    kind: 'page',
    title: 'Settings',
    summary: 'Platform-wide switches: fees, agent approval, supplier routing and warnings.',
    route: '/admin/settings',
    steps: [
      {
        target: 'settings-integrations',
        title: 'Are you connected?',
        body: 'Shows whether DataHub, GMPL and Paystack are **Live** or **Simulated**. Keys are kept on the server, so they cannot be seen or changed here.',
      },
      {
        target: 'settings-live-fulfilment',
        title: 'Live fulfilment',
        body: 'Tells you whether orders really buy bundles from DataHub. Going live is a server setting, not a button, so it cannot be switched on by accident.',
      },
      {
        target: 'settings-new-agents',
        title: 'Approving new agents',
        body: 'Switch on **Approve new agents automatically** to let anyone who signs up sell at once. Switch it off and every sign-up waits on the **Users** page for you to approve.',
      },
      {
        target: 'settings-paystack-fee',
        title: 'Paystack fee at checkout',
        body: 'The percentage buyers see as a processing fee on top of the price, so Paystack\'s cut does not come out of your margin. Boxes on this page save when you click away from them.',
      },
      {
        target: 'settings-paystack-account',
        title: 'Starter or business account?',
        body: 'Leave this off while Paystack is a Starter account: payouts then wait for you to send them by hand. Only a superadmin can change this switch.',
      },
      {
        target: 'settings-routing',
        title: 'Which supplier sells each network',
        body: 'Choose DataHub or GMPL for each network\'s data bundles. It is the same switch as on the **Prices** page.',
      },
      {
        target: 'settings-float-warnings',
        title: 'Float warnings',
        body: 'Set **Warn me at** and **Urgent at** amounts, and you are emailed when a float drops past them. Leave them blank and nothing warns you before a float runs out.',
      },
      {
        target: 'settings-site-notice',
        title: 'Site-wide notice',
        body: 'Type a short message, such as a network running slow, and everyone sees it. It stays until you clear the box, so remember to remove it.',
      },
    ],
  },
  {
    id: 'admin-analytics',
    role: 'admin',
    kind: 'page',
    title: 'Analytics',
    summary: 'How the business is doing over any dates, compared with the period before.',
    route: '/analytics',
    steps: [
      {
        target: 'analytics-range',
        title: 'Choose your dates',
        body: 'Pick a range like **Last 30 days** or your own dates. Every figure is also compared with the same length of time just before it.',
      },
      {
        target: 'analytics-refresh',
        title: 'Refresh',
        body: 'Figures update by themselves about once an hour during the day. Press **Refresh** to pull in the latest orders right now.',
      },
      {
        target: 'analytics-tabs',
        title: 'Six tabs, six questions',
        body: '**Overview** is the summary. **Money** shows where profit comes from, **Sales** who buys, **Operations** how well orders get through, **Agents** who sells and whether they are paid, and **Cash** whether you can keep selling tomorrow.',
      },
      {
        target: 'analytics-attention',
        title: 'Needs your attention',
        body: 'Anything that needs a decision shows here first, like a float running low, refunds or payouts waiting, or a product selling at a loss. Tap one to go straight to the page that fixes it.',
      },
      {
        target: 'analytics-kpis',
        title: 'Compared with before',
        body: '**Profit earned** is what finished sales made after bundle cost, Paystack fee and agent commission. The small green or red tag under each number shows how it moved against the previous period.',
      },
      {
        target: 'analytics-tabs',
        title: 'Profit vs free to spend',
        body: 'Open the **Cash** tab and find **Why isn\'t free to spend the same as profit?**. They usually match. A gap means profit was moved into a supplier float beyond what it was owed, or something like a top-up or hand-sent refund was recorded wrongly.',
      },
    ],
  },
  {
    id: 'admin-shop-addresses',
    role: 'admin',
    kind: 'page',
    title: 'Shop addresses',
    summary: "Agents' own web addresses on your domain, and what they pay.",
    route: '/admin/domains',
    steps: [
      {
        target: 'domains-pricing',
        title: 'What agents pay',
        body: "Each address costs the agent a monthly or yearly price. Part of it is the superadmin's share, credited to their wallet; the rest is the business's. The admin sets the price, the superadmin sets their share, and the price can never be below the share.",
      },
      {
        target: 'domains-queue',
        title: 'Approving requests (superadmin)',
        body: 'Requests wait here. **Approve** adds the address to hosting, and it goes live by itself within minutes: an agent paying from earnings is charged then, one paying by Mobile Money is asked to pay. **Refuse** needs a reason the agent sees.',
      },
      {
        target: 'domains-legend',
        title: 'Every button explained',
        body: 'Open **What do these buttons do?** for Suspend, Revoke and Mark as live. Suspending switches an address off; only you can bring it back, paying cannot.',
      },
      {
        title: 'When an agent does not pay',
        body: 'A renewal that is not paid gives the agent 5 days, then the address switches off by itself. It comes back the moment they pay, with no new charge for time already paid.',
      },
    ],
  },
  {
    id: 'admin-wallet',
    role: 'admin',
    kind: 'page',
    superadminOnly: true,
    title: 'My wallet',
    summary: 'Your share of shop-address payments, and withdrawing it.',
    route: '/admin/wallet',
    steps: [
      {
        target: 'wallet-balance',
        title: 'Your money, separate from the business',
        body: 'Orders belong to the business. This wallet only holds your share of each shop-address payment agents make, and the business counts it as owed to you.',
      },
      {
        target: 'wallet-withdraw',
        title: 'Withdrawing',
        body: 'Request it like an agent does. Another admin approves and sends it, never you, so the business always signs off on money leaving.',
      },
      {
        target: 'wallet-shares',
        title: 'Every share credited',
        body: 'One line per payment an agent made, with the address it was for.',
      },
    ],
  },
]
