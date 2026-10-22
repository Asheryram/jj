// Admin chapter 8 of 8: settings, announcements and feedback.
import { adminMeta, SUPERADMIN_EMAIL } from './_admin.mjs'

export const meta = adminMeta('Admin 8: Settings and communication', SUPERADMIN_EMAIL)

export const scenes = [
  {
    caption: 'Admin series, part 8: Settings and communication',
    say: 'In this last video you will learn what lives in settings, how to send an announcement, and how to read feedback from your agents.',
    open: ({ go }) => go('/admin/settings'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Your details and new agents',
    say: 'Settings is a long page, so we will go through it in order. Under your details, enter your own mobile money number, the one your earnings are paid to, and click Save. Under new agents, choose whether new agents are approved automatically.',
    open: ({ go }) => go('/admin/settings'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Your details').catch(() => {})
      await wait(5500)
      await point('text=New agents').catch(() => {})
    },
  },
  {
    caption: 'Paystack and fees',
    say: 'The Paystack settings matter for money. Paystack fee is the percentage the processor takes, and it is added to checkout. Is this a live Paystack business account decides how payouts work. On a live business account, transfers go out automatically. On a Starter account, you send the money by hand. The payout transfer fee is the flat amount held from an agent on each withdrawal.',
    open: ({ go }) => go('/admin/settings'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point("text=Paystack's fee").catch(() => {})
      await wait(5500)
      await point('text=Is this a live Paystack business account?').catch(() => {})
      await wait(5500)
      await point("text=Paystack's payout transfer fee").catch(() => {})
    },
  },
  {
    caption: 'Suppliers, float warnings, minimum withdrawal',
    say: 'Which supplier sells each network lets you route a network to data hub or G M P L. Float warnings let you set levels below which the platform warns you that a supplier float is getting low. Smallest withdrawal sets the minimum an agent can ask for. These fields save the moment you click out of them.',
    open: ({ go }) => go('/admin/settings'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Which supplier sells each network').catch(() => {})
      await wait(5500)
      await point('text=Float warnings').catch(() => {})
      await wait(5500)
      await point('text=Smallest withdrawal').catch(() => {})
    },
  },
  {
    caption: 'Notice and WhatsApp channel',
    say: 'Two more settings talk to your users. The notice message is a banner every agent and admin sees at the top of every page, and guests see it once as a popup. Use it for planned maintenance. Clear the field to take it down. The WhatsApp channel setting takes your channel invite link, so agents are offered a way to join. Leave it blank to stop offering one.',
    open: ({ go }) => go('/admin/settings'),
    do: async ({ point, wait, page }) => {
      await wait(2500)
      await page.evaluate(() => window.scrollTo(0, 99999))
      await wait(3000)
      await point('text=WhatsApp channel').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Announcements',
    say: 'Announcements are one way notices to your agents and admins, for scheduled maintenance, or something new. The page lists everything you have sent. Click New announcement to write one.',
    open: ({ go }) => go('/admin/announcements'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('text=Sent').catch(() => {})
      await wait(5000)
      await point('button:has-text("New announcement")').catch(() => {})
    },
  },
  {
    caption: 'Write an announcement',
    say: 'Give it a title and a message, then choose who gets it: everyone, agents only, admins only, or choose people one by one. Click Send announcement, and it is emailed and shown in the app. Think before you send, because you cannot take it back.',
    open: ({ go }) => go('/admin/announcements/new'),
    do: async ({ point, click, wait }) => {
      await wait(3500)
      await click('button:has-text("Agents only")').catch(() => {})
      await wait(3500)
      await click('button:has-text("Choose people")').catch(() => {})
      await wait(5000)
      await point('button:has-text("Send announcement")').catch(() => {})
    },
  },
  {
    caption: 'Received announcements',
    say: 'Other admins can send announcements too, and the received page shows the ones sent to you, with a count on the menu for anything unread.',
    open: ({ go }) => go('/admin/announcements/received'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Sent to you').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Feedback',
    say: 'Feedback is where your agents tell you what is working and what is not. Filter by open, reviewed, resolved, or all, and by kind: suggestions or issues. Add a note on what is being done, then mark it reviewed, or mark it resolved. The menu badge counts what is still open.',
    open: ({ go }) => go('/admin/feedback'),
    do: async ({ click, wait }) => {
      await wait(3500)
      await click('button:has-text("Reviewed")').catch(() => {})
      await wait(3000)
      await click('button:has-text("Resolved")').catch(() => {})
      await wait(3000)
      await click('button:has-text("All") >> nth=0').catch(() => {})
      await wait(2500)
      await click('button:has-text("Issues")').catch(() => {})
      await wait(3500)
    },
  },
  {
    caption: 'That is the whole admin job',
    say: 'That is everything an admin can do. Check the overview each day, keep prices above cost, clear what needs attention, pay people on time, and keep your team and your agents informed. When in doubt, open the help page, or ask the assistant. Thank you for watching the series.',
    open: ({ go }) => go('/admin'),
    do: ({ wait }) => wait(1000),
  },
]
