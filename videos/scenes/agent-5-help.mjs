// Agent chapter 5 of 5: the assistant, feedback, announcements and the help page.
// Types into the feedback box and the assistant but never sends either.
import { agentMeta } from './_agent.mjs'

export const meta = agentMeta('Agent 5: Help, feedback and announcements')

export const scenes = [
  {
    caption: 'Agent series, part 5: Help and feedback',
    say: 'In this last video you will learn where to get help, how to send feedback to the admin, and where announcements appear.',
    open: ({ go }) => go('/app/feedback'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Send feedback',
    say: 'Open Feedback in the menu. This is your own direct line to the admin and the platform team, for a suggestion, or for something that is not working right. It is for the app itself, not for customer support questions.',
    open: ({ go }) => go('/app/feedback'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=A suggestion, or something not working right').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Write a suggestion',
    say: 'Choose Suggestion if you have an idea, and write what would help in the box. For example, it would help if I could filter my sales by network. It needs at least five characters. Then click Send.',
    open: ({ go }) => go('/app/feedback'),
    do: async ({ type, point, wait }) => {
      await wait(2500)
      await type('#feedback-message', 'It would help if I could filter my sales by network').catch(() => {})
      await wait(3500)
      await point('button:has-text("Send")').catch(() => {})
    },
  },
  {
    caption: 'Report a problem',
    say: 'If something is wrong, choose Something is wrong instead, and describe what went wrong. Say what you tapped, and what happened. The more detail you give, the faster it can be fixed.',
    open: ({ go }) => go('/app/feedback'),
    do: async ({ click, type, wait }) => {
      await wait(2500)
      await click('button:has-text("Something is wrong")').catch(() => {})
      await wait(3000)
      await type('#feedback-message', 'The Withdraw button did nothing when I tapped it on my phone').catch(() => {})
      await wait(3500)
    },
  },
  {
    caption: 'What you have sent',
    say: 'Everything you send appears under what you have sent, newest first. A label shows whether it is a suggestion or an issue, and it changes to reviewed, or resolved, once someone has looked at it. The admin and the platform team can see it straight away.',
    open: ({ go }) => go('/app/feedback'),
    do: async ({ point, wait, page }) => {
      await wait(2500)
      await page.evaluate(() => window.scrollTo(0, 99999))
      await wait(2000)
      await point("text=What you've sent").catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'Announcements',
    say: 'Open Announcements to read notices from the admin and the platform team, for example planned maintenance. A number beside it in the menu counts what you have not read yet. They are marked as read as soon as the list is shown.',
    open: ({ go }) => go('/app/announcements'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Notices from admin and the platform team').catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'The assistant',
    say: 'Prefer to just ask? Open the assistant. It gives plain answers about your own earnings, prices, downline, or domain, from your real numbers. Tap a suggestion, like how much have I earned, or how do I get paid, or type your own question. It can only look things up. It never acts for you, and it will always explain how to do something yourself in the app.',
    open: ({ go }) => go('/app/assistant'),
    do: async ({ point, type, wait }) => {
      await wait(3000)
      await point('button:has-text("How much have I earned?")').catch(() => {})
      await wait(5000)
      await point('button:has-text("What are my current prices?")').catch(() => {})
      await wait(5000)
      await type('input[placeholder*="Ask"], textarea[placeholder*="Ask"]', 'Is my shop domain live yet?').catch(() => {})
    },
  },
  {
    caption: 'The help page',
    say: 'And the help page, called what can I do here, explains every task step by step, from getting started, to your shop, to sales and money. Search for a word like withdraw, and it shows you just the steps you need.',
    open: ({ go }) => go('/info'),
    do: async ({ type, wait }) => {
      await wait(3000)
      await type('input[placeholder*="Search"]', 'withdraw').catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'What your customers see',
    say: 'One more thing worth seeing is your customer\'s side. Browse shop, in your menu, opens the public shop, where a customer picks a network and a bundle, enters the number, and pays by mobile money, with no account needed. Through your link, they see your prices, and you earn on every sale.',
    open: ({ go }) => go('/shop'),
    do: async ({ click, point, wait }) => {
      await wait(3500)
      await click('button:has-text("MTN")').catch(() => {})
      await wait(4500)
      await point('text=Buy a bundle').catch(() => {})
    },
  },
  {
    caption: 'You are ready to sell',
    say: 'That is everything an agent can do. Share your link, set fair prices, follow your sales, and withdraw your earnings. If you get stuck, ask the assistant, open the help page, or send us feedback. Happy selling.',
    open: ({ go }) => go('/app'),
    do: ({ wait }) => wait(1000),
  },
]
