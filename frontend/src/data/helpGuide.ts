/**
 * The in-app "what can I do" guide, one data set per role, rendered by
 * `pages/Info.tsx`. Kept as plain data (not JSX) so search can run over it as
 * plain text and so the same shape works for every role without duplicating
 * the page around it.
 *
 * Step and note text supports a tiny markup subset, parsed by `renderInline`
 * in `pages/Info.tsx`: **bold** and `code` (used for exact button/page/route
 * names, this is a real navigation instruction, not decoration).
 */

export interface GuideNote {
  tone: 'info' | 'warning' | 'danger' | 'success'
  title: string
  body: string
}

export interface GuideTask {
  id: string
  title: string
  why?: string
  steps: string[]
  notes?: GuideNote[]
}

export interface GuideGroup {
  label: string
  tasks: GuideTask[]
}

export const adminGuide: GuideGroup[] = [
  {
    label: 'Getting started',
    tasks: [
      {
        id: 'set-up',
        title: 'Get set up before selling anything',
        why: 'Three things have to be in place before a customer can actually buy something: money in your float, prices on your bundles, and somewhere for your own earnings to go.',
        steps: [
          'Open `Overview`, it shows a **"Get set up"** checklist until all three steps below are done.',
          'Log your first float top-up. Open `Finance`, pick the **DataHub GH** or **GMPL** tab on the **Provider float** card, and click **"Log a top-up."** Every order spends from this prepaid DataHub balance, without it, a paid order can still fail to deliver.',
          'Price your catalogue. Go to `Cost prices` and set what agents and walk-up customers pay, see "Price my catalogue" below. Nothing sells until this is done.',
          'Set your own payout number. Go to `Settings` → **Your details** and enter the Mobile Money number your own earnings and any manual payouts should go to.',
        ],
      },
      {
        id: 'price-catalogue',
        title: 'Price my catalogue',
        why: 'A bundle arrives from the provider priced at cost and stays out of the shop until you say what it sells for.',
        steps: [
          'Go to `Cost prices`, the page itself is titled "Prices."',
          'Pick a category along the top (Data, Airtime, and so on).',
          'For the whole category at once, click **"Set markup,"** enter what agents pay over cost and what walk-up customers pay over cost (it starts at 15% / 25%), and click **"Apply to {N}."** The markup is remembered, so a future cost change moves prices with it.',
          'For one product, click **"Edit"** on its row, type exact GHS prices for "Your price to agents" and "Your own walk-up price," and click **"Save prices."** Both must clear what you pay the provider.',
          'Click the **"Off sale"** button on any row to flip it to **"On sale"** once its price is set. Products priced with **"Set markup"** go on sale straight away, so this is only needed for ones you priced one by one or switched off.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'Before you change a live price',
            body: 'Every order already stores the split it was sold at, past reports, agent earnings and your own margin never move. Only future orders use the new price.',
          },
        ],
      },
      {
        id: 'sync-suppliers',
        title: 'Sync what my suppliers actually sell',
        why: "Your suppliers' own stock, cost and availability, pulled in on demand, never invented.",
        steps: [
          'Go to `Cost prices` and scroll down to **"Supplier catalogue."**',
          'Click **"Sync."** A toast reports how many products were newly created, repriced, or withdrawn from stock.',
          'Publish anything new. If products arrived with no price yet, click **"Set a markup and publish"** in the callout above the table, or price them one by one on the main table above.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Read-only by design',
            body: 'The supplier catalogue table can’t be edited, it’s exactly what the supplier reported. "Manual only" means DataHub can’t deliver it automatically; those are refused at checkout rather than sold undeliverable.',
          },
        ],
      },
    ],
  },
  {
    label: 'Orders & money',
    tasks: [
      {
        id: 'order-badges',
        title: 'Read the extra badges on All orders',
        why: "A plain \"Completed\" or \"Failed\" doesn't say everything worth knowing about an order, these small badges do.",
        steps: [
          'A **"DataHub manual"** badge, with a number and a copy icon, means DataHub routed this one to a person on their side to clear by hand, not their automated system, it can take much longer to settle. The number is their own ticket ID, for their support if it needs chasing.',
          'A **"Code"** badge means an automated system handled it (DataHub\'s automation, or any GMPL order, which has no manual queue), nothing to chase.',
          'A **"Resolved by admin"** badge means someone here used "Resolve by hand" on `Needs attention`, DataHub\'s own webhook or polling never actually confirmed this one.',
          'A **"Never paid"** badge on a failed order means the customer was never charged, so there is nothing to refund, and an **"Unresolved"** badge means the supplier never answered at all and it waits for a person. A **"Refund pending"** or **"Refund rejected"** badge on a failed order tells you where its refund stands without opening `Refunds` first, "Refunded" (a different badge) means it\'s already paid.',
        ],
      },
      {
        id: 'stuck-order',
        title: 'Sort out a stuck or disputed order',
        why: "The reconciler checks and settles almost everything on its own. This is where the rest (the handful it refuses to guess at) waits for you.",
        steps: [
          'Go to `Needs attention`, the number in its badge tells you how many are waiting. Press **"Check now"** at the top first to ask DataHub and GMPL for an answer straight away, since many clear themselves.',
          'If it’s under "Flagged for review", this order was settled one way, then a later signal disagreed. Check Paystack’s or DataHub’s own dashboard (or the customer directly), then click **"Acknowledge"** and say what you checked (at least five characters).',
          'If it’s under "Stuck orders", click **"Resolve by hand,"** choose **"Mark as delivered"** or **"Mark as failed,"** explain how you know (at least five characters), and click **"Confirm."** This runs the real settlement path: the agent is credited, or the refund is queued, exactly as if DataHub had reported it themselves.',
        ],
        notes: [
          {
            tone: 'danger',
            title: 'This never moves money on its own',
            body: 'Acknowledging only clears the flag. If the check turns up a real problem (paid out AND refunded, say) fix that yourself first, separately, before acknowledging.',
          },
        ],
      },
      {
        id: 'refund',
        title: 'Approve or refuse a refund',
        why: 'Nothing is ever returned automatically, an order failing only queues the debt, a person still decides.',
        steps: [
          'Go to `Refunds`, the queue is sorted oldest first.',
          'To pay it, click **"Refund."** A wallet refund lands instantly; a Mobile Money refund opens a modal to confirm the network and click **"Send {amount}."**',
          'To turn it down, click **"Refuse,"** and give a reason of at least five characters. This is kept on the record. If the failure itself was wrong (a mapping since fixed, stock back), click **"Reorder instead?"** to try delivering the bundle again, which cancels the refund if it delivers.',
          'On a Starter Paystack account nothing is sent automatically: clicking **"Refund"** on a Mobile Money refund parks the row under **Refunded** marked **"send by hand."** A transfer that fails, shows "needs OTP" or gets "no answer" ends up in the same place. Send the money yourself first, then click **"Paid another way?"** and record how you sent it by hand, so the books still match what actually happened.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'Before you refuse one',
            body: 'This customer paid and did not get their bundle. Only refuse if you know the bundle actually arrived, or the payment never did.',
          },
        ],
      },
      {
        id: 'withdrawal',
        title: 'Approve or reject a withdrawal',
        why: "An agent's balance is held the moment they ask, approving here accepts the request, and the Mobile Money goes out through Paystack on a business account or by your own hand on a Starter one.",
        steps: [
          'Go to `Withdrawals`, filter "Pending" to see what’s waiting on you.',
          'Check the Mobile Money number, network and amount on the request row (the transfer fee held shows under the amount and is not sent). There is no Review button, each pending row has **"Approve"** and **"Reject"** directly.',
          'Click **"Approve."** The banner at the top of the page tells you which case you are in. If Settings says this is a live Paystack business account, your Paystack balance is checked first, the transfer is handed to Paystack automatically, and if it is refused or reversed the amount goes straight back to the agent. On a Starter account (the "You send the money by hand" banner) approving only accepts the request and nothing is sent. You cannot approve a payout to your own agent profile, a superadmin has to.',
          'Click **"Reject"** instead if it shouldn’t be paid, the held amount returns to the agent’s balance immediately.',
          'On a Starter account, send the amount (not the fee) to the number yourself after approving, then click **"Paid another way?"** on the row, say how and where you sent it, and press **"Mark as sent."** Changed your mind before sending? **"Not sending it?"** gives the agent their money back. If you paid from the business Mobile Money linked to Paystack, also click **"Reimbursed"** under "Paid out of pocket, not yet reimbursed."',
        ],
        notes: [
          {
            tone: 'danger',
            title: 'A suspended agent',
            body: 'If the agent behind a request is currently suspended, the row shows a "Suspended" badge and Approve is switched off until you reactivate them on Users or reject the request instead.',
          },
        ],
      },
      {
        id: 'catalogue-accuracy',
        title: 'Find catalogue prices that are wrong',
        why: "A supplier's real charge can drift from what your catalogue believes, this shows exactly where, before it costs you on every future sale.",
        steps: [
          'Go to `Catalogue accuracy`.',
          'Read the table, one row per product, biggest loss first, going only by each product’s most recent sale.',
          'Fix it, go to `Cost prices`, click **"Sync"** under **"Supplier catalogue"** to pull the real supplier cost (costs cannot be typed by hand), then reprice that product with **"Edit"** or **"Set markup"** so future sales stop losing the difference.',
        ],
      },
      {
        id: 'float-risk',
        title: 'See which products cost more than the float can cover',
        why: "A product priced above what the float can currently pay for is one whose next sale is likely to fail after the customer has already paid, worth catching before that happens, not after.",
        steps: [
          'Go to `Float risk`.',
          'Read **"Priced above the float"**, on-sale products that cost more than what each supplier float should hold going by your logged top-ups and costs (not the live reading, and only once you have logged a top-up for that supplier), costliest first.',
          'Click **"Turn off"** on one you want to stop selling until the float catches up.',
          'Check **"Currently inactive"** below it for anything off sale that might be safe to turn back on, click **"Turn on"** once you\'re satisfied it\'s priced above cost.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'A suggestion, not a switch',
            body: 'Nothing on this page flips a product on or off by itself, every row here is still the same deliberate click it always was.',
          },
        ],
      },
      {
        id: 'float',
        title: 'Top up and track my DataHub float',
        why: "DataHub's balance is prepaid, an empty float doesn't slow orders down, it fails them after the customer has already paid.",
        steps: [
          'Go to `Finance` and find the **Provider float** card, then pick the **DataHub GH** or **GMPL** tab for the supplier you topped up.',
          'Top up your DataHub account directly with them first (this platform never moves that money for you), then click **"Log a top-up"** here, record the amount, and choose where it came from: **"Outside the business"** for your own money, or **"Paystack, paying {supplier} back"** if it came from the business Mobile Money linked to Paystack (the only kind that clears "Already spent on bundles").',
          'Log money you take back out the same way, with **"Log money taken out."**',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'If it says "Float is short"',
            body: 'The figure it should hold and what DataHub actually reports have drifted apart, almost always a top-up or withdrawal that never got logged here.',
          },
        ],
      },
      {
        id: 'check-books',
        title: 'Check what I can actually spend',
        steps: [
          'Go to `Finance` (Overview only shows a short **"Money held and money owed"** card with the headline figure) and find **"Money held and money owed."**',
          'Read **"Actually free to spend."** It’s what should be at Paystack, minus everything already owed to an agent, a customer, or the float, the same figure the **"Free to spend now"** tile shows on `All orders`. It is cash, not profit, so it can differ from **"Profit earned"**.',
          'See the real breakdown lower on `Finance` under **"Where the money goes"**, switch between 7 days, 30 days and all time.',
        ],
      },
      {
        id: 'unapproved-numbers',
        title: 'Get an MTN number approved for delivery',
        why: "MTN bundles can't reach a number DataHub hasn't approved yet, most of these are real sales turned away without being charged, and any paid for before the check existed are held until the number is approved.",
        steps: [
          'Go to `Number approvals`, the page itself is titled "Approvals."',
          'Try automatically first, click **"Try sending automatically."** If it works, a toast confirms how many were sent. GMPL numbers are submitted for real this way, but DataHub numbers usually still need the copy step below, as the page says DataHub\'s own automatic submission is failing on their side.',
          'Otherwise, copy and enter them by hand, click **"Copy all {N} DataHub numbers,"** paste the list into your DataHub dashboard, add them there. A single number changed since the last batch? Click the small copy icon on just that row instead of the whole list.',
          'Click **"Re-check"** once you’re done, anything DataHub has approved releases its held order for delivery automatically.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'The "Copied" badge',
            body: 'Every number remembers when it was last copied. In the DataHub column, a number you have copied that is still waiting shows a "Copied 3 hours ago" badge, while one you have not copied yet shows "Pending" with a small copy icon beside the number. That\'s the checkpoint: a number that turns up after your last batch is easy to spot, instead of relying on memory for who\'s already been sent.',
          },
        ],
      },
    ],
  },
  {
    label: 'People',
    tasks: [
      {
        id: 'approve-agent',
        title: 'Approve a new agent',
        why: 'Only shows up if agent approval isn’t set to automatic, see "Turn agent approval on or off" below.',
        steps: [
          'Go to `Users`, a waiting applicant shows the Users nav badge with a count.',
          'Click **"Approve"** at the top of the page. They’re emailed immediately and their shop link starts working.',
          'Or click **"Refuse"** and give a reason, they see it the next time they sign in.',
        ],
      },
      {
        id: 'suspend-user',
        title: 'Suspend or reactivate an account',
        steps: [
          'Go to `Users` and find the account, or search by name, phone or email.',
          'Click **"Suspend"** (or **"Reactivate"**) and confirm in the dialog. Admin accounts show **"Manage in Platform team"** instead (superadmin only), suspend or **"Restore"** them there, and you cannot suspend yourself. Someone still waiting for approval shows "Decide above", use Approve or Refuse.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'What it actually does',
            body: 'Suspending blocks new orders and withdrawals, nothing is deleted, and their wallet balance and order history stay exactly as they were.',
          },
        ],
      },
      {
        id: 'auto-approve',
        title: 'Turn agent approval on or off',
        steps: [
          'Go to `Settings` → **"New agents."**',
          'Toggle **"Approve new agents automatically."** On means a new sign-up can sell straight away; off sends them to the Users queue for you to decide.',
        ],
      },
      {
        id: 'feedback-admin',
        title: 'Read feedback from agents',
        steps: [
          'Go to `Feedback`, the nav badge counts open items.',
          'Filter by **"Open,"** **"Reviewed,"** **"Resolved"** or **"All,"** and by kind (Suggestions or Issues).',
          'Add a note on what is being done, then click **"Mark reviewed"** or **"Mark resolved."** The platform owner only sees what an admin escalated to them.',
        ],
      },
      {
        id: 'announcements-admin',
        title: 'Send an announcement to agents and admins',
        why: 'A one-way notice for scheduled maintenance or something new, emailed and shown in the app.',
        steps: [
          'Go to `Announcements` and click **"New announcement."**',
          'Fill in **"Title"** and **"Message,"** then pick who gets it under **"Send to"**: everyone, agents, admins, or **"Choose people."**',
          'Click **"Send announcement."** Past ones are listed under **"Sent."** A plain admin also has a **"Received"** button for notices sent to them.',
        ],
      },
      {
        id: 'add-admin',
        title: 'Add someone to the platform team',
        steps: [
          'Go to `Platform team`. Only the platform owner (superadmin) sees it, a plain admin does not have this page.',
          'Click **"Add an admin"**, fill in their name, the email they will sign in with and their phone number (10 digits), then click **"Create and get link."**',
          'Pass on the one-time link. It’s usually emailed to them automatically; if not, copy it and send it yourself, WhatsApp, a message, however you’d normally reach them. It works once and expires in 48 hours.',
        ],
      },
    ],
  },
  {
    label: 'Shops & storefronts',
    tasks: [
      {
        id: 'branding',
        title: "Review an agent's shop look",
        why: 'Every agent shop takes payment details, so a shop badged like a bank or a mobile network is a fraud risk you carry, not them.',
        steps: [
          'Go to `Agent requests` in the Catalogue section of the menu (a separate page from `Branding`), and use the **"Waiting"** tab.',
          'Check the proposed name and logo. Nothing here is live yet.',
          'Click **"Approve"** if it’s fine, or **"Refuse"** with a reason they can act on, they see it directly.',
        ],
      },
      {
        id: 'domain',
        title: "Approve an agent's own domain",
        steps: [
          'Go to `Custom domains` (platform owner only, a plain admin does not see it). Agents\' requests sit under **"Waiting"**.',
          'Satisfy yourself they actually own it, then click **"Approve."** This is a trust decision, not a taste one. To turn one down click **"Refuse"** and give a reason (at least 5 characters), the agent is shown it. **"Approve after all"** reverses a refusal.',
          'Usually nothing more to do: an approved domain is checked automatically every 6 hours and goes live by itself once it points here. Click **"Mark as live"** only to skip that wait after you have confirmed it yourself.',
          'Use **"Suspend"** to take a live one offline temporarily (**"Mark as live"** brings it straight back), or **"Revoke"** to withdraw approval entirely, with a reason. The **"Domain pricing"** card at the top is what agents pay for a subdomain or custom domain, monthly and yearly, you set the price and the platform owner sets the cost it must clear.',
        ],
      },
      {
        id: 'my-branding',
        title: "Set the platform's own name and colour",
        steps: [
          'Go to `Branding`, the **"Your platform"** card.',
          'Set a platform name, logo and colour the same way an agent would for their own shop, this is what shows everywhere except inside an agent’s own approved shop.',
          'Click **"Save platform branding."** It applies immediately, reload the page to see it everywhere. A "Use a different colour in dark mode" option and the catalogue tile look are on the same card.',
        ],
      },
      {
        id: 'subscriptions-admin',
        title: 'Track what the platform pays for',
        why: 'Hosting, domain, Paystack and DataHub renewals, so nothing lapses without warning.',
        steps: [
          'Go to `Subscriptions` (Money section). Each service shows when it expires and a badge for how close that is.',
          'The platform owner clicks **"Add a service"** to track a new one with its renewal date, and **"Renewed"** to roll a recurring one forward, or **"Edit"** or **"Remove."**',
          'A plain admin sees what is coming up but cannot change it.',
        ],
      },
    ],
  },
  {
    label: 'Settings',
    tasks: [
      {
        id: 'fees-thresholds',
        title: 'Change fees, thresholds and my payout number',
        steps: [
          'Go to `Settings`.',
          '**Paystack’s fee**, the % shown to every buyer at checkout as a processing fee, on top of the price.',
          '**Float warnings**, set "Warn me at" and "Urgent at" GHS amounts; you’re emailed once each time the float crosses one, not on every order.',
          '**Smallest withdrawal**, the least an agent can ask to withdraw at once.',
          '**Your details**, your Mobile Money number, the one your own earnings are paid to (10 digits, like 0209876543). Click **"Save"** beside it. The other fields on this page save as soon as you leave them.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Going fully live',
            body: 'Whether real orders actually spend real money at DataHub is a server setting (`DATAHUB_LIVE`), not a switch on this screen, deliberately, so it takes a restart rather than a click.',
          },
        ],
      },
      {
        id: 'whatsapp-channel',
        title: 'Set my WhatsApp channel for agents',
        why: 'Lets every agent join one shared WhatsApp channel from inside the app, without you sending each one the link by hand.',
        steps: [
          'Go to `Settings` and find **"WhatsApp channel."**',
          'Paste your channel\'s invite link into **"Channel invite link"** and click out of the box to save. Leave it blank to stop offering one.',
          'Every agent gets a one-time popup the first time it\'s set (or whenever you change it), plus a standing card on their Dashboard to join whenever they like.',
        ],
      },
      {
        id: 'site-notice',
        title: 'Put up a site-wide notice',
        why: "For something everyone needs to know right now (a network running slow, planned downtime) without messaging each person.",
        steps: [
          'Go to `Settings` and find **"Site-wide notice."**',
          'Type the message into **"Notice message"** (up to 500 characters) and click out of the box to save, it is live immediately. Agents and admins see it as a banner at the top of every page, guests on the public storefront see it once as a popup.',
          'Clear the field and click out of it to take it down. It never expires on its own.',
        ],
      },
      {
        id: 'ask-for-help-admin',
        title: 'Ask the assistant instead of hunting for a page',
        why: 'Plain answers about your own float, refund queue, or stuck orders, from your real numbers, faster than opening each page yourself.',
        steps: [
          'Go to `Assistant` in the menu.',
          'Type a question, or tap one of the suggestions, "Is the float okay right now?", "Any refunds waiting on me?"',
          'It can only look things up, never act, it will always say where to click yourself to actually approve, resolve, or change something.',
        ],
      },
      {
        id: 'analytics-admin',
        title: 'See how the business is doing in Analytics',
        steps: [
          'Go to `Analytics`. It reads a separate reporting store that is computed on a schedule, so it is not a live view like the other pages.',
          'Use the tabs: **"Overview,"** **"Money,"** **"Sales,"** **"Operations,"** **"Agents"** and **"Cash."** Each answers one question, for example Cash answers whether you can keep selling tomorrow.',
        ],
      },
    ],
  },
]

export const agentGuide: GuideGroup[] = [
  {
    label: 'Getting started',
    tasks: [
      {
        id: 'sign-up',
        title: 'Become an agent',
        why: 'Selling under JKB Data Hub’s name means someone checks each new agent before switching them on, usually inside a day.',
        steps: [
          'Go to the register page (`/register`), or use the link an agent invited you with, it fills in their referral code for you.',
          'Fill in your full name, phone number, email and a password (at least 8 characters). Your phone number is also your login.',
          'Tick the box confirming you are 18 or over and accept the Terms of Service and Privacy Policy (you can’t continue without it), then click **"Create account."**',
          'Wait for approval. You’ll land on a status page saying your application is being reviewed, you’ll get an email the moment you’re approved, and your shop link works from then on.',
        ],
        notes: [
          {
            tone: 'success',
            title: 'While you wait',
            body: 'You can still buy bundles for yourself at the standard prices, nothing about the wait stops you shopping.',
          },
        ],
      },
      {
        id: 'sell-link',
        title: 'Get my sell link and share it',
        why: 'This is the one link that actually earns you money, customers who buy through it pay your prices, and your margin lands in your earnings the instant the order completes.',
        steps: [
          'Go to `Sell & refer`, or find the same link on your Dashboard, under "Your sell link."',
          'Copy your sell link from the field at the top, it looks like `yoursite.com/s/YOURCODE`.',
          'Click **"Share my shop on WhatsApp"** to send it straight away with a message already written, or paste the copied link anywhere yourself.',
          'If your own custom domain is approved and live, `Sell & refer` also shows it under **"Your own domain"**, share whichever one you prefer, both lead to the same shop.',
        ],
        notes: [
          {
            tone: 'success',
            title: 'You never touch the money or hold stock',
            body: 'The platform takes the payment and credits the difference between your price and your cost straight to your earnings.',
          },
        ],
      },
      {
        id: 'invite',
        title: 'Invite another agent',
        steps: [
          'Go to `Sell & refer` and scroll to **"Your referral link."**',
          'Copy the referral link or code and click **"Invite an agent on WhatsApp"** to send it with a message already written.',
          'Watch your chain grow in the table below, everyone who joins under your code shows up there.',
        ],
        notes: [
          {
            tone: 'warning',
            title: "What this doesn't do",
            body: 'You are not paid anything from what they sell, now or ever, every agent earns from their own sales only, at the same price no matter who is above them. Inviting someone grows your chain for your own visibility; it has no effect on anybody’s price or earnings.',
          },
        ],
      },
    ],
  },
  {
    label: 'My shop',
    tasks: [
      {
        id: 'prices',
        title: 'Set my own prices',
        why: 'You buy at your own cost and charge what you like, the difference is yours, and everyone above you is still paid automatically on every sale.',
        steps: [
          'Go to `My prices`.',
          'For one product (click **"Edit"** on its row, type your resale price, and click **"Save price."** It can be anything from your own cost upward) there’s no ceiling.',
          'For everything at once, click **"Apply markup to all,"** pick a percentage over your cost (5% to 30%), check the live example, and confirm.',
        ],
      },
      {
        id: 'look',
        title: "Customise my shop's look",
        steps: [
          'Go to `Shop look`.',
          'Set your shop name (up to 40 characters) and logo (PNG, JPEG or WebP, under 100KB).',
          'Click **"Send for approval."** Your shop keeps its current name and logo until they’re approved, sending again replaces whatever was waiting. Colour is separate and needs no approval: pick one from the gallery, or choose **"Or pick your own colour"** and type a hex code (with an optional separate dark-mode colour), then click **"Apply colour"** and it goes live straight away. You can also choose a product tile style and click **"Apply this style"**, also with no review.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'What gets refused',
            body: 'A name or logo that looks like a bank, a mobile network, or another company, your shop takes payment details, and customers have to be able to tell who they’re paying. The payment page and receipts always show the platform’s own registered business name, whatever your shop is called.',
          },
        ],
      },
      {
        id: 'domain',
        title: 'Request my own domain',
        why: 'Point a domain you already own at your shop instead of sharing your /s/ link.',
        steps: [
          'Go to `Shop look` and scroll to the bottom, to **"Your own web address."**',
          'If you see a choice, pick **"My own domain"** (**"Free subdomain"** instead lets you just pick a label). Type your domain, just the domain itself, like `yourshop.com`, no `https://` or `www`, and choose **Monthly** or **Yearly** billing.',
          'Click **"Send for approval."** Once approved, add the CNAME record shown on the page (`cname.vercel-dns.com`) at your domain’s registrar. The platform checks every 6 hours and switches it on once it points at us, no need to come back and check. The monthly or yearly price is charged from your balance once it’s live.',
          'Once it’s live, it shows as a real, clickable link on your Dashboard and under "Your own domain" on `Sell & refer`, click the small copy icon beside either to copy it instantly.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Only one at a time',
            body: 'Asking for a different domain replaces the one you already have, only one can carry your shop at once.',
          },
        ],
      },
    ],
  },
  {
    label: 'Sales & money',
    tasks: [
      {
        id: 'sales',
        title: 'See my sales and earnings',
        steps: [
          'For every order (go to `Sales`) filter by All, Completed, In progress or Failed, or search by number, reference or product.',
          'For your money (go to `Earnings`) every credit, reversal and withdrawal is listed, newest first, and it’s append-only: nothing here can ever be edited, only added to.',
        ],
      },
      {
        id: 'order-status',
        title: "Check on a customer's order",
        steps: [
          'Go to `Sales` and find the order, search by the customer’s number, the reference, or the product.',
          'Click the row to see its status, recipient, how it was paid, and exactly how the sale split between you, DataHub and anyone above you.',
        ],
        notes: [
          {
            tone: 'success',
            title: 'If it failed',
            body: 'The order is refunded automatically and any margin you were credited is reversed, you don’t need to do anything.',
          },
        ],
      },
      {
        id: 'withdraw',
        title: 'Withdraw my earnings',
        steps: [
          'Go to `Withdraw`.',
          'Click **"Request withdrawal,"** enter an amount (or click "Withdraw the max," which already leaves room for the fee), pick your Mobile Money network, and enter the number to pay it to, it doesn’t have to be the one you sign in with.',
          'Click **"Send request."** The amount plus a flat GHS 1.00 sending fee leave your available balance right away and are held until it’s decided. If the request is rejected or cancelled, both come back.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'What happens next',
            body: 'James reviews and pays each request by hand, usually within 24 hours, you’ll get an SMS once it’s sent. The smallest withdrawal is GHS 10.00 (the admin can change it), and you can have up to 3 requests waiting at once.',
          },
        ],
      },
      {
        id: 'cancel-withdraw',
        title: 'Cancel a withdrawal request',
        steps: [
          'Go to `Withdraw` and find the request in **"Your requests."**',
          'Click **"Cancel"**, only shown while it’s still "Awaiting review." The amount and the GHS 1.00 sending fee return to your available balance immediately.',
        ],
      },
      {
        id: 'reports',
        title: 'Pull a sales report',
        steps: [
          'Go to `Reports`.',
          'Pick a range from the date list (Today, Yesterday, Last 7, 30 or 90 days, This month, Last month, This year and more), or choose your own dates.',
          'Click **"Export CSV"** to download the same figures as a spreadsheet.',
        ],
      },
      {
        id: 'ask-for-help-agent',
        title: 'Ask the assistant instead of hunting for a page',
        why: 'Plain answers about your own earnings, prices, downline or domain, from your real numbers, not a generic guide.',
        steps: [
          'Go to `Assistant` in the menu.',
          'Type a question, or tap one of the suggestions, "How much have I earned?", "What are my current prices?"',
          'It can only look things up, never act on your behalf, it will always explain how to actually do something yourself in the app.',
        ],
      },
      {
        id: 'feedback-agent',
        title: 'Send feedback to the admin',
        why: 'A suggestion, or something not working right, goes straight to the admin and the platform team.',
        steps: [
          'Go to `Feedback` in the menu.',
          'Choose **"Suggestion"** or **"Something is wrong,"** then write what would help, or what went wrong, in the box. It needs at least five characters.',
          'Click **"Send."** It appears under **"What you\'ve sent,"** newest first, and shows as reviewed or resolved once someone has looked at it.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'What it is for',
            body: 'Suggestions and problems with the app itself. It is not a place for customer support questions.',
          },
        ],
      },
      {
        id: 'announcements-agent',
        title: 'Read announcements from the admin',
        steps: [
          'Go to `Announcements`. A number beside it in the menu counts what you have not read yet.',
          'Read the notices from the admin and the platform team. They are marked as read as soon as the list is shown.',
        ],
      },
    ],
  },
]

export const customerGuide: GuideGroup[] = [
  {
    label: 'Buying',
    tasks: [
      {
        id: 'buy',
        title: 'Buy data or airtime',
        why: 'Four steps, every time: pick the bundle, enter the number, pay, get it delivered.',
        steps: [
          'Go to the shop (`/shop`), or straight from the homepage, which shows the same bundles.',
          'Pick a category and network (MTN, Telecel or AirtelTigo), then click any bundle, that takes you straight into checkout, no cart or basket step.',
          'Enter the recipient’s phone number (the number that receives the bundle) and click **"Continue."**',
          'Check the number carefully on the confirm screen. Mobile Money is the payment method, and the screen lists the bundle price, a small processing fee and the total you pay, with links to the Terms, Refund Policy and Privacy Policy, which you agree to by paying. Then click **"Confirm and pay."**',
          'Approve the payment prompt on your phone. You’re brought back automatically, and the bundle lands within seconds, on screen and by SMS.',
        ],
        notes: [
          {
            tone: 'danger',
            title: 'Before you confirm',
            body: 'Bundles sent to a wrong number can’t be recovered, check the digits before continuing.',
          },
        ],
      },
      {
        id: 'checker',
        title: 'Buy a result checker and use my voucher',
        steps: [
          'Go to Result checkers (`/checkers`).',
          'Click **"Buy {BECE or WASSCE} checker"** and pay the same way as a bundle, enter your number, confirm, pay by Mobile Money.',
          'Copy your Serial number and PIN shown on the receipt screen, the same two are also sent to you by SMS.',
          'Go to the official WAEC checker portal and enter the serial number and PIN there, that’s where the actual result check happens, not on this site.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'Before you buy',
            body: 'Each voucher allows a limited number of checks, as set by WAEC. Once a serial and PIN have been revealed to you they can’t be refunded or exchanged.',
          },
        ],
      },
      {
        id: 'agent-shop',
        title: "Buy through an agent's shop link",
        steps: [
          'Open the link an agent shared with you, it looks like `jamesdataconsult.com/s/AGENTCODE`.',
          'Buy exactly the same way as the ordinary shop, the only difference is the price and the web address; the checkout steps are identical.',
        ],
        notes: [
          {
            tone: 'info',
            title: "If the link doesn't work",
            body: 'An unrecognised code just drops you back to the standard shop at the platform’s own prices, nothing is lost.',
          },
        ],
      },
      {
        id: 'after-pay',
        title: 'Know what happens right after I pay',
        steps: [
          'You’re brought back automatically once Paystack has taken the payment, you don’t need to do anything on that screen.',
          'If it says "Waiting for your payment", approve the Mobile Money prompt on your phone; the page checks again on its own every few seconds. Nothing has been taken from you yet.',
          'Once it’s confirmed, you land straight on your receipt, the bundle, or the checker voucher, is already there.',
        ],
      },
    ],
  },
  {
    label: "After you've bought something",
    tasks: [
      {
        id: 'track',
        title: 'Track an order I already placed',
        steps: [
          'Go to Track your order (`/track`), linked from the homepage.',
          'Enter your order reference (looks like `JDC-884120384`, from your receipt or SMS) and the phone number you paid with.',
          'Click **"Find my order"** to see its status, and your voucher details again if it was a checker.',
        ],
      },
      {
        id: 'refund',
        title: 'Get my money back for a failed order',
        why: 'You never have to ask, a failed order queues its own refund automatically.',
        steps: [
          'Do nothing yet. If a bundle fails to deliver, the amount is logged as owed to you the moment it fails.',
          'It’s checked by a person before it’s sent back (usually within a few hours, not instantly) then paid to the same Mobile Money number you paid from.',
          'Check on it any time by going to Track your order with your reference and phone number.',
        ],
        notes: [
          {
            tone: 'success',
            title: "If it's taking a while",
            body: 'Reach James on 020 987 6543 with your reference number.',
          },
        ],
      },
      {
        id: 'account',
        title: 'Save my orders under an account',
        why: 'Entirely optional, most buyers never create one.',
        steps: [
          'On the Track your order page, look for **"Create an account"** at the bottom, every order you place afterwards is saved automatically.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Buying often, or just once?',
            body: 'An account only helps if you buy regularly and want your history in one place, a single purchase needs nothing more than your reference and phone number.',
          },
        ],
      },
    ],
  },
]
