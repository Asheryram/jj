import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BUSINESS, TRADING_NAME, mailtoLink } from '../lib/business'
import { useRegisterPath, useShopPath } from '../lib/shopPath'
import { Button, Callout, Card } from '../components/ui'

/**
 * The policy pages: privacy, terms, refunds, cookies and storage, data requests
 * and contact.
 *
 * Plain readable text on purpose. These are the pages a worried customer or a
 * regulator reads, so they say what the app really does (every statement below
 * was checked against the code: what it stores, who it sends data to, what a
 * refund actually involves) and leave out anything the code cannot back up.
 * Wording that needs a lawyer's sign-off is a draft until someone qualified has
 * read it, see the note in DEPLOY-INFRA.md.
 */

function LegalPage({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">{intro}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Last reviewed {BUSINESS.legalUpdated}
      </p>
      <div className="mt-8 space-y-8">{children}</div>
      <LegalNav />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      <div className="mt-2 space-y-3 leading-relaxed text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  )
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

function LegalNav() {
  const shopPath = useShopPath()
  const links: [string, string][] = [
    ['Privacy Policy', shopPath('/privacy')],
    ['Terms of Service', shopPath('/terms')],
    ['Refund Policy', shopPath('/refunds')],
    ['Cookies and storage', shopPath('/cookies')],
    ['Data requests', shopPath('/data-request')],
    ['Contact', shopPath('/contact')],
  ]
  return (
    <nav
      aria-label="Legal pages"
      className="mt-12 border-t border-slate-200 dark:border-slate-700 pt-6"
    >
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {links.map(([label, to]) => (
          <li key={label}>
            <Link
              to={to}
              className="font-semibold text-brand-700 dark:text-brand-300 hover:underline"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** The contact line used across pages, built only from what is configured. */
function ContactLine() {
  const shopPath = useShopPath()
  if (!BUSINESS.email && !BUSINESS.phone) {
    return (
      <>
        through the <Link className="font-semibold underline" to={shopPath('/contact')}>contact page</Link>
      </>
    )
  }
  return (
    <>
      {BUSINESS.email && (
        <a className="font-semibold underline" href={`mailto:${BUSINESS.email}`}>
          {BUSINESS.email}
        </a>
      )}
      {BUSINESS.email && BUSINESS.phone && ' or '}
      {BUSINESS.phone && <span className="font-semibold">{BUSINESS.phone}</span>}
    </>
  )
}

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`How ${TRADING_NAME} collects, uses and protects your personal data, in line with Ghana's Data Protection Act, 2012 (Act 843).`}
    >
      <Section title="Who we are">
        <p>
          {BUSINESS.legalName ?? TRADING_NAME} runs this site and decides how your data is used.
          See the <Link className="font-semibold underline" to="/contact">contact page</Link> for
          how to reach us.
        </p>
      </Section>

      <Section title="What we collect">
        <Bullets
          items={[
            <>
              <strong className="font-semibold">When you buy:</strong> the phone number that
              receives the bundle or airtime, the phone number you pay from, the product, the
              amount and the time. You do not need an account to buy.
            </>,
            <>
              <strong className="font-semibold">When you become an agent:</strong> your name,
              phone number, email address and password (stored only in scrambled form), your
              Mobile Money number for withdrawals, and your shop name and logo if you set them.
            </>,
            <>
              <strong className="font-semibold">Technical data:</strong> basic request details such
              as browser type and the pages requested, which our servers log to run the service
              and to detect fraud.
            </>,
          ]}
        />
        <p>We do not collect more than we need to deliver your order and keep accounts safe.</p>
      </Section>

      <Section title="Why we use it">
        <Bullets
          items={[
            'To deliver what you bought and tell you the result by SMS and on screen.',
            'To take payment, and to refund you when an order fails.',
            'To run agent accounts, shop links, earnings and withdrawals.',
            'To prevent fraud and to meet accounting and legal obligations.',
          ]}
        />
        <p>We do not sell your personal data and we do not use it for third party advertising.</p>
      </Section>

      <Section title="Who we share it with">
        <Bullets
          items={[
            <>
              <strong className="font-semibold">Paystack</strong>, which processes Mobile Money and
              card payments. Your card details go to Paystack, never to us.
            </>,
            'The network or supplier that delivers your bundle, who need the recipient number and the product.',
            'An SMS provider, to send you order messages.',
            'The agent whose shop link you bought through, who can see the orders made in their shop.',
            'Authorities, where the law requires it.',
          ]}
        />
      </Section>

      <Section title="How long we keep it">
        <p>
          Order and payment records are kept for as long as we need them to handle disputes,
          refunds and our accounting and legal duties. Agent account details are kept while the
          account is open and for a reasonable period afterwards for the same reasons. When data is
          no longer needed it is deleted or anonymised.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under Act 843 you can ask to see the personal data we hold about you, to have it
          corrected, and to have it deleted where we have no legal reason to keep it. You can
          also object to how it is used. Use the{' '}
          <Link className="font-semibold underline" to="/data-request">
            data request page
          </Link>
          . You may also complain to Ghana&apos;s Data Protection Commission.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Agent accounts are for people aged 18 and over. We do not knowingly collect data from
          anyone under 18 for an account. A young person who buys a bundle should do so with a
          parent or guardian&apos;s knowledge, and a parent or guardian can ask us to delete
          anything collected about a child.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Passwords are never stored in readable form, traffic is encrypted in transit, and access
          to customer data inside the business is limited to the staff who need it. No system is
          perfectly secure, so if you suspect your account has been misused, tell us straight away.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes in a way that matters, the date at the top of this page changes
          with it.
        </p>
      </Section>
    </LegalPage>
  )
}

export function Terms() {
  const shopPath = useShopPath()
  return (
    <LegalPage
      title="Terms of Service"
      intro={`The rules for using ${TRADING_NAME}, whether you are buying a bundle or selling as an agent.`}
    >
      <Section title="What we are">
        <p>
          {TRADING_NAME} is an independent reseller of data bundles, airtime, voice and SMS
          bundles, MTN AFA registration and BECE/WASSCE result checker vouchers. We are not
          affiliated with, endorsed by, or acting on behalf of WAEC, MTN, Telecel or AirtelTigo.
          Their names are used only to say which service a product is for.
        </p>
      </Section>

      <Section title="Buying">
        <Bullets
          items={[
            'The price you see is the price you pay. Any fee is shown before you confirm, never added afterwards.',
            'You must enter the right recipient number. A bundle sent to a number you entered wrongly cannot be taken back.',
            'Delivery is usually quick, but depends on the network. If an order fails, our Refund Policy applies.',
            'Result checker vouchers are limited by WAEC to a set number of checks. Result availability is controlled by WAEC alone.',
          ]}
        />
      </Section>

      <Section title="Agent accounts">
        <Bullets
          items={[
            'You must be 18 or over and give accurate details.',
            'You set your own resale prices, within the limits the platform shows you. Your margin is credited when an order completes.',
            'Keep your password private. You are responsible for what happens under your account.',
            'Withdrawals are paid to a Mobile Money number you have registered, after the checks described in the app.',
            'We may suspend an account that is used for fraud, misleading customers or breaking these terms.',
          ]}
        />
      </Section>

      <Section title="What you must not do">
        <Bullets
          items={[
            'Use the site to commit fraud or to pay with money or a card that is not yours.',
            'Misrepresent yourself as us, as a network, or as WAEC.',
            'Interfere with the site, probe it for weaknesses, or send automated bulk traffic.',
          ]}
        />
      </Section>

      <Section title="Limits on our responsibility">
        <p>
          We take care to deliver every order, but we depend on networks, suppliers and payment
          providers we do not control. Where an order fails, your remedy is a refund as described
          in the{' '}
          <Link className="font-semibold underline" to={shopPath('/refunds')}>
            Refund Policy
          </Link>
          . Nothing here limits any right you have under Ghanaian law that cannot be limited.
        </p>
      </Section>

      <Section title="Your data">
        <p>
          How we handle personal data is set out in the{' '}
          <Link className="font-semibold underline" to={shopPath('/privacy')}>
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Changes and law">
        <p>
          We may update these terms, and the date at the top of the page will change when we do.
          These terms are governed by the laws of Ghana.
        </p>
        <p>
          Questions? Reach us <ContactLine />.
        </p>
      </Section>
    </LegalPage>
  )
}

export function RefundPolicy() {
  return (
    <LegalPage
      title="Refund Policy"
      intro="What happens to your money when an order does not go through."
    >
      <Section title="If your order fails">
        <p>
          If a bundle, airtime or other product does not reach the number, you get your money
          back. You do not need to ask: the failed order is logged for a refund automatically.
        </p>
        <p>
          Refunds are checked by a person rather than sent automatically, so this usually takes a
          few hours. We will text the number you paid from when it is done.
        </p>
      </Section>

      <Section title="Where the money goes">
        <Bullets
          items={[
            'If you paid from a wallet, the money goes back into that wallet.',
            'If you paid with Mobile Money, it is sent to the same number you paid from. It normally arrives within a few minutes of approval.',
          ]}
        />
      </Section>

      <Section title="When we cannot refund">
        <Bullets
          items={[
            <>
              <strong className="font-semibold">Result checker vouchers</strong> once the serial
              number and PIN have been shown to you. They cannot be refunded or exchanged after
              that.
            </>,
            <>
              <strong className="font-semibold">A wrong recipient number</strong> that you entered
              yourself, where the product was delivered as ordered. A bundle cannot be recalled
              once a network has delivered it.
            </>,
          ]}
        />
        <p>
          If you think an order was delivered incorrectly, contact us and we will look into it
          rather than assume.
        </p>
      </Section>

      <Section title="Chasing a refund">
        <p>
          Track the order with your reference and phone number on the{' '}
          <Link className="font-semibold underline" to="/track">
            track page
          </Link>
          . If a refund is still not with you after a day, contact us <ContactLine /> with your
          reference.
        </p>
      </Section>
    </LegalPage>
  )
}

const STORAGE_ROWS: [string, string, string][] = [
  ['Sign in token', 'Keeps you signed in on this device', 'Until you log out'],
  ['Shop link', 'Remembers which agent shop you arrived through', 'This browser session'],
  ['Pending order', 'Lets us show your result when you return from the payment page', 'This browser session'],
  ['Theme', 'Remembers light or dark display', 'Until you clear site data'],
  ['Dismissed notices', 'So a notice you closed does not keep reappearing', 'This browser session'],
  ['Help card state', 'Remembers if you collapsed the guide card', 'Until you clear site data'],
]

export function CookiePolicy() {
  return (
    <LegalPage
      title="Cookies and storage"
      intro="What this site keeps on your device, and why."
    >
      <Section title="The short version">
        <p>
          We do not use advertising or tracking cookies, and we do not run analytics that follow
          you around the web. This site only stores what it needs to work, in your
          browser&apos;s own storage, listed below. Because all of it is strictly necessary, there
          is nothing to switch off, though you can clear it any time in your browser settings.
        </p>
      </Section>

      <Section title="What is stored">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <th scope="col" className="px-4 py-2.5 font-semibold">Item</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Why</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">How long</th>
              </tr>
            </thead>
            <tbody className="text-slate-600 dark:text-slate-300">
              {STORAGE_ROWS.map(([item, why, howLong]) => (
                <tr key={item} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <th scope="row" className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-50">
                    {item}
                  </th>
                  <td className="px-4 py-2.5">{why}</td>
                  <td className="px-4 py-2.5">{howLong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Other companies">
        <p>
          When you pay, you are sent to Paystack&apos;s payment page. Paystack may set its own
          cookies there, under its own policy, and we have no control over them.
        </p>
      </Section>

      <Section title="If this changes">
        <p>
          If we ever add anything that is not strictly necessary, such as analytics, we will ask
          for your permission first, and this page will say so.
        </p>
      </Section>
    </LegalPage>
  )
}

export function DataRequest() {
  const request = (kind: string, subject: string) =>
    mailtoLink(
      subject,
      `Hello,\n\nI would like to ${kind}.\n\nName:\nPhone number used with ${TRADING_NAME}:\nOrder reference (if any):\n\nThank you.`,
    )

  const options: { title: string; detail: string; href: string | null }[] = [
    {
      title: 'See my data',
      detail: 'A copy of the personal data we hold about you.',
      href: request('see the personal data you hold about me', 'Data access request'),
    },
    {
      title: 'Correct my data',
      detail: 'Fix a name, number or email that is wrong.',
      href: request('correct the personal data you hold about me', 'Data correction request'),
    },
    {
      title: 'Delete my data',
      detail: 'Delete your account and the personal data we have no legal reason to keep.',
      href: request('have my personal data deleted', 'Data deletion request'),
    },
  ]

  return (
    <LegalPage
      title="Your data requests"
      intro="Ask to see, correct or delete the personal data we hold about you."
    >
      <Section title="How it works">
        <p>
          Choose what you need, send us the pre-filled message, and tell us the phone number you
          use with us so we can find your records. We may ask you to prove it is really you before
          we share or delete anything, because handing your data to the wrong person would be a
          breach in itself.
        </p>
        <p>
          We will reply within a reasonable time, and no later than the law allows. Some records,
          such as payment records, we are required to keep for a period. If we cannot delete
          something we will say what and why.
        </p>
      </Section>

      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <Card key={option.title} className="flex flex-col p-4">
            <p className="font-semibold text-slate-900 dark:text-slate-50">{option.title}</p>
            <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{option.detail}</p>
            {option.href ? (
              <a href={option.href} className="mt-3">
                <Button size="sm" variant="outline" block>
                  Send request
                </Button>
              </a>
            ) : null}
          </Card>
        ))}
      </div>

      {!BUSINESS.email && (
        <Callout tone="info">
          The request buttons need a contact email to work, and none is configured on this site
          yet. Use the details on the <Link className="font-semibold underline" to="/contact">contact page</Link>.
        </Callout>
      )}

      <Section title="Agents">
        <p>
          If you are signed in as an agent, withdraw any balance first. Deleting an account closes
          your shop link and cannot be undone.
        </p>
      </Section>
    </LegalPage>
  )
}

export function Contact() {
  const registerPath = useRegisterPath()
  const rows: [string, ReactNode][] = []
  rows.push(['Trading name', TRADING_NAME])
  if (BUSINESS.legalName) rows.push(['Registered name', BUSINESS.legalName])
  if (BUSINESS.registrationNumber) rows.push(['Registration number', BUSINESS.registrationNumber])
  if (BUSINESS.address) rows.push(['Address', BUSINESS.address])
  if (BUSINESS.email) {
    rows.push([
      'Email',
      <a key="email" className="font-semibold underline" href={`mailto:${BUSINESS.email}`}>
        {BUSINESS.email}
      </a>,
    ])
  }
  if (BUSINESS.phone) {
    rows.push([
      'Phone',
      <a key="phone" className="font-semibold underline" href={`tel:${BUSINESS.phone.replace(/\s+/g, '')}`}>
        {BUSINESS.phone}
      </a>,
    ])
  }

  return (
    <LegalPage title="Contact" intro={`Who runs ${TRADING_NAME} and how to reach us.`}>
      <Card className="p-0">
        <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
              <dt className="w-40 shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="text-slate-900 dark:text-slate-50">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {!BUSINESS.email && !BUSINESS.phone && (
        <Callout tone="info">
          No public contact details are set on this site yet. If you have an order, track it with
          your reference on the <Link className="font-semibold underline" to="/track">track page</Link>.
        </Callout>
      )}

      <Section title="Selling with us">
        <p>
          Want your own shop link?{' '}
          <Link className="font-semibold underline" to={registerPath}>
            Create an agent account
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  )
}
