// Admin chapter 6 of 8: users, approvals, suspensions and the platform team.
// Signs in as the platform owner so the Platform team page is visible.
import { adminMeta, SUPERADMIN_EMAIL } from './_admin.mjs'

export const meta = adminMeta('Admin 6: People and team', SUPERADMIN_EMAIL)

export const scenes = [
  {
    caption: 'Admin series, part 6: People',
    say: 'In this video you will learn how to approve new agents, find and suspend accounts, and add people to your platform team.',
    open: ({ go }) => go('/admin/users'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Approve an agent',
    say: 'When someone applies to sell, they appear at the top of the users page, and the users menu item shows a count. The card shows who they are, their referral code, and when they signed up. Until you approve them, they cannot sell, and their shop link falls back to your standard prices. Click Approve and they are emailed immediately, and their shop link starts working.',
    open: ({ go }) => go('/admin/users'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('text=agent waiting to be approved').catch(() => {})
      await wait(5500)
      await point('button:has-text("Approve") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Refuse an applicant',
    say: 'Or click Refuse, and give a reason. The applicant sees that reason the next time they sign in. If you would rather approve everyone automatically, you can switch that on in settings, under new agents. On means a new sign up can sell straight away. Off sends them to this queue for you to decide.',
    open: ({ go }) => go('/admin/users'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('button:has-text("Refuse") >> nth=0').catch(() => {})
      await wait(8000)
    },
  },
  {
    caption: 'Find anyone',
    say: 'Below the queue is every account on the platform. The tiles show total users, agents, suspended accounts, and the wallet float you are holding for customers, which is their money and not your income. Filter by all, agents, customers, or suspended, or search by name, phone number, or email.',
    open: ({ go }) => go('/admin/users'),
    do: async ({ click, type, wait, page }) => {
      await wait(2500)
      await click('button:has-text("Agents") >> nth=0').catch(() => {})
      await wait(3000)
      await click('button:has-text("Customers")').catch(() => {})
      await wait(3000)
      await click('button:has-text("Suspended") >> nth=-1').catch(() => {})
      await wait(3000)
      await click('button:has-text("All") >> nth=-1').catch(() => {})
      await type('input[placeholder*="Name, phone"]', 'kwame').catch(() => {})
      await wait(3000)
      await page.fill('input[placeholder*="Name, phone"]', '').catch(() => {})
    },
  },
  {
    caption: 'Suspend and reactivate',
    say: 'To suspend an account, find it and click Suspend, then confirm. Suspending blocks new orders and withdrawals. Nothing is deleted, and their wallet balance and order history stay exactly as they were. Reactivate brings everything back. Admin accounts show a link to manage them in platform team instead, and you cannot suspend yourself.',
    open: ({ go }) => go('/admin/users'),
    do: async ({ point, click, wait, page }) => {
      await wait(3000)
      await click('button:has-text("Suspend") >> nth=0').catch(() => {})
      await wait(7000)
      await page.keyboard.press('Escape')
      await wait(500)
      await point('button:has-text("Reactivate")').catch(() => {})
    },
  },
  {
    caption: 'The platform team',
    say: 'Platform team is visible only to the platform owner. It lists every account with platform access, and below that, a log of recent admin actions, so you can always see who did what.',
    open: ({ go }) => go('/admin/team'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Accounts with platform access').catch(() => {})
      await wait(5500)
      await point('text=Recent admin actions').catch(() => {})
    },
  },
  {
    caption: 'Add an admin',
    say: 'To add someone, click Add an admin. Enter their name, the email they will sign in with, and their phone number, then Create and get link. Pass on the one time link. It is usually emailed automatically, and if not, copy it and send it yourself by whatever way you normally reach them. It works once, and expires after forty eight hours.',
    open: ({ go }) => go('/admin/team'),
    do: async ({ click, wait, page }) => {
      await wait(2500)
      await click('button:has-text("Add an admin")').catch(() => {})
      await wait(10000)
      await page.keyboard.press('Escape')
    },
  },
  {
    caption: 'Reset links and suspending admins',
    say: 'If an admin loses access, click Reset link to make them a fresh one time link. To remove someone, click Suspend, and Restore brings them back later. Every one of these actions is recorded in the log underneath.',
    open: ({ go }) => go('/admin/team'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('button:has-text("Reset link") >> nth=0').catch(() => {})
      await wait(5000)
      await point('button:has-text("Suspend") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Next: shops and branding',
    say: 'Next, how agents look to customers: platform branding, agent branding requests, and custom domains.',
    open: ({ go }) => go('/admin/users'),
    do: ({ wait }) => wait(1000),
  },
]
