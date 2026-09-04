/**
 * The in-app "what can I do" guide — one data set per role, rendered by
 * `pages/Info.tsx`. Kept as plain data (not JSX) so search can run over it as
 * plain text and so the same shape works for every role without duplicating
 * the page around it.
 *
 * Step and note text supports a tiny markup subset, parsed by `renderInline`
 * in `pages/Info.tsx`: **bold** and `code` (used for exact button/page/route
 * names — this is a real navigation instruction, not decoration).
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
          'Open `Overview` — it shows a **"Get set up"** checklist until all three steps below are done.',
          'Log your first float top-up. Scroll to the **Provider float** card and click **"Log a top-up."** Every order spends from this prepaid DataHub balance — without it, a paid order can still fail to deliver.',
          'Price your catalogue. Go to `Cost prices` and set what agents and walk-up customers pay — see "Price my catalogue" below. Nothing sells until this is done.',
          'Set your own payout number. Go to `Settings` → **Your details** and enter the Mobile Money number your own earnings and any manual payouts should go to.',
        ],
      },
      {
        id: 'price-catalogue',
        title: 'Price my catalogue',
        why: 'A bundle arrives from the provider priced at cost and stays out of the shop until you say what it sells for.',
        steps: [
          'Go to `Cost prices` — the page itself is titled "Prices."',
          'Pick a category along the top (Data, Airtime, and so on).',
          'For the whole category at once — click **"Set markup,"** enter what agents pay over cost and what walk-up customers pay over cost (it starts at 15% / 25%), and click **"Apply to {N}."** The markup is remembered, so a future cost change moves prices with it.',
          'For one product — click **"Edit"** on its row, type exact GHS prices for "Your price to agents" and "Your own walk-up price," and click **"Save prices."** Both must clear what you pay the provider.',
          'Click the **"Off sale"** button on any row to flip it to **"On sale"** once its price is set.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'Before you change a live price',
            body: 'Every order already stores the split it was sold at — past reports, agent earnings and your own margin never move. Only future orders use the new price.',
          },
        ],
      },
      {
        id: 'sync-suppliers',
        title: 'Sync what my suppliers actually sell',
        why: "Your suppliers' own stock, cost and availability — pulled in on demand, never invented.",
        steps: [
          'Go to `Cost prices` and scroll down to **"Supplier catalogue."**',
          'Click **"Sync."** A toast reports how many products were newly created, repriced, or withdrawn from stock.',
          'Publish anything new. If products arrived with no price yet, click **"Set a markup and publish"** in the callout above the table, or price them one by one on the main table above.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Read-only by design',
            body: 'The supplier catalogue table can’t be edited — it’s exactly what the supplier reported. "Manual only" means DataHub can’t deliver it automatically; those are refused at checkout rather than sold undeliverable.',
          },
        ],
      },
    ],
  },
  {
    label: 'Orders & money',
    tasks: [
      {
        id: 'stuck-order',
        title: 'Sort out a stuck or disputed order',
        why: "The reconciler checks and settles almost everything on its own. This is where the rest — the handful it refuses to guess at — waits for you.",
        steps: [
          'Go to `Needs attention` — the number in its badge tells you how many are waiting.',
          'If it’s under "Flagged for review" — this order was settled one way, then a later signal disagreed. Check Paystack’s or DataHub’s own dashboard (or the customer directly), then click **"Acknowledge"** and say what you checked.',
          'If it’s under "Stuck orders" — click **"Resolve by hand,"** choose **"Actually delivered"** or **"Actually failed,"** explain how you know, and click **"Confirm."** This runs the real settlement path: the agent is credited, or the refund is queued, exactly as if DataHub had reported it themselves.',
        ],
        notes: [
          {
            tone: 'danger',
            title: 'This never moves money on its own',
            body: 'Acknowledging only clears the flag. If the check turns up a real problem — paid out AND refunded, say — fix that yourself first, separately, before acknowledging.',
          },
        ],
      },
      {
        id: 'refund',
        title: 'Approve or refuse a refund',
        why: 'Nothing is ever returned automatically — an order failing only queues the debt, a person still decides.',
        steps: [
          'Go to `Refunds` — the queue is sorted oldest first.',
          'To pay it — click **"Refund."** A wallet refund lands instantly; a Mobile Money refund opens a modal to confirm the network and click **"Send {amount}."**',
          'To turn it down — click **"Refuse,"** and give a reason of at least five characters. This is kept on the record.',
          'If a Paystack transfer keeps failing — some accounts refuse third-party payouts outright. Once it’s failed, click **"Paid another way?"** and record how you sent it by hand, so the books still match what actually happened.',
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
        why: "An agent's balance is held the moment they ask — approving here is what actually sends the Mobile Money.",
        steps: [
          'Go to `Withdrawals` — filter "Pending" to see what’s waiting on you.',
          'Click **"Review"** on a request. The number and amount to send are shown as copyable fields.',
          'Click **"Approve."** Your Paystack balance is checked first, and the transfer is handed to Paystack automatically. If it’s ever refused or reversed, the amount goes straight back to the agent.',
          'Click **"Reject"** instead if it shouldn’t be paid — the held amount returns to the agent’s balance immediately.',
          'If Paystack keeps refusing the transfer outright (a Starter account that can’t send payouts at all) — once it’s failed, click **"Paid another way?"** and record how and where you sent it by hand.',
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
        why: "A supplier's real charge can drift from what your catalogue believes — this shows exactly where, before it costs you on every future sale.",
        steps: [
          'Go to `Catalogue accuracy`.',
          'Read the table — one row per product, biggest loss first, going only by each product’s most recent sale.',
          'Fix it — go to `Cost prices` and update that product’s cost so future sales stop losing the difference.',
        ],
      },
      {
        id: 'float',
        title: 'Top up and track my DataHub float',
        why: "DataHub's balance is prepaid — an empty float doesn't slow orders down, it fails them after the customer has already paid.",
        steps: [
          'Go to `Overview` and find the **Provider float** card.',
          'Top up your DataHub account directly with them first (this platform never moves that money for you), then click **"Log a top-up"** here and record the amount so your figures stay honest.',
          'Log money you take back out the same way, with **"Log money taken out."**',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'If it says "Float is short"',
            body: 'The figure it should hold and what DataHub actually reports have drifted apart — almost always a top-up or withdrawal that never got logged here.',
          },
        ],
      },
      {
        id: 'check-books',
        title: 'Check what I can actually spend',
        steps: [
          'Go to `Overview` and find **"Money held and money owed."**',
          'Read **"Actually free to spend."** It’s what should be at Paystack, minus everything already owed to an agent, a customer, or the float — the same figure "Your profit" shows on the Orders page.',
          'See the real breakdown lower on the same page under **"Where the money goes"** — switch between 7 days, 30 days and all time.',
        ],
      },
      {
        id: 'unapproved-numbers',
        title: 'Get an MTN number approved for delivery',
        why: "MTN bundles can't reach a number DataHub hasn't approved yet — each one here is a real sale that was turned away without being charged.",
        steps: [
          'Go to `Number approvals` — the page itself is titled "Approvals."',
          'Try automatically first — click **"Try sending automatically."** If it works, a toast confirms how many were sent.',
          'Otherwise, copy and enter them by hand — click **"Copy all {N},"** paste the list into your DataHub dashboard, add them there.',
          'Click **"Re-check"** once you’re done — anything DataHub has approved releases its held order for delivery automatically.',
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
        why: 'Only shows up if agent approval isn’t set to automatic — see "Turn agent approval on or off" below.',
        steps: [
          'Go to `Users` — a waiting applicant shows the Users nav badge with a count.',
          'Click **"Approve"** at the top of the page. They’re emailed immediately and their shop link starts working.',
          'Or click **"Refuse"** and give a reason — they see it the next time they sign in.',
        ],
      },
      {
        id: 'suspend-user',
        title: 'Suspend or reactivate an account',
        steps: [
          'Go to `Users` and find the account, or search by name, phone or email.',
          'Click **"Suspend"** (or "Reactivate") and confirm in the dialog.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'What it actually does',
            body: 'Suspending blocks new orders and withdrawals — nothing is deleted, and their wallet balance and order history stay exactly as they were.',
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
        id: 'add-admin',
        title: 'Add someone to the platform team',
        steps: [
          'Go to `Platform team`.',
          'Click **"Add an admin"** and fill in their name, email and phone.',
          'Pass on the one-time link. It’s usually emailed to them automatically; if not, copy it and send it yourself — WhatsApp, a message, however you’d normally reach them. It works once and expires in 48 hours.',
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
          'Go to `Branding` → **"Agent requests."**',
          'Check the proposed name and logo. Nothing here is live yet.',
          'Click **"Approve"** if it’s fine, or **"Refuse"** with a reason they can act on — they see it directly.',
        ],
      },
      {
        id: 'domain',
        title: "Approve an agent's own domain",
        steps: [
          'Go to `Custom domains`.',
          'Satisfy yourself they actually own it, then click **"Approve."** This is a trust decision, not a taste one.',
          'Click **"Mark as live"** once you can see the domain actually pointed here — that can take a while after the agent updates their DNS.',
          'Use **"Suspend"** to take a live one offline temporarily (one click brings it back), or **"Revoke"** to withdraw approval entirely, with a reason.',
        ],
      },
      {
        id: 'my-branding',
        title: "Set the platform's own name and colour",
        steps: [
          'Go to `Branding` → **"Your platform"** at the top.',
          'Set a platform name, logo and colour the same way an agent would for their own shop — this is what shows everywhere except inside an agent’s own approved shop.',
          'Click **"Save platform branding."** It applies immediately — reload the page to see it everywhere.',
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
          '**Paystack’s fee** — the % shown to every buyer at checkout as a processing fee, on top of the price.',
          '**Float warnings** — set "Warn me at" and "Urgent at" GHS amounts; you’re emailed once each time the float crosses one, not on every order.',
          '**Smallest withdrawal** — the least an agent can ask to withdraw at once.',
          '**Your details** — the number your own withdrawals are paid to. Each field saves as soon as you leave it.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Going fully live',
            body: 'Whether real orders actually spend real money at DataHub is a server setting (`DATAHUB_LIVE`), not a switch on this screen — deliberately, so it takes a restart rather than a click.',
          },
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
        why: 'Selling under JKB Data Hub’s name means someone checks each new agent before switching them on — usually inside a day.',
        steps: [
          'Go to the register page (`/register`), or use the link an agent invited you with — it fills in their referral code for you.',
          'Fill in your full name, phone number, email and a password (at least 8 characters). Your phone number is also your login.',
          'Accept the terms and click **"Create account."**',
          'Wait for approval. You’ll land on a status page saying your application is being reviewed — you’ll get an email the moment you’re approved, and your shop link works from then on.',
        ],
        notes: [
          {
            tone: 'success',
            title: 'While you wait',
            body: 'You can still buy bundles for yourself at the standard prices — nothing about the wait stops you shopping.',
          },
        ],
      },
      {
        id: 'sell-link',
        title: 'Get my sell link and share it',
        why: 'This is the one link that actually earns you money — customers who buy through it pay your prices, and your margin lands in your earnings the instant the order completes.',
        steps: [
          'Go to `Sell & refer` — or find the same link on your Dashboard, under "Your sell link."',
          'Copy your sell link from the field at the top — it looks like `yoursite.com/s/YOURCODE`.',
          'Click **"Share my shop on WhatsApp"** to send it straight away with a message already written, or paste the copied link anywhere yourself.',
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
          'Watch your chain grow in the table below — everyone who joins under your code shows up there.',
        ],
        notes: [
          {
            tone: 'warning',
            title: "What this doesn't do",
            body: 'You are not paid anything from what they sell, now or ever — every agent earns from their own sales only, at the same price no matter who is above them. Inviting someone grows your chain for your own visibility; it has no effect on anybody’s price or earnings.',
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
        why: 'You buy at your own cost and charge what you like — the difference is yours, and everyone above you is still paid automatically on every sale.',
        steps: [
          'Go to `My prices`.',
          'For one product — click **"Edit"** on its row, type your resale price, and click **"Save price."** It can be anything from your own cost upward — there’s no ceiling.',
          'For everything at once — click **"Apply markup to all,"** pick a percentage over your cost (5% to 30%), check the live example, and confirm.',
        ],
      },
      {
        id: 'look',
        title: "Customise my shop's look",
        steps: [
          'Go to `Shop look`.',
          'Set your shop name and logo (PNG, JPEG or WebP, under 100KB), and choose a colour — pick it visually or type the hex code. Turn on a separate dark-mode colour if you want one.',
          'Click **"Send for approval."** Your shop keeps its current look until it’s approved — sending again replaces whatever was waiting.',
        ],
        notes: [
          {
            tone: 'warning',
            title: 'What gets refused',
            body: 'A name or logo that looks like a bank, a mobile network, or another company — your shop takes payment details, and customers have to be able to tell who they’re paying. The payment page and receipts always show the platform’s own registered business name, whatever your shop is called.',
          },
        ],
      },
      {
        id: 'domain',
        title: 'Request my own domain',
        why: 'Point a domain you already own at your shop instead of sharing your /s/ link.',
        steps: [
          'Go to `Shop look` and scroll to the bottom, to **"Your own domain."**',
          'Type your domain — just the domain itself, like `yourshop.com`, no `https://` or `www`.',
          'Click **"Send for approval."** Once approved, point your domain’s DNS at the platform — it goes live as soon as that’s confirmed, which can take a little while.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Only one at a time',
            body: 'Asking for a different domain replaces the one you already have — only one can carry your shop at once.',
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
          'For every order — go to `Sales` — filter by All, Completed, In progress or Failed, or search by number, reference or product.',
          'For your money — go to `Earnings` — every credit, reversal and withdrawal is listed, oldest first, and it’s append-only: nothing here can ever be edited, only added to.',
        ],
      },
      {
        id: 'order-status',
        title: "Check on a customer's order",
        steps: [
          'Go to `Sales` and find the order — search by the customer’s number, the reference, or the product.',
          'Click the row to see its status, recipient, how it was paid, and exactly how the sale split between you, DataHub and anyone above you.',
        ],
        notes: [
          {
            tone: 'success',
            title: 'If it failed',
            body: 'The order is refunded automatically and any margin you were credited is reversed — you don’t need to do anything.',
          },
        ],
      },
      {
        id: 'withdraw',
        title: 'Withdraw my earnings',
        steps: [
          'Go to `Withdraw`.',
          'Click **"Request withdrawal,"** enter an amount (or click "Withdraw everything"), pick your Mobile Money network, and enter the number to pay it to — it doesn’t have to be the one you sign in with.',
          'Click **"Send request."** The amount leaves your available balance right away and is held until it’s decided.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'What happens next',
            body: 'James reviews and pays each request by hand, usually within 24 hours — you’ll get an SMS once it’s sent.',
          },
        ],
      },
      {
        id: 'cancel-withdraw',
        title: 'Cancel a withdrawal request',
        steps: [
          'Go to `Withdraw` and find the request in **"Your requests."**',
          'Click **"Cancel"** — only shown while it’s still "Awaiting review." The amount returns to your available balance immediately.',
        ],
      },
      {
        id: 'reports',
        title: 'Pull a sales report',
        steps: [
          'Go to `Reports`.',
          'Pick a range — Last 7 days, Last 30 days, or Custom dates.',
          'Click **"Export CSV"** to download the same figures as a spreadsheet.',
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
          'Go to the shop (`/shop`) — or straight from the homepage, which shows the same bundles.',
          'Pick a category and network (MTN, Telecel or AirtelTigo), then click any bundle — that takes you straight into checkout, no cart or basket step.',
          'Enter the recipient’s phone number — the number that receives the bundle — and click **"Continue."**',
          'Check the number carefully on the confirm screen, choose **Mobile Money** and your network (MTN MoMo, Telecel Cash or AirtelTigo Money), then click **"Confirm and pay."**',
          'Approve the payment prompt on your phone. You’re brought back automatically, and the bundle lands within seconds — on screen and by SMS.',
        ],
        notes: [
          {
            tone: 'danger',
            title: 'Before you confirm',
            body: 'Bundles sent to a wrong number can’t be recovered — check the digits before continuing.',
          },
        ],
      },
      {
        id: 'checker',
        title: 'Buy a result checker and use my voucher',
        steps: [
          'Go to Result checkers (`/checkers`).',
          'Click **"Buy {BECE or WASSCE} checker"** and pay the same way as a bundle — enter your number, confirm, pay by Mobile Money.',
          'Copy your Serial number and PIN shown on the receipt screen — the same two are also sent to you by SMS.',
          'Go to the official WAEC checker portal and enter the serial number and PIN there — that’s where the actual result check happens, not on this site.',
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
          'Open the link an agent shared with you — it looks like `jamesdataconsult.com/s/AGENTCODE`.',
          'Buy exactly the same way as the ordinary shop — the only difference is the price and the web address; the checkout steps are identical.',
        ],
        notes: [
          {
            tone: 'info',
            title: "If the link doesn't work",
            body: 'An unrecognised code just drops you back to the standard shop at the platform’s own prices — nothing is lost.',
          },
        ],
      },
      {
        id: 'after-pay',
        title: 'Know what happens right after I pay',
        steps: [
          'You’re brought back automatically once Paystack has taken the payment — you don’t need to do anything on that screen.',
          'If it says "Waiting for your payment" — approve the Mobile Money prompt on your phone; the page checks again on its own every few seconds. Nothing has been taken from you yet.',
          'Once it’s confirmed, you land straight on your receipt — the bundle, or the checker voucher, is already there.',
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
          'Go to Track an order (`/track`) — linked from the homepage.',
          'Enter your order reference (looks like `JDC-884120`, from your receipt or SMS) and the phone number you paid with.',
          'Click **"Find my order"** to see its status, and your voucher details again if it was a checker.',
        ],
      },
      {
        id: 'refund',
        title: 'Get my money back for a failed order',
        why: 'You never have to ask — a failed order queues its own refund automatically.',
        steps: [
          'Do nothing yet. If a bundle fails to deliver, the amount is logged as owed to you the moment it fails.',
          'It’s checked by a person before it’s sent back — usually within a few hours, not instantly — then paid to the same Mobile Money number you paid from.',
          'Check on it any time by going to Track an order with your reference and phone number.',
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
        why: 'Entirely optional — most buyers never create one.',
        steps: [
          'On the Track an order page, look for **"Create an account"** at the bottom — every order you place afterwards is saved automatically.',
        ],
        notes: [
          {
            tone: 'info',
            title: 'Buying often, or just once?',
            body: 'An account only helps if you buy regularly and want your history in one place — a single purchase needs nothing more than your reference and phone number.',
          },
        ],
      },
    ],
  },
]
