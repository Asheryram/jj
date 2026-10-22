// Agent chapter 2 of 5: the sell link and inviting other agents.
import { agentMeta } from './_agent.mjs'

export const meta = agentMeta('Agent 2: Your sell link and referrals')

export const scenes = [
  {
    caption: 'Agent series, part 2: Your sell link',
    say: 'In this video you will learn how to get your sell link, share it with customers, and invite other agents to join under you.',
    open: ({ go }) => go('/app/referrals'),
    do: ({ wait }) => wait(1000),
  },
  {
    caption: 'Your sell link',
    say: 'Open Sell and refer. At the top is your sell link. It is the one link that earns you money. Customers who buy through it pay your prices, and your margin lands in your earnings the moment the order completes. You never touch the money, and you never hold stock. The platform takes the payment and credits you the difference.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ point, wait }) => {
      await wait(3500)
      await point('text=Send this to customers').catch(() => {})
      await wait(6000)
      await point('text=SELL LINK').catch(() => {})
    },
  },
  {
    caption: 'Copy it, or share on WhatsApp',
    say: 'Click Copy to copy the link, and paste it anywhere you like. Or click Share my shop on WhatsApp, which opens WhatsApp with a message already written, so you can send it straight away. You can also copy the same link from your dashboard.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ click, point, wait }) => {
      await wait(2500)
      await click('button:has-text("Copy") >> nth=0').catch(() => {})
      await wait(4000)
      await point('text=Share my shop on WhatsApp').catch(() => {})
      await wait(5000)
    },
  },
  {
    caption: 'Your own web address',
    say: 'If your own custom domain has been approved and is live, this page also shows it under your own domain. Share whichever one you prefer, because both lead to the same shop. We will see how to ask for a domain in the next video.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Your own domain').catch(() => {})
      await wait(6000)
    },
  },
  {
    caption: 'Invite another agent',
    say: 'Scroll down to your referral link. This one is for people who want to sell, not buy. Copy the link or the code, or click Invite an agent on WhatsApp to send it with a message already written. When someone joins using your code, they appear in the table below, under agents in your chain.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ point, wait }) => {
      await wait(2500)
      await point('text=Your referral link').catch(() => {})
      await wait(5000)
      await point('button:has-text("Invite an agent on WhatsApp")').catch(() => {})
      await wait(5000)
      await point('text=Agents in your chain').catch(() => {})
    },
  },
  {
    caption: 'What inviting does and does not do',
    say: 'One thing to be clear about. You are not paid anything from what the agents you invite sell, now or ever. Every agent earns from their own sales only, at the same price, no matter who is above them. Inviting someone grows your chain, so you can see it, but it has no effect on anybody\'s price or earnings.',
    open: ({ go }) => go('/app/referrals'),
    do: async ({ point, wait }) => {
      await wait(3000)
      await point('text=Agents in your chain').catch(() => {})
      await wait(7000)
    },
  },
  {
    caption: 'Next: prices and your shop look',
    say: 'Your link is ready. Next, set your prices, and make the shop look like yours.',
    open: ({ go }) => go('/app/referrals'),
    do: ({ wait }) => wait(1000),
  },
]
