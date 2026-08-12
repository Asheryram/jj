import type {
  AgentPrice,
  Earning,
  Order,
  OrderStatus,
  PlatformUser,
  Product,
  Session,
  SubAgent,
  Transaction,
  WithdrawalRequest,
} from './types'
import { splitFor, type Admin, type PricingAgent } from '../lib/pricing'

/**
 * Demo data only. Every value here is replaced by the NestJS API during
 * integration — the shapes are deliberately the shapes the API will return.
 */

// ─── Price tiers ────────────────────────────────────────────────────────────

const round10 = (value: number) => Math.round(value / 10) * 10

/**
 * Seeded from one supplier cost. James takes ~8% to agents, sells to walk-up
 * customers at ~16%, and caps retail at ~45% so a deep referral chain cannot
 * price the product out of the market.
 */
const tiers = (supplierCost: number) => ({
  supplierCost,
  adminPrice: round10(supplierCost * 1.08),
  standardPrice: round10(supplierCost * 1.16),
  maxRetailPrice: round10(supplierCost * 1.45),
})

const dataBundle = (
  network: Product['network'],
  size: string,
  supplierCost: number,
): Product => ({
  id: `${String(network).toLowerCase()}-data-${size.toLowerCase()}`,
  category: 'data',
  network,
  name: `${size} Data`,
  validity: 'Non-expiry',
  ...tiers(supplierCost),
  active: true,
})

const airtime = (network: Product['network'], cedisValue: number): Product => {
  // Airtime is thin-margin everywhere: nobody pays a big premium for face value.
  const supplierCost = Math.round(cedisValue * 100 * 0.94)
  return {
    id: `${String(network).toLowerCase()}-airtime-${cedisValue}`,
    category: 'airtime',
    network,
    name: `GHS ${cedisValue} Airtime`,
    validity: 'Instant top-up',
    supplierCost,
    adminPrice: Math.round(cedisValue * 100 * 0.97),
    standardPrice: cedisValue * 100,
    maxRetailPrice: Math.round(cedisValue * 100 * 1.08),
    active: true,
  }
}

const simple = (
  id: string,
  category: Product['category'],
  network: Product['network'],
  name: string,
  validity: string,
  supplierCost: number,
): Product => ({
  id,
  category,
  network,
  name,
  validity,
  ...tiers(supplierCost),
  active: true,
})

export const products: Product[] = [
  dataBundle('MTN', '500MB', 350),
  dataBundle('MTN', '1GB', 550),
  dataBundle('MTN', '2GB', 1050),
  dataBundle('MTN', '3GB', 1550),
  dataBundle('MTN', '5GB', 2400),
  dataBundle('MTN', '10GB', 4600),
  dataBundle('MTN', '20GB', 9000),
  dataBundle('Telecel', '1GB', 500),
  dataBundle('Telecel', '2GB', 950),
  dataBundle('Telecel', '5GB', 2250),
  dataBundle('Telecel', '10GB', 4400),
  dataBundle('Telecel', '20GB', 8600),
  dataBundle('AirtelTigo', '1GB', 470),
  dataBundle('AirtelTigo', '2GB', 900),
  dataBundle('AirtelTigo', '5GB', 2150),
  dataBundle('AirtelTigo', '10GB', 4200),
  dataBundle('AirtelTigo', '25GB', 9500),
  airtime('MTN', 5),
  airtime('MTN', 10),
  airtime('MTN', 20),
  airtime('MTN', 50),
  airtime('MTN', 100),
  airtime('Telecel', 10),
  airtime('Telecel', 20),
  airtime('Telecel', 50),
  airtime('AirtelTigo', 10),
  airtime('AirtelTigo', 20),
  airtime('AirtelTigo', 50),
  simple('mtn-voice-50', 'voice', 'MTN', '50 Minutes', '7 days', 300),
  simple('mtn-voice-150', 'voice', 'MTN', '150 Minutes', '30 days', 800),
  simple('telecel-voice-200', 'voice', 'Telecel', '200 Minutes', '30 days', 950),
  simple('airteltigo-voice-400', 'voice', 'AirtelTigo', '400 Minutes', '30 days', 1900),
  simple('mtn-sms-100', 'sms', 'MTN', '100 SMS', '30 days', 200),
  simple('mtn-sms-500', 'sms', 'MTN', '500 SMS', '30 days', 850),
  simple('telecel-sms-250', 'sms', 'Telecel', '250 SMS', '30 days', 450),
  simple('mtn-afa-reg', 'afa', 'MTN', 'MTN AFA Registration', 'One-time', 1200),
  simple('checker-bece', 'checker', null, 'BECE Result Checker', 'Single use voucher', 1800),
  simple('checker-wassce', 'checker', null, 'WASSCE Result Checker', 'Single use voucher', 2500),
]

export const productById = (id: string) => products.find((p) => p.id === id)

// ─── People ─────────────────────────────────────────────────────────────────

export const admin: Admin = { userId: 'u-admin-01', name: 'James Owusu' }

export const sessions: Record<Session['role'], Session> = {
  customer: {
    id: 'u-cust-01',
    name: 'Akosua Mensah',
    phone: '0244012345',
    email: 'akosua.mensah@example.com',
    role: 'customer',
    referralCode: 'AKOSUA24',
    uplineCode: null,
  },
  agent: {
    id: 'u-agent-01',
    name: 'Kwame Boateng',
    phone: '0551234567',
    email: 'kwame.boateng@example.com',
    role: 'agent',
    referralCode: 'KWAME77',
    // Directly under James, so his cost is James's agent price.
    uplineCode: null,
  },
  admin: {
    id: 'u-admin-01',
    name: 'James Owusu',
    phone: '0209876543',
    email: 'james@jamesdataconsult.com',
    role: 'admin',
    referralCode: 'JAMES01',
    uplineCode: null,
  },
}

/** FR-3.4 / FR-6.2 — prices Kwame has set for himself. */
export const agentPrices: AgentPrice[] = [
  { productId: 'mtn-data-1gb', resalePrice: 700 },
  { productId: 'mtn-data-2gb', resalePrice: 1300 },
  { productId: 'mtn-data-5gb', resalePrice: 2900 },
  { productId: 'mtn-data-10gb', resalePrice: 5500 },
  { productId: 'telecel-data-1gb', resalePrice: 650 },
  { productId: 'telecel-data-5gb', resalePrice: 2700 },
  { productId: 'airteltigo-data-1gb', resalePrice: 600 },
  { productId: 'checker-bece', resalePrice: 2300 },
  { productId: 'checker-wassce', resalePrice: 3100 },
]

/**
 * FR-5.2 — Kwame's downline. Naa Adjei sits under Abena rather than Kwame, so
 * the chain is three deep and the multi-level toggle has something real to show.
 */
export const subAgents: SubAgent[] = [
  {
    id: 'u-agent-02',
    name: 'Abena Nyarko',
    phone: '0244887711',
    referralCode: 'ABENA20',
    uplineCode: 'KWAME77',
    joinedAt: '2026-07-02',
    orders: 142,
    volume: 184300,
    earnedForUpline: 28400,
    markupPercent: 7,
    status: 'active',
  },
  {
    id: 'u-agent-03',
    name: 'Yaw Danso',
    phone: '0553019284',
    referralCode: 'YAWD31',
    uplineCode: 'KWAME77',
    joinedAt: '2026-07-11',
    orders: 96,
    volume: 121450,
    earnedForUpline: 19200,
    markupPercent: 9,
    status: 'active',
  },
  {
    id: 'u-agent-04',
    name: 'Efua Sarpong',
    phone: '0201773900',
    referralCode: 'EFUA55',
    uplineCode: 'KWAME77',
    joinedAt: '2026-07-19',
    orders: 64,
    volume: 78200,
    earnedForUpline: 12800,
    markupPercent: 6,
    status: 'active',
  },
  {
    id: 'u-agent-05',
    name: 'Kofi Asante',
    phone: '0267740012',
    referralCode: 'KOFI08',
    uplineCode: 'KWAME77',
    joinedAt: '2026-07-24',
    orders: 38,
    volume: 44900,
    earnedForUpline: 7100,
    markupPercent: 10,
    status: 'active',
  },
  {
    id: 'u-agent-06',
    name: 'Adjoa Frimpong',
    phone: '0599220184',
    referralCode: 'ADJOA9',
    uplineCode: 'KWAME77',
    joinedAt: '2026-08-01',
    orders: 21,
    volume: 26750,
    earnedForUpline: 4200,
    markupPercent: 8,
    status: 'active',
  },
  {
    id: 'u-agent-07',
    name: 'Ibrahim Musah',
    phone: '0556612003',
    referralCode: 'IBRA44',
    uplineCode: 'KWAME77',
    joinedAt: '2026-08-06',
    orders: 9,
    volume: 11200,
    earnedForUpline: 1750,
    markupPercent: 7,
    status: 'active',
  },
  {
    id: 'u-agent-08',
    name: 'Naa Adjei',
    phone: '0244550098',
    referralCode: 'NAAA12',
    // Three levels deep: James → Kwame → Abena → Naa.
    uplineCode: 'ABENA20',
    joinedAt: '2026-08-09',
    orders: 2,
    volume: 2400,
    earnedForUpline: 380,
    markupPercent: 6,
    status: 'suspended',
  },
]

/** The agent list the pricing chain is resolved against. */
export const pricingAgents: PricingAgent[] = [
  {
    userId: sessions.agent.id,
    name: sessions.agent.name,
    referralCode: sessions.agent.referralCode,
    uplineCode: null,
    prices: agentPrices,
    markupPercent: 8,
  },
  ...subAgents.map((agent) => ({
    userId: agent.id,
    name: agent.name,
    referralCode: agent.referralCode,
    uplineCode: agent.uplineCode,
    markupPercent: agent.markupPercent,
  })),
]

// ─── Orders ─────────────────────────────────────────────────────────────────

type OrderSeed = [
  productId: string,
  recipient: string,
  status: OrderStatus,
  createdAt: string,
  soldByCode: string | null,
  buyer: string,
  paidWith: Order['paidWith'],
]

const orderSeeds: OrderSeed[] = [
  ['mtn-data-1gb', '0244118820', 'completed', '2026-08-12T09:14:00', 'KWAME77', 'Hawa Sulemana', 'momo'],
  ['mtn-data-5gb', '0554470912', 'processing', '2026-08-12T08:52:00', 'KWAME77', 'Guest', 'momo'],
  ['checker-wassce', '0244118820', 'completed', '2026-08-12T08:05:00', 'KWAME77', 'Hawa Sulemana', 'wallet'],
  ['telecel-data-2gb', '0201889340', 'completed', '2026-08-11T19:40:00', 'ABENA20', 'Guest', 'momo'],
  ['mtn-airtime-20', '0244556677', 'completed', '2026-08-11T17:22:00', 'KWAME77', 'Guest', 'momo'],
  ['mtn-data-10gb', '0599102384', 'failed', '2026-08-11T15:11:00', 'KWAME77', 'Mensah Otoo', 'wallet'],
  ['airteltigo-data-1gb', '0267741220', 'completed', '2026-08-11T12:48:00', 'YAWD31', 'Guest', 'momo'],
  ['mtn-data-2gb', '0245560093', 'completed', '2026-08-11T10:30:00', 'KWAME77', 'Gifty Owusu', 'wallet'],
  ['checker-bece', '0553320019', 'completed', '2026-08-10T20:15:00', 'NAAA12', 'Guest', 'momo'],
  ['mtn-data-1gb', '0244003311', 'completed', '2026-08-10T16:02:00', null, 'Akosua Mensah', 'wallet'],
  ['telecel-data-5gb', '0500229184', 'completed', '2026-08-10T14:20:00', 'ABENA20', 'Guest', 'momo'],
  ['mtn-sms-100', '0244880012', 'completed', '2026-08-10T11:05:00', 'KWAME77', 'Guest', 'momo'],
  ['mtn-afa-reg', '0554419900', 'completed', '2026-08-09T18:44:00', 'EFUA55', 'Guest', 'momo'],
  ['mtn-data-3gb', '0246612870', 'completed', '2026-08-09T15:30:00', 'KWAME77', 'Guest', 'momo'],
  ['mtn-voice-150', '0244771203', 'completed', '2026-08-09T09:18:00', null, 'Selorm Agbo', 'momo'],
  ['airteltigo-data-5gb', '0561120044', 'completed', '2026-08-08T21:02:00', 'KOFI08', 'Guest', 'momo'],
  ['mtn-data-20gb', '0244009911', 'completed', '2026-08-08T13:40:00', 'KWAME77', 'Gifty Owusu', 'wallet'],
  ['telecel-data-1gb', '0207788112', 'completed', '2026-08-08T10:26:00', 'ADJOA9', 'Guest', 'momo'],
  ['mtn-data-500mb', '0553301188', 'completed', '2026-08-07T19:55:00', 'KWAME77', 'Guest', 'momo'],
  ['mtn-airtime-50', '0244660077', 'completed', '2026-08-07T16:12:00', 'IBRA44', 'Guest', 'momo'],
  ['mtn-data-5gb', '0599887711', 'completed', '2026-08-07T11:38:00', 'KWAME77', 'Guest', 'momo'],
  ['checker-bece', '0246003399', 'completed', '2026-08-06T20:09:00', 'ABENA20', 'Guest', 'momo'],
  ['telecel-data-10gb', '0501144778', 'completed', '2026-08-06T15:47:00', 'KWAME77', 'Guest', 'momo'],
  ['mtn-data-2gb', '0244221100', 'completed', '2026-08-06T09:31:00', null, 'Akosua Mensah', 'wallet'],
  ['mtn-data-1gb', '0553399002', 'completed', '2026-08-05T18:20:00', 'YAWD31', 'Guest', 'momo'],
  ['airteltigo-data-2gb', '0267799001', 'completed', '2026-08-05T12:04:00', 'KWAME77', 'Guest', 'momo'],
]

const voucherFor = (i: number) => ({
  serial: `WA${(48210773 + i * 137).toString().padStart(8, '0')}`,
  pin: `${(102938 + i * 4471).toString().slice(0, 6)}${(71 + i).toString().slice(0, 4)}`,
})

export const orders: Order[] = orderSeeds.map(
  ([productId, recipient, status, createdAt, soldByCode, buyer, paidWith], i) => {
    const product = productById(productId)!
    const split = splitFor(product, soldByCode, pricingAgents, admin)
    // The buyer pays the bottom seller's price — the top of the chain.
    const salePrice =
      split.shares.find((share) => share.depth === 0)?.charged ?? product.standardPrice
    return {
      id: `o-${(1000 + i).toString()}`,
      reference: `JDC-${(884120 + i * 31).toString()}`,
      productId,
      productName: product.name,
      network: product.network,
      category: product.category,
      recipient,
      salePrice,
      split,
      soldByCode,
      status,
      createdAt,
      paidWith,
      buyer,
      buyerPhone: recipient,
      ...(product.category === 'checker' && status === 'completed'
        ? { voucher: voucherFor(i) }
        : {}),
      ...(status === 'failed' ? { refunded: true } : {}),
    }
  },
)

// ─── Customer wallet (FR-2.1, FR-2.4) ───────────────────────────────────────

export const customerOpeningBalance = 4250

export const customerTransactions: Transaction[] = [
  {
    id: 't-008',
    type: 'purchase',
    amount: -1300,
    balanceAfter: 4250,
    description: '2GB Data → 0244221100',
    reference: 'JDC-884833',
    createdAt: '2026-08-06T09:31:00',
  },
  {
    id: 't-007',
    type: 'topup',
    amount: 5000,
    balanceAfter: 5550,
    description: 'Wallet top-up · MTN MoMo',
    reference: 'PSK-9K2LM04A',
    createdAt: '2026-08-06T09:28:00',
  },
  {
    id: 't-006',
    type: 'purchase',
    amount: -700,
    balanceAfter: 550,
    description: '1GB Data → 0244003311',
    reference: 'JDC-884399',
    createdAt: '2026-08-10T16:02:00',
  },
  {
    id: 't-005',
    type: 'refund',
    amount: 700,
    balanceAfter: 1250,
    description: 'Refund · 1GB Data failed at provider',
    reference: 'JDC-884120',
    createdAt: '2026-08-04T11:20:00',
  },
  {
    id: 't-004',
    type: 'purchase',
    amount: -700,
    balanceAfter: 550,
    description: '1GB Data → 0244012345',
    reference: 'JDC-884120',
    createdAt: '2026-08-04T11:18:00',
  },
  {
    id: 't-003',
    type: 'topup',
    amount: 1000,
    balanceAfter: 1250,
    description: 'Wallet top-up · MTN MoMo',
    reference: 'PSK-7H4XQ91B',
    createdAt: '2026-08-04T11:15:00',
  },
]

// ─── Agent earnings (split-at-sale) ─────────────────────────────────────────

export const agentOpeningBalance = 31480

export const agentEarnings: Earning[] = [
  {
    id: 'e-021',
    type: 'sale',
    amount: 200,
    balanceAfter: 31480,
    description: 'Your sale · 1GB Data → 0244118820',
    productName: '1GB Data',
    reference: 'JDC-884120',
    depth: 0,
    createdAt: '2026-08-12T09:14:00',
  },
  {
    id: 'e-020',
    type: 'sale',
    amount: 300,
    balanceAfter: 31280,
    description: 'Your sale · WASSCE Result Checker → 0244118820',
    productName: 'WASSCE Result Checker',
    reference: 'JDC-884182',
    depth: 0,
    createdAt: '2026-08-12T08:05:00',
  },
  {
    id: 'e-019',
    type: 'downline',
    amount: 70,
    balanceAfter: 30980,
    description: 'Abena Nyarko sold 2GB Data',
    productName: '2GB Data',
    reference: 'JDC-884213',
    depth: 1,
    createdAt: '2026-08-11T19:40:00',
  },
  {
    id: 'e-018',
    type: 'sale',
    amount: 60,
    balanceAfter: 30910,
    description: 'Your sale · GHS 20 Airtime → 0244556677',
    productName: 'GHS 20 Airtime',
    reference: 'JDC-884275',
    depth: 0,
    createdAt: '2026-08-11T17:22:00',
  },
  {
    id: 'e-017',
    type: 'reversal',
    amount: -530,
    balanceAfter: 30850,
    description: 'Reversed · 10GB Data failed at provider',
    productName: '10GB Data',
    reference: 'JDC-884306',
    depth: 0,
    createdAt: '2026-08-11T15:14:00',
  },
  {
    id: 'e-016',
    type: 'sale',
    amount: 530,
    balanceAfter: 31380,
    description: 'Your sale · 10GB Data → 0599102384',
    productName: '10GB Data',
    reference: 'JDC-884306',
    depth: 0,
    createdAt: '2026-08-11T15:11:00',
  },
  {
    id: 'e-015',
    type: 'downline',
    amount: 45,
    balanceAfter: 30850,
    description: 'Yaw Danso sold 1GB Data',
    productName: '1GB Data',
    reference: 'JDC-884337',
    depth: 1,
    createdAt: '2026-08-11T12:48:00',
  },
  {
    id: 'e-014',
    type: 'downline',
    amount: 32,
    balanceAfter: 30805,
    description: 'Naa Adjei sold BECE Result Checker',
    productName: 'BECE Result Checker',
    reference: 'JDC-884399',
    depth: 2,
    createdAt: '2026-08-10T20:15:00',
  },
  {
    id: 'e-013',
    type: 'withdrawal',
    amount: -15000,
    balanceAfter: 30773,
    description: 'Withdrawal approved · MTN MoMo 0551234567',
    reference: 'WDR-0048',
    depth: 0,
    createdAt: '2026-08-10T09:30:00',
  },
]

// ─── Admin data ─────────────────────────────────────────────────────────────

export const platformUsers: PlatformUser[] = [
  {
    id: 'u-agent-01',
    name: 'Kwame Boateng',
    phone: '0551234567',
    email: 'kwame.boateng@example.com',
    role: 'agent',
    status: 'active',
    balance: 31480,
    orders: 412,
    referredBy: 'James Owusu',
    joinedAt: '2026-05-14',
  },
  ...subAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    phone: agent.phone,
    email: `${agent.name.split(' ')[0].toLowerCase()}@example.com`,
    role: 'agent' as const,
    status: agent.status,
    balance: agent.earnedForUpline,
    orders: agent.orders,
    referredBy:
      subAgents.find((a) => a.referralCode === agent.uplineCode)?.name ?? 'Kwame Boateng',
    joinedAt: agent.joinedAt,
  })),
  {
    id: 'u-cust-01',
    name: 'Akosua Mensah',
    phone: '0244012345',
    email: 'akosua.mensah@example.com',
    role: 'customer',
    status: 'active',
    balance: 4250,
    orders: 18,
    referredBy: null,
    joinedAt: '2026-06-21',
  },
  {
    id: 'u-cust-02',
    name: 'Mensah Otoo',
    phone: '0553311447',
    email: 'm.otoo@example.com',
    role: 'customer',
    status: 'active',
    balance: 400,
    orders: 6,
    referredBy: 'Abena Nyarko',
    joinedAt: '2026-07-08',
  },
  {
    id: 'u-cust-03',
    name: 'Gifty Owusu',
    phone: '0206677001',
    email: 'gifty.o@example.com',
    role: 'customer',
    status: 'active',
    balance: 2600,
    orders: 11,
    referredBy: null,
    joinedAt: '2026-07-15',
  },
  {
    id: 'u-cust-04',
    name: 'Selorm Agbo',
    phone: '0269911223',
    email: 'selorm.a@example.com',
    role: 'customer',
    status: 'active',
    balance: 0,
    orders: 1,
    referredBy: 'Yaw Danso',
    joinedAt: '2026-08-04',
  },
  {
    id: 'u-cust-05',
    name: 'Hawa Sulemana',
    phone: '0244118820',
    email: 'hawa.s@example.com',
    role: 'customer',
    status: 'active',
    balance: 850,
    orders: 4,
    referredBy: null,
    joinedAt: '2026-08-07',
  },
  {
    id: 'u-admin-01',
    name: 'James Owusu',
    phone: '0209876543',
    email: 'james@jamesdataconsult.com',
    role: 'admin',
    status: 'active',
    balance: 0,
    orders: 0,
    referredBy: null,
    joinedAt: '2026-05-01',
  },
]

export const withdrawalRequests: WithdrawalRequest[] = [
  {
    id: 'w-0051',
    agentName: 'Efua Sarpong',
    agentPhone: '0201773900',
    amount: 12000,
    momoNetwork: 'Telecel',
    status: 'pending',
    requestedAt: '2026-08-12T07:41:00',
  },
  {
    id: 'w-0050',
    agentName: 'Abena Nyarko',
    agentPhone: '0244887711',
    amount: 8500,
    momoNetwork: 'MTN',
    status: 'pending',
    requestedAt: '2026-08-11T18:03:00',
  },
  {
    id: 'w-0049',
    agentName: 'Yaw Danso',
    agentPhone: '0553019284',
    amount: 5000,
    momoNetwork: 'MTN',
    status: 'approved',
    requestedAt: '2026-08-10T11:22:00',
  },
  {
    id: 'w-0048',
    agentName: 'Kwame Boateng',
    agentPhone: '0551234567',
    amount: 15000,
    momoNetwork: 'MTN',
    status: 'approved',
    requestedAt: '2026-08-10T09:12:00',
  },
  {
    id: 'w-0047',
    agentName: 'Kofi Asante',
    agentPhone: '0267740012',
    amount: 30000,
    momoNetwork: 'AirtelTigo',
    status: 'rejected',
    requestedAt: '2026-08-08T16:35:00',
  },
]

/** Platform-wide turnover for the admin overview chart (FR-6.3, FR-8.1). */
export const revenueByDay: { day: string; revenue: number; orders: number }[] = [
  { day: 'Wed 6', revenue: 412000, orders: 148 },
  { day: 'Thu 7', revenue: 386500, orders: 139 },
  { day: 'Fri 8', revenue: 524000, orders: 191 },
  { day: 'Sat 9', revenue: 611500, orders: 224 },
  { day: 'Sun 10', revenue: 448000, orders: 162 },
  { day: 'Mon 11', revenue: 573500, orders: 208 },
  { day: 'Tue 12', revenue: 318000, orders: 117 },
]

/** Kwame's own earnings per day, split between his sales and his downline's. */
export const agentEarningsByDay: {
  day: string
  revenue: number
  own: number
  downline: number
}[] = [
  { day: 'Wed 6', revenue: 940, own: 640, downline: 300 },
  { day: 'Thu 7', revenue: 1210, own: 810, downline: 400 },
  { day: 'Fri 8', revenue: 1680, own: 1080, downline: 600 },
  { day: 'Sat 9', revenue: 860, own: 560, downline: 300 },
  { day: 'Sun 10', revenue: 1340, own: 840, downline: 500 },
  { day: 'Mon 11', revenue: 1520, own: 920, downline: 600 },
  { day: 'Tue 12', revenue: 660, own: 500, downline: 160 },
]
