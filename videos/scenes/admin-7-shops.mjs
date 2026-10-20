// Admin chapter 7 of 8: platform branding, agent branding requests, custom domains.
// Signs in as the platform owner: the custom domains page is superadmin only.
import { adminMeta, SUPERADMIN_EMAIL } from './_admin.mjs'

export const meta = adminMeta('Admin 7: Branding and domains', SUPERADMIN_EMAIL)

export const scenes = [
  {
    caption: 'Admin series, part 7: Shops and branding',
    say: 'In this video you will learn how to set the look of your own platform, review the names and logos agents ask for, and handle custom domain requests.',
    open: ({ go }) => go('/admin/branding'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Your platform branding',
    say: 'Branding, the your platform card, controls how your own storefront looks. Pick a colour from the gallery, or choose your own and type a hex code. You can set a different colour for dark mode, and choose how product tiles look: classic, bold, minimal, or compact, plus the style of the badges. Click Save platform branding and it applies immediately. Reload the page to see it everywhere.',
    open: ({ go }) => go('/admin/branding'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await point('text=Your platform').catch(() => {})
      await wait(3500)
      await point('button:has-text("Emerald")').catch(() => {})
      await wait(3500)
      await point('button:has-text("Bold")').catch(() => {})
      await wait(3500)
      await point('button:has-text("Save platform branding")').catch(() => {})
    },
  },
  {
    caption: 'Agent branding requests',
    say: 'Agents can ask for their own shop name and logo, and each request waits for you on the agent requests page. Three tabs sort them: waiting, approved, and refused. You can see the proposed name and the logo, and click the logo to enlarge it.',
    open: ({ go }) => go('/admin/branding-requests'),
    do: async ({ point, click, wait }) => {
      await wait(3500)
      await point('text=Agent requests').catch(() => {})
      await wait(5000)
      await click('button:has-text("Approved")').catch(() => {})
      await wait(3000)
      await click('button:has-text("Refused")').catch(() => {})
      await wait(3000)
      await click('button:has-text("Waiting")').catch(() => {})
    },
  },
  {
    caption: 'Approve or refuse a request',
    say: 'Approve it if it is fine. Refuse it, with a reason, if the name or logo looks like a bank, a mobile network, or another company. This matters, because a shop takes payment details, and customers have to be able to tell who they are paying. The payment page and receipts always show the platform name, whatever the shop is called. Colour changes need no review. Agents apply those instantly.',
    open: ({ go }) => go('/admin/branding-requests'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('button:has-text("Approve") >> nth=0').catch(() => {})
      await wait(7000)
      await point('button:has-text("Refuse") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Custom domains',
    say: 'Agents can also ask for a web address of their own. The custom domains page, visible only to the platform owner, lists the requests. Waiting shows the ones that need a decision, and all shows the full history. The domain pricing card at the top is what agents pay for a subdomain or a custom domain, monthly or yearly. You set the price, and it must clear your own cost.',
    open: ({ go }) => go('/admin/domains'),
    do: async ({ point, click, wait }) => {
      await wait(3000)
      await point('text=Domain pricing').catch(() => {})
      await wait(6000)
      await point('text=Requests').catch(() => {})
      await wait(4000)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(3000)
      await click('button:has-text("Waiting")').catch(() => {})
    },
  },
  {
    caption: 'Approve a domain',
    say: 'Before you click Approve, satisfy yourself that the agent really owns the domain. This is a trust decision. To turn one down, click Refuse and give a reason. An approved domain is checked automatically every six hours, and goes live by itself once it points at the platform. Mark as live only skips that wait. You can later suspend a live domain, or revoke approval completely, with a reason.',
    open: ({ go }) => go('/admin/domains'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('button:has-text("Approve") >> nth=0').catch(() => {})
      await wait(8000)
      await point('button:has-text("Refuse") >> nth=0').catch(() => {})
    },
  },
  {
    caption: 'Next: settings and communication',
    say: 'One video left. Settings, announcements, and feedback.',
    open: ({ go }) => go('/admin/branding'),
    do: ({ wait }) => wait(1000),
  },
]
