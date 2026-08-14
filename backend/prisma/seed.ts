/**
 * Seed for acceptance testing.
 *
 * Two rules shape this file:
 *
 * 1. **The supplier catalogue is the source of cost.** `supplier_products` is
 *    the DataHub GH stand-in. Every product's `supplierCost` is copied from it
 *    rather than typed in, so when the real price list arrives the only thing
 *    that changes is where those rows come from.
 *
 * 2. **Every balance is earned, never asserted.** Balances start at zero and are
 *    moved only by seeded orders, top-ups and withdrawals, in chronological
 *    order. So `users.balance` always equals the sum of that user's ledger, and a
 *    tester who adds up the rows on screen gets the number in the corner. A
 *    hardcoded opening balance would break that on the first reconciliation
 *    question, which is exactly the kind of thing acceptance testing finds.
 *
 * Dates are relative to the run, so the last-7-days charts always have data.
 */
import { PrismaClient, type Category, type Network, type Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { splitFor, type Admin, type OrderSplit, type PricingAgent } from '../src/domain/pricing'

const prisma = new PrismaClient()

const PASSWORD = process.env.SEED_PASSWORD ?? 'demo1234'

/**
 * Trading history is opt-in.
 *
 * The default is a clean slate: the price list and the accounts, and nothing
 * else. Every balance is zero, there are no orders, and no money has moved. That
 * is what you want when the question is "does this actually work" — a first sale
 * you can watch land, against numbers you know started at nothing.
 *
 * `npm run seed:history` adds a month of generated trading instead, for when the
 * question is about charts, pagination, or a withdrawal queue with something in
 * it. The two are mutually exclusive; each run wipes and rebuilds.
 */
const WITH_HISTORY = process.argv.includes('--with-history')

// ─── Supplier catalogue (stands in for DataHub GH) ───────────────────────────

interface SupplierSeed {
  code: string
  category: Category
  network: Network | null
  name: string
  validity: string
  costPrice: number
}

const sku = (network: string | null, kind: string, size: string) =>
  `DH-${(network ?? 'GEN').toUpperCase()}-${kind.toUpperCase()}-${size.toUpperCase()}`

const dataSku = (network: Network, size: string, costPrice: number): SupplierSeed => ({
  code: sku(network, 'data', size),
  category: 'data',
  network,
  name: `${size} Data`,
  validity: 'Non-expiry',
  costPrice,
})

/** Airtime is thin-margin everywhere: nobody pays a premium for face value. */
const airtimeSku = (network: Network, cedisValue: number): SupplierSeed => ({
  code: sku(network, 'airtime', String(cedisValue)),
  category: 'airtime',
  network,
  name: `GHS ${cedisValue} Airtime`,
  validity: 'Instant top-up',
  costPrice: Math.round(cedisValue * 100 * 0.94),
})

const otherSku = (
  code: string,
  category: Category,
  network: Network | null,
  name: string,
  validity: string,
  costPrice: number,
): SupplierSeed => ({ code, category, network, name, validity, costPrice })

const SUPPLIER_CATALOGUE: SupplierSeed[] = [
  dataSku('MTN', '500MB', 350),
  dataSku('MTN', '1GB', 550),
  dataSku('MTN', '2GB', 1050),
  dataSku('MTN', '3GB', 1550),
  dataSku('MTN', '5GB', 2400),
  dataSku('MTN', '10GB', 4600),
  dataSku('MTN', '20GB', 9000),
  dataSku('Telecel', '1GB', 500),
  dataSku('Telecel', '2GB', 950),
  dataSku('Telecel', '5GB', 2250),
  dataSku('Telecel', '10GB', 4400),
  dataSku('Telecel', '20GB', 8600),
  dataSku('AirtelTigo', '1GB', 470),
  dataSku('AirtelTigo', '2GB', 900),
  dataSku('AirtelTigo', '5GB', 2150),
  dataSku('AirtelTigo', '10GB', 4200),
  dataSku('AirtelTigo', '25GB', 9500),
  airtimeSku('MTN', 5),
  airtimeSku('MTN', 10),
  airtimeSku('MTN', 20),
  airtimeSku('MTN', 50),
  airtimeSku('MTN', 100),
  airtimeSku('Telecel', 10),
  airtimeSku('Telecel', 20),
  airtimeSku('Telecel', 50),
  airtimeSku('AirtelTigo', 10),
  airtimeSku('AirtelTigo', 20),
  airtimeSku('AirtelTigo', 50),
  otherSku('DH-MTN-VOICE-50', 'voice', 'MTN', '50 Minutes', '7 days', 300),
  otherSku('DH-MTN-VOICE-150', 'voice', 'MTN', '150 Minutes', '30 days', 800),
  otherSku('DH-TELECEL-VOICE-200', 'voice', 'Telecel', '200 Minutes', '30 days', 950),
  otherSku('DH-AIRTELTIGO-VOICE-400', 'voice', 'AirtelTigo', '400 Minutes', '30 days', 1900),
  otherSku('DH-MTN-SMS-100', 'sms', 'MTN', '100 SMS', '30 days', 200),
  otherSku('DH-MTN-SMS-500', 'sms', 'MTN', '500 SMS', '30 days', 850),
  otherSku('DH-TELECEL-SMS-250', 'sms', 'Telecel', '250 SMS', '30 days', 450),
  otherSku('DH-MTN-AFA-REG', 'afa', 'MTN', 'MTN AFA Registration', 'One-time', 1200),
  // Result checkers come from a voucher wholesaler, not DataHub GH.
  { ...otherSku('VW-CHECKER-BECE', 'checker', null, 'BECE Result Checker', 'Single use voucher', 1800) },
  { ...otherSku('VW-CHECKER-WASSCE', 'checker', null, 'WASSCE Result Checker', 'Single use voucher', 2500) },
]

const VOUCHER_PROVIDER = 'voucher-wholesale-gh'

// ─── Our price tiers, derived from supplier cost ─────────────────────────────

const round10 = (value: number) => Math.round(value / 10) * 10

/**
 * James takes ~8% to agents, sells to walk-up customers at ~16%, and caps retail
 * at ~45% so a deep referral chain cannot price the product out of the market.
 */
const tiers = (supplierCost: number) => ({
  supplierCost,
  adminPrice: round10(supplierCost * 1.08),
  standardPrice: round10(supplierCost * 1.16),
  maxRetailPrice: round10(supplierCost * 1.45),
})

const airtimeTiers = (supplierCost: number, faceValue: number) => ({
  supplierCost,
  adminPrice: Math.round(faceValue * 0.97),
  standardPrice: faceValue,
  maxRetailPrice: Math.round(faceValue * 1.08),
})

/** Our product id, kept identical to the frontend's mock ids so links survive. */
function productIdFor(seed: SupplierSeed): string {
  if (seed.category === 'checker') {
    return seed.code === 'VW-CHECKER-BECE' ? 'checker-bece' : 'checker-wassce'
  }
  const network = String(seed.network).toLowerCase()
  if (seed.category === 'data') {
    return `${network}-data-${seed.name.split(' ')[0].toLowerCase()}`
  }
  if (seed.category === 'airtime') {
    return `${network}-airtime-${seed.name.replace(/\D/g, '')}`
  }
  if (seed.category === 'voice') return `${network}-voice-${seed.name.replace(/\D/g, '')}`
  if (seed.category === 'sms') return `${network}-sms-${seed.name.replace(/\D/g, '')}`
  return `${network}-afa-reg`
}

// ─── People ──────────────────────────────────────────────────────────────────

interface UserSeed {
  key: string
  name: string
  phone: string
  email: string
  role: 'customer' | 'agent' | 'admin'
  referralCode: string
  uplineKey: string | null
  markupPercent: number
  status: 'active' | 'suspended'
  joinedDaysAgo: number
}

/**
 * Deliberately just two accounts: the platform owner and one agent.
 *
 * Everyone else — more agents, customers — is created by actually using the
 * product. Registering through Kwame's referral link is the only way to get a
 * second agent, which means the referral bonus gets exercised for real rather
 * than being pre-baked into the seed and assumed to work.
 */
const USERS: UserSeed[] = [
  {
    key: 'admin',
    name: 'James Owusu',
    phone: '0209876543',
    email: 'james@jamesdataconsult.com',
    role: 'admin',
    referralCode: 'JAMES01',
    uplineKey: null,
    markupPercent: 0,
    status: 'active',
    joinedDaysAgo: 105,
  },
  {
    key: 'kwame',
    name: 'Kwame Boateng',
    phone: '0551234567',
    email: 'kwame.boateng@example.com',
    role: 'agent',
    referralCode: 'KWAME77',
    uplineKey: null, // registered directly with James, so he has no referrer
    markupPercent: 8,
    status: 'active',
    joinedDaysAgo: 92,
  },
]

/**
 * Which seeded people actually exist. The history seeds below were written
 * against a fuller cast, so everything that names a person is filtered through
 * these — a trimmed USERS list quietly drops the rows that referenced someone
 * who is no longer there, instead of failing halfway through.
 */
const KNOWN = new Set(USERS.map((u) => u.key))
const AGENT_KEYS = USERS.filter((u) => u.role === 'agent').map((u) => u.key)
const CUSTOMER_KEYS = USERS.filter((u) => u.role === 'customer').map((u) => u.key)

/** FR-3.4 — prices Kwame has set explicitly, overriding his 8% default. */
const KWAME_PRICES: Record<string, number> = {
  'mtn-data-1gb': 700,
  'mtn-data-2gb': 1300,
  'mtn-data-5gb': 2900,
  'mtn-data-10gb': 5500,
  'telecel-data-1gb': 650,
  'telecel-data-5gb': 2700,
  'airteltigo-data-1gb': 600,
  'checker-bece': 2300,
  'checker-wassce': 3100,
}

// ─── Order history ───────────────────────────────────────────────────────────

interface OrderSeed {
  productId: string
  recipient: string
  /** Fails are seeded too — the refund path must have history behind it. */
  outcome: 'completed' | 'failed'
  hoursAgo: number
  sellerKey: string | null
  buyerKey: string | null
  buyerName: string
  paidWith: 'wallet' | 'momo'
}

/**
 * Spread across the last 7 days so every chart on every dashboard has something
 * to draw, with a heavier recent tail so "today" is never empty.
 */
const ORDER_SEEDS: OrderSeed[] = [
  { productId: 'mtn-data-1gb', recipient: '0244118820', outcome: 'completed', hoursAgo: 2, sellerKey: 'kwame', buyerKey: 'hawa', buyerName: 'Hawa Sulemana', paidWith: 'momo' },
  { productId: 'mtn-data-5gb', recipient: '0554470912', outcome: 'completed', hoursAgo: 4, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'checker-wassce', recipient: '0244118820', outcome: 'completed', hoursAgo: 6, sellerKey: 'kwame', buyerKey: 'hawa', buyerName: 'Hawa Sulemana', paidWith: 'momo' },
  { productId: 'telecel-data-2gb', recipient: '0201889340', outcome: 'completed', hoursAgo: 9, sellerKey: 'abena', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-airtime-20', recipient: '0244556677', outcome: 'completed', hoursAgo: 14, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-10gb', recipient: '0599102384', outcome: 'failed', hoursAgo: 20, sellerKey: 'kwame', buyerKey: null, buyerName: 'Mensah Otoo', paidWith: 'momo' },
  { productId: 'airteltigo-data-1gb', recipient: '0267741220', outcome: 'completed', hoursAgo: 26, sellerKey: 'yaw', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-2gb', recipient: '0245560093', outcome: 'completed', hoursAgo: 30, sellerKey: 'kwame', buyerKey: 'gifty', buyerName: 'Gifty Owusu', paidWith: 'momo' },
  { productId: 'checker-bece', recipient: '0553320019', outcome: 'completed', hoursAgo: 38, sellerKey: 'naa', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-1gb', recipient: '0244003311', outcome: 'completed', hoursAgo: 44, sellerKey: null, buyerKey: 'akosua', buyerName: 'Akosua Mensah', paidWith: 'wallet' },
  { productId: 'telecel-data-5gb', recipient: '0500229184', outcome: 'completed', hoursAgo: 50, sellerKey: 'abena', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-sms-100', recipient: '0244880012', outcome: 'completed', hoursAgo: 56, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-afa-reg', recipient: '0554419900', outcome: 'completed', hoursAgo: 68, sellerKey: 'efua', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-3gb', recipient: '0246612870', outcome: 'completed', hoursAgo: 74, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-voice-150', recipient: '0244771203', outcome: 'completed', hoursAgo: 80, sellerKey: null, buyerKey: null, buyerName: 'Selorm Agbo', paidWith: 'momo' },
  { productId: 'airteltigo-data-5gb', recipient: '0561120044', outcome: 'completed', hoursAgo: 92, sellerKey: 'kofi', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-20gb', recipient: '0244009911', outcome: 'completed', hoursAgo: 98, sellerKey: 'kwame', buyerKey: 'gifty', buyerName: 'Gifty Owusu', paidWith: 'momo' },
  { productId: 'telecel-data-1gb', recipient: '0207788112', outcome: 'completed', hoursAgo: 104, sellerKey: 'adjoa', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-500mb', recipient: '0553301188', outcome: 'completed', hoursAgo: 112, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-airtime-50', recipient: '0244660077', outcome: 'completed', hoursAgo: 122, sellerKey: 'ibrahim', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-5gb', recipient: '0599887711', outcome: 'completed', hoursAgo: 130, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'checker-bece', recipient: '0246003399', outcome: 'completed', hoursAgo: 140, sellerKey: 'abena', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'telecel-data-10gb', recipient: '0501144778', outcome: 'completed', hoursAgo: 146, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'mtn-data-2gb', recipient: '0244221100', outcome: 'completed', hoursAgo: 152, sellerKey: null, buyerKey: 'akosua', buyerName: 'Akosua Mensah', paidWith: 'wallet' },
  { productId: 'mtn-data-1gb', recipient: '0553399002', outcome: 'completed', hoursAgo: 158, sellerKey: 'yaw', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
  { productId: 'airteltigo-data-2gb', recipient: '0267799001', outcome: 'completed', hoursAgo: 164, sellerKey: 'kwame', buyerKey: null, buyerName: 'Guest', paidWith: 'momo' },
]

// ─── Generated backlog ───────────────────────────────────────────────────────

/**
 * A month of trading behind the hand-written recent orders.
 *
 * Without it every agent's balance is a couple of cedis, which fails acceptance
 * testing for a boring reason: the withdrawal minimum is GHS 10, so nobody can
 * exercise the payout flow. A real reseller has hundreds of orders behind them,
 * and the numbers on every dashboard only look right at that volume.
 *
 * Deterministic — a fixed-seed LCG rather than Math.random — so re-seeding gives
 * byte-identical data. A tester who reports "Kwame's earnings are wrong" must be
 * looking at the same database the next person reproduces it against.
 */
let rngState = 20260814

function rnd(): number {
  rngState = (rngState * 1_664_525 + 1_013_904_223) % 4_294_967_296
  return rngState / 4_294_967_296
}

const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]

function generateBacklog(): OrderSeed[] {
  // Weighted towards the cheaper bundles, which is what actually sells.
  const catalogue: string[] = [
    ...Array(9).fill('mtn-data-1gb'),
    ...Array(7).fill('mtn-data-500mb'),
    ...Array(6).fill('mtn-data-2gb'),
    ...Array(4).fill('mtn-data-5gb'),
    ...Array(2).fill('mtn-data-10gb'),
    'mtn-data-3gb',
    'mtn-data-20gb',
    ...Array(5).fill('telecel-data-1gb'),
    ...Array(3).fill('telecel-data-2gb'),
    ...Array(2).fill('telecel-data-5gb'),
    'telecel-data-10gb',
    ...Array(4).fill('airteltigo-data-1gb'),
    ...Array(2).fill('airteltigo-data-2gb'),
    'airteltigo-data-5gb',
    ...Array(4).fill('mtn-airtime-5'),
    ...Array(3).fill('mtn-airtime-10'),
    ...Array(3).fill('mtn-airtime-20'),
    'mtn-airtime-50',
    'telecel-airtime-10',
    'airteltigo-airtime-20',
    ...Array(2).fill('mtn-sms-100'),
    'mtn-voice-50',
    'mtn-afa-reg',
    ...Array(2).fill('checker-bece'),
    'checker-wassce',
  ]

  // Sellers come from the seeded agents, whoever they are, plus a couple of
  // walk-up sales with no sell link at all (FR-3.5). Written this way so
  // trimming USERS does not leave the backlog pointing at nobody.
  const sellers: (string | null)[] = [
    ...AGENT_KEYS.flatMap((key) => Array(8).fill(key) as (string | null)[]),
    null,
    null,
  ]

  const names = [
    'Guest', 'Guest', 'Guest', 'Guest',
    'Ama Serwaa', 'Kojo Mensah', 'Fatima Abdul', 'Nii Armah', 'Esi Bonsu',
    'Yaw Owusu', 'Adwoa Baah', 'Musah Ali', 'Akua Donkor', 'Kweku Annan',
  ]

  const prefixes = ['024', '054', '055', '059', '020', '050', '026', '027']

  const orders: OrderSeed[] = []

  // Days 3–31 back. The hand-written seeds cover the last ~7 days in detail.
  for (let day = 3; day <= 31; day++) {
    // Weekends are busier; a flat rate makes the chart look synthetic.
    const weekday = new Date(now - day * 86_400_000).getUTCDay()
    const base = weekday === 0 || weekday === 6 ? 9 : 6
    const count = base + Math.floor(rnd() * 5)

    for (let n = 0; n < count; n++) {
      const recipient = `${pick(prefixes)}${Math.floor(1_000_000 + rnd() * 8_999_999)}`
      // About 1 in 40 fails at the provider — roughly what a real network does,
      // and enough that the refund ledger has history without dominating it.
      const failed = rnd() < 0.025

      orders.push({
        productId: pick(catalogue),
        recipient,
        outcome: failed ? 'failed' : 'completed',
        hoursAgo: day * 24 + Math.floor(rnd() * 24),
        sellerKey: pick(sellers),
        buyerKey: null,
        buyerName: pick(names),
        // Everything here is Mobile Money: a wallet purchase would need a
        // matching top-up before it to keep the running balance non-negative,
        // and the hand-written seeds already cover the wallet path.
        paidWith: 'momo',
      })
    }
  }

  return orders
}

// ─── Runner ──────────────────────────────────────────────────────────────────

const now = Date.now()
const hoursAgo = (h: number) => new Date(now - h * 3_600_000)
const daysAgo = (d: number) => new Date(now - d * 86_400_000)

/** Running balances, so every ledger row carries a truthful `balanceAfter`. */
const balances = new Map<string, number>()
const bump = (userId: string, delta: number): number => {
  const next = (balances.get(userId) ?? 0) + delta
  if (next < 0) {
    throw new Error(
      `seed would drive ${userId} to a negative balance (${next}p) — reorder the seed rather than relaxing the constraint`,
    )
  }
  balances.set(userId, next)
  return next
}

async function main(): Promise<void> {
  console.log('seeding…')

  await wipe()

  // 1 — the provider's catalogue.
  for (const seed of SUPPLIER_CATALOGUE) {
    await prisma.supplierProduct.create({
      data: {
        code: seed.code,
        provider: seed.category === 'checker' ? VOUCHER_PROVIDER : 'datahub-gh',
        category: seed.category,
        network: seed.network,
        name: seed.name,
        validity: seed.validity,
        costPrice: seed.costPrice,
        available: true,
      },
    })
  }
  console.log(`  ${SUPPLIER_CATALOGUE.length} supplier SKUs`)

  // 2 — our catalogue, priced from theirs.
  for (const seed of SUPPLIER_CATALOGUE) {
    const id = productIdFor(seed)
    const faceValue = seed.category === 'airtime' ? Number(seed.name.replace(/\D/g, '')) * 100 : 0

    await prisma.product.create({
      data: {
        id,
        category: seed.category,
        network: seed.network,
        name: seed.name,
        validity: seed.validity,
        supplierCode: seed.code,
        ...(seed.category === 'airtime'
          ? airtimeTiers(seed.costPrice, faceValue)
          : tiers(seed.costPrice)),
        active: true,
      },
    })
  }
  console.log(`  ${SUPPLIER_CATALOGUE.length} products`)

  // 3 — people. Everyone shares one password so testers are not blocked on it.
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const ids = new Map<string, string>()

  for (const seed of USERS) {
    const user = await prisma.user.create({
      data: {
        name: seed.name,
        phone: seed.phone,
        email: seed.email,
        passwordHash,
        role: seed.role,
        status: seed.status,
        referralCode: seed.referralCode,
        uplineCode: seed.uplineKey
          ? (USERS.find((u) => u.key === seed.uplineKey)?.referralCode ?? null)
          : null,
        markupPercent: seed.markupPercent,
        balance: 0,
        joinedAt: daysAgo(seed.joinedDaysAgo),
      },
    })
    ids.set(seed.key, user.id)
    balances.set(user.id, 0)
  }
  console.log(`  ${USERS.length} users (password: ${PASSWORD})`)

  // 4 — Kwame's explicit prices.
  const kwameId = ids.get('kwame')!
  for (const [productId, resalePrice] of Object.entries(KWAME_PRICES)) {
    await prisma.agentPrice.create({ data: { userId: kwameId, productId, resalePrice } })
  }

  // 5 — platform switches.
  await prisma.setting.createMany({
    data: [
      { key: 'referralEnabled', value: true },
      { key: 'referralRatePercent', value: 25 },
      { key: 'simulateFailure', value: false },
      { key: 'registrationOpen', value: true },
    ],
  })

  // 6 — the pricing chain, read back exactly as the API will read it.
  const agents = await loadAgents()
  const admin = await loadAdmin()

  if (WITH_HISTORY) {
    // 7 — top the customers up before they spend, so no purchase ever lands the
    // running balance below zero.
    await seedTopUps(ids)

    // 8 — order history, oldest first, with every ledger consequence applied.
    await seedOrders(ids, agents, admin)

    // 9 — withdrawals, sized against what each agent actually earned.
    await seedWithdrawals(ids)

    // 10 — write the accumulated balances onto the user rows.
    for (const [userId, balance] of balances) {
      await prisma.user.update({ where: { id: userId }, data: { balance } })
    }
  } else {
    console.log('  no orders, no balances — clean slate')
  }

  await report()
}

/** Idempotent re-seed: clear children before parents. */
async function wipe(): Promise<void> {
  await prisma.supplierDispatch.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.earning.deleteMany()
  await prisma.withdrawal.deleteMany()
  await prisma.claimableCredit.deleteMany()
  await prisma.order.deleteMany()
  await prisma.agentPrice.deleteMany()
  await prisma.product.deleteMany()
  await prisma.supplierProduct.deleteMany()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany()
}

async function loadAgents(): Promise<PricingAgent[]> {
  const rows = await prisma.user.findMany({
    where: { role: 'agent' },
    select: {
      id: true,
      name: true,
      referralCode: true,
      uplineCode: true,
      markupPercent: true,
      prices: { select: { productId: true, resalePrice: true } },
    },
  })
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    referralCode: r.referralCode,
    uplineCode: r.uplineCode,
    markupPercent: r.markupPercent,
    prices: r.prices,
  }))
}

async function loadAdmin(): Promise<Admin> {
  const row = await prisma.user.findFirstOrThrow({
    where: { role: 'admin' },
    select: { id: true, name: true },
  })
  return { userId: row.id, name: row.name }
}

/**
 * FR-2.2 history. Sized to cover every wallet purchase in ORDER_SEEDS with room
 * left over, so the customer can still buy something during testing.
 */
async function seedTopUps(ids: Map<string, string>): Promise<void> {
  const topUps: { key: string; amount: number; hoursAgo: number; network: string }[] = [
    { key: 'akosua', amount: 5000, hoursAgo: 170, network: 'MTN MoMo' },
    { key: 'akosua', amount: 2000, hoursAgo: 60, network: 'MTN MoMo' },
    { key: 'gifty', amount: 3000, hoursAgo: 120, network: 'Telecel Cash' },
    { key: 'hawa', amount: 1500, hoursAgo: 48, network: 'MTN MoMo' },
  ]

  for (const topUp of topUps.filter((t) => CUSTOMER_KEYS.includes(t.key))) {
    const userId = ids.get(topUp.key)!
    const balanceAfter = bump(userId, topUp.amount)
    await prisma.transaction.create({
      data: {
        userId,
        type: 'topup',
        amount: topUp.amount,
        balanceAfter,
        description: `Wallet top-up · ${topUp.network}`,
        reference: `PSK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        createdAt: hoursAgo(topUp.hoursAgo),
      },
    })
  }
}

async function seedOrders(
  ids: Map<string, string>,
  agents: PricingAgent[],
  admin: Admin,
): Promise<void> {
  // Oldest first: a ledger only makes sense written forwards.
  const ordered = [...generateBacklog(), ...ORDER_SEEDS]
    // Drop anything naming a person the trimmed USERS list no longer contains.
    .filter((o) => (o.sellerKey === null || KNOWN.has(o.sellerKey)) &&
                   (o.buyerKey === null || KNOWN.has(o.buyerKey)))
    .sort((a, b) => b.hoursAgo - a.hoursAgo)
  let sequence = 0

  // Cache products — the backlog reuses the same few dozen ids hundreds of times.
  const productCache = new Map<string, Awaited<ReturnType<typeof prisma.product.findUniqueOrThrow>>>()

  for (const seed of ordered) {
    let product = productCache.get(seed.productId)
    if (!product) {
      product = await prisma.product.findUniqueOrThrow({ where: { id: seed.productId } })
      productCache.set(seed.productId, product)
    }

    const sellerCode = seed.sellerKey
      ? (USERS.find((u) => u.key === seed.sellerKey)?.referralCode ?? null)
      : null

    const split = splitFor(product, sellerCode, agents, admin)
    const salePrice = split.shares.find((s) => s.depth === 0)?.charged ?? product.standardPrice
    const createdAt = hoursAgo(seed.hoursAgo)
    const reference = `JDC-${(884_120 + sequence * 37).toString()}`
    const buyerUserId = seed.buyerKey ? ids.get(seed.buyerKey)! : null
    sequence++

    const isChecker = product.category === 'checker'
    const delivered = seed.outcome === 'completed'

    const order = await prisma.order.create({
      data: {
        reference,
        productId: product.id,
        productName: product.name,
        network: product.network,
        category: product.category,
        recipient: seed.recipient,
        salePrice,
        split: split as unknown as Prisma.InputJsonValue,
        soldByCode: sellerCode,
        status: delivered ? 'completed' : 'failed',
        paidWith: seed.paidWith,
        buyer: seed.buyerName,
        buyerPhone: seed.recipient,
        buyerUserId,
        refunded: !delivered,
        createdAt,
        completedAt: delivered ? new Date(createdAt.getTime() + 4000) : null,
        ...(delivered && isChecker ? voucherFor(reference) : {}),
      },
    })

    // The provider call that produced this outcome.
    if (product.supplierCode) {
      await prisma.supplierDispatch.create({
        data: {
          orderId: order.id,
          orderRef: reference,
          supplierCode: product.supplierCode,
          recipient: seed.recipient,
          costPrice: product.supplierCost,
          outcome: delivered ? 'delivered' : 'rejected',
          reason: delivered ? null : 'Network rejected the transfer after two attempts.',
          simulated: true,
          attempt: delivered ? 1 : 2,
          createdAt: new Date(createdAt.getTime() + 3000),
        },
      })
    }

    // A wallet purchase debits as the order is created, pass or fail.
    if (seed.paidWith === 'wallet' && buyerUserId) {
      const after = bump(buyerUserId, -salePrice)
      await prisma.transaction.create({
        data: {
          userId: buyerUserId,
          type: 'purchase',
          amount: -salePrice,
          balanceAfter: after,
          description: `${product.name} → ${seed.recipient}`,
          reference,
          createdAt,
        },
      })
    }

    const agentShares = split.shares.filter((s) => s.role === 'agent' && s.margin > 0)

    // Credit the chain. Every participant, not just the seller — that is what
    // makes an upline's downline earnings appear.
    for (const share of agentShares) {
      const after = bump(share.userId, share.margin)
      await prisma.earning.create({
        data: {
          userId: share.userId,
          type: share.depth === 0 ? 'sale' : 'downline',
          amount: share.margin,
          balanceAfter: after,
          description:
            share.depth === 0
              ? `Your sale · ${product.name} → ${seed.recipient}`
              : `Downline sale · ${product.name}`,
          productName: product.name,
          reference,
          depth: share.depth,
          createdAt: new Date(createdAt.getTime() + 5000),
        },
      })
    }

    if (delivered) continue

    // ── The failure path, in full. ──
    const reversedAt = new Date(createdAt.getTime() + 8000)

    for (const share of agentShares) {
      const after = bump(share.userId, -share.margin)
      await prisma.earning.create({
        data: {
          userId: share.userId,
          type: 'reversal',
          amount: -share.margin,
          balanceAfter: after,
          description: `Reversed · ${product.name} failed at provider`,
          productName: product.name,
          reference,
          depth: share.depth,
          createdAt: reversedAt,
        },
      })
    }

    if (seed.paidWith === 'wallet' && buyerUserId) {
      const after = bump(buyerUserId, salePrice)
      await prisma.transaction.create({
        data: {
          userId: buyerUserId,
          type: 'refund',
          amount: salePrice,
          balanceAfter: after,
          description: `Refund · ${product.name} failed at provider`,
          reference,
          createdAt: reversedAt,
        },
      })
    } else {
      // NFR-3.3 — a Mobile Money payer has no wallet, so the money is held
      // against their number and claimable.
      await prisma.claimableCredit.create({
        data: {
          phone: seed.recipient,
          amount: salePrice,
          reference,
          claimed: false,
          createdAt: reversedAt,
        },
      })
    }
  }

  console.log(`  ${ordered.length} orders with full ledger history`)
}

/**
 * FR-2.6 history, sized against real balances.
 *
 * A pending or approved request has already been deducted, so each amount is
 * capped at a share of what the agent actually holds — otherwise the seed would
 * hit `CHECK (balance >= 0)`, which would be the constraint doing its job.
 */
async function seedWithdrawals(ids: Map<string, string>): Promise<void> {
  const plan: { key: string; fraction: number; network: Network; status: 'pending' | 'approved' | 'rejected'; hoursAgo: number }[] = [
    { key: 'kwame', fraction: 0.4, network: 'MTN', status: 'approved', hoursAgo: 96 },
    { key: 'abena', fraction: 0.5, network: 'MTN', status: 'pending', hoursAgo: 30 },
    { key: 'efua', fraction: 0.6, network: 'Telecel', status: 'pending', hoursAgo: 12 },
    { key: 'yaw', fraction: 0.35, network: 'MTN', status: 'approved', hoursAgo: 70 },
    { key: 'kofi', fraction: 0.8, network: 'AirtelTigo', status: 'rejected', hoursAgo: 140 },
  ]

  let created = 0

  for (const entry of plan.filter((e) => AGENT_KEYS.includes(e.key))) {
    const userId = ids.get(entry.key)!
    const seedUser = USERS.find((u) => u.key === entry.key)!
    const available = balances.get(userId) ?? 0

    // Round down to whole cedis; skip anyone who has not cleared the minimum.
    const amount = Math.floor((available * entry.fraction) / 100) * 100
    if (amount < 1000) continue

    const requestedAt = hoursAgo(entry.hoursAgo)

    const row = await prisma.withdrawal.create({
      data: {
        userId,
        agentName: seedUser.name,
        agentPhone: seedUser.phone,
        amount,
        momoNetwork: entry.network,
        status: entry.status,
        requestedAt,
        decidedAt: entry.status === 'pending' ? null : new Date(requestedAt.getTime() + 3_600_000),
      },
    })

    const reference = `WDR-${row.id.slice(0, 8).toUpperCase()}`

    // Held at request time, whatever the eventual decision.
    const afterHold = bump(userId, -amount)
    await prisma.earning.create({
      data: {
        userId,
        type: 'withdrawal',
        amount: -amount,
        balanceAfter: afterHold,
        description: `Withdrawal requested · ${entry.network} ${seedUser.phone}`,
        reference,
        depth: 0,
        createdAt: requestedAt,
      },
    })

    // A rejection releases the hold.
    if (entry.status === 'rejected') {
      const afterRelease = bump(userId, amount)
      await prisma.earning.create({
        data: {
          userId,
          type: 'withdrawal',
          amount,
          balanceAfter: afterRelease,
          description: 'Withdrawal rejected — amount returned to your balance',
          reference: `${reference}-R`,
          depth: 0,
          createdAt: new Date(requestedAt.getTime() + 3_600_000),
        },
      })
    }

    created++
  }

  console.log(`  ${created} withdrawal requests`)
}

function voucherFor(reference: string): { voucherSerial: string; voucherPin: string } {
  let hash = 0
  for (const char of reference) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return {
    voucherSerial: `WA${(hash % 90_000_000 + 10_000_000).toString()}`,
    voucherPin: ((hash * 2_654_435_761) % 9_000_000_000 + 1_000_000_000).toString(),
  }
}

/**
 * Prove the ledgers reconcile before declaring success. A seed that quietly
 * disagrees with itself is worse than no seed, because every later number
 * inherits the error.
 */
async function report(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, phone: true, email: true, balance: true },
    orderBy: { joinedAt: 'asc' },
  })

  let mismatches = 0

  for (const user of users) {
    const [tx, earn] = await Promise.all([
      prisma.transaction.aggregate({ where: { userId: user.id }, _sum: { amount: true } }),
      prisma.earning.aggregate({ where: { userId: user.id }, _sum: { amount: true } }),
    ])
    const ledger = (tx._sum.amount ?? 0) + (earn._sum.amount ?? 0)
    if (ledger !== user.balance) {
      console.error(
        `  ✗ ${user.name}: balance ${user.balance}p but ledger sums to ${ledger}p`,
      )
      mismatches++
    }
  }

  const [orders, credits] = await Promise.all([
    prisma.order.count(),
    prisma.claimableCredit.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
  ])

  console.log('')
  console.log('  ── sign in with any of these · password: ' + PASSWORD + ' ──')
  for (const user of users) {
    console.log(
      `  ${user.email.padEnd(30)} ${user.role.padEnd(8)} ${user.name.padEnd(16)} GHS ${(user.balance / 100).toFixed(2)}`,
    )
  }

  console.log('')
  console.log(`  orders: ${orders}`)
  console.log(
    `  unclaimed credits: ${credits._count._all} worth GHS ${((credits._sum.amount ?? 0) / 100).toFixed(2)}`,
  )
  console.log(
    mismatches === 0
      ? '  ✓ every balance reconciles against its ledger'
      : `  ✗ ${mismatches} balance(s) do not reconcile`,
  )

  if (!WITH_HISTORY) {
    console.log('')
    console.log('  Clean slate. Buy something through /s/KWAME77 and watch Kwame earn.')
    console.log('  Want a month of history instead?  npm run seed:history')
  }

  if (mismatches > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
