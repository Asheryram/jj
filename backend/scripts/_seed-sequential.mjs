/**
 * Same coverage as _seed-comprehensive.mjs, restructured as a literal series
 * of events - one at a time, in the order a real business would actually
 * generate them (float funded first, then sales, then refunds, then
 * withdrawals) - checking the live /admin/finance/position API against a
 * hand-derived running total after EVERY single step, not just at the end.
 *
 * Run only after _clear-transactions.mjs, against the already-running dev
 * backend on http://localhost:3001. Direct Prisma writes throughout - this
 * backend's DATAHUB_LIVE and Paystack key are both live, so driving a real
 * order would spend real money.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import jwtPkg from 'jsonwebtoken'

const prisma = new PrismaClient()
const API = 'http://localhost:3001/api'

const ADMIN_ID = 'dd9dc161-2741-4eee-9a53-b3fb52accc53' // James
const AGENT_ID = '043dd2ee-8fe1-4edd-a9e5-e71caacd3d9a' // PLATFO90
const AGENT_NAME = 'Platform operator'
const AGENT_CODE = 'PLATFO90'
const FEE_BP = 200
const fee = (subtotal) => Math.ceil((subtotal * FEE_BP) / 10_000)

const PRODUCTS = {
  gb1: { id: 'mtn-data-1gb', supplierCode: 'DH-YELLO-1GB', name: '1GB Data', network: 'MTN', supplierCost: 470, adminPrice: 552, standardPrice: 600 },
  gb2: { id: 'mtn-data-2gb', supplierCode: 'DH-YELLO-2GB', name: '2GB Data', network: 'MTN', supplierCost: 950, adminPrice: 1115, standardPrice: 1212 },
}

const key = (...parts) => parts.join(':')

const TOKEN = jwtPkg.sign(
  { sub: ADMIN_ID, role: 'admin', code: 'JAMES', phone: '0200000000', name: 'James' },
  process.env.JWT_SECRET,
  { expiresIn: '3h' },
)

// Real current time, a few seconds apart per event - so T10/T11 stay
// genuinely "in flight" for the reconciler's real 90s grace window instead of
// being instantly eligible for its next sweep the way a fake historical
// createdAt would be.
let clock = Date.now()
const nextTime = () => new Date((clock += 3000))

const state = {
  revenueAllPaid: 0,
  paystackFeeAllPaid: 0,
  refundTransfersReal: 0,
  withdrawalTransfersReal: 0,
  supplierCostCompleted: 0,
  agentMarginEarned: 0,
  undeliveredSalePrice: 0,
  manualRefundAdvanceOutstanding: 0,
  pendingRefundAmount: 0,
  pendingPayoutAmount: 0,
  stuckPayoutAmount: 0,
  ledgerRefundReversal: 0,
  agentBalance: 0,
  reimbursementLogged: 0,
  capitalIn: 0,
  capitalOut: 0,
}

function derivePosition() {
  const netCollected = state.revenueAllPaid - state.paystackFeeAllPaid
  const expectedAtPaystack = netCollected - state.refundTransfersReal - state.withdrawalTransfersReal
  const liabilities = {
    agentEarnings: state.agentBalance,
    customerMoney: state.pendingRefundAmount,
    undeliveredOrders: state.undeliveredSalePrice,
    queuedPayouts: state.pendingPayoutAmount + state.stuckPayoutAmount,
    manualRefundAdvances: state.manualRefundAdvanceOutstanding,
  }
  liabilities.total = Object.values(liabilities).reduce((a, b) => a + b, 0)
  const spentOnBundles = Math.max(0, state.supplierCostCompleted - state.reimbursementLogged)
  const freeToSpend = expectedAtPaystack - liabilities.total - spentOnBundles
  return { expectedAtPaystack, liabilities, spentOnBundles, freeToSpend }
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

let stepNo = 0
let failures = 0

async function verifyPosition(label) {
  stepNo++
  const res = await fetch(`${API}/admin/finance/position`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const actual = await res.json()
  const expected = derivePosition()
  const fields = [
    'expectedAtPaystack',
    'liabilities.agentEarnings',
    'liabilities.customerMoney',
    'liabilities.undeliveredOrders',
    'liabilities.queuedPayouts',
    'liabilities.manualRefundAdvances',
    'liabilities.total',
    'spentOnBundles',
    'freeToSpend',
  ]
  let ok = true
  const mismatches = []
  for (const f of fields) {
    const exp = getPath(expected, f)
    const act = getPath(actual, f)
    if (exp !== act) {
      ok = false
      mismatches.push(`      MISMATCH ${f}: expected=${exp} actual=${act}`)
    }
  }
  console.log(`step ${String(stepNo).padStart(2, '0')}  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log(
    `      freeToSpend=${actual.freeToSpend}p  spentOnBundles=${actual.spentOnBundles}p  ` +
      `liabilities.total=${actual.liabilities?.total}p  expectedAtPaystack=${actual.expectedAtPaystack}p`,
  )
  if (!ok) {
    failures++
    mismatches.forEach((m) => console.log(m))
  }
}

async function verifyFloatCapital(label) {
  const res = await fetch(`${API}/admin/supplier/float`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const actual = await res.json()
  const expected = { totalIn: state.capitalIn, totalOut: state.capitalOut, net: state.capitalIn - state.capitalOut }
  const ok =
    actual.capital?.totalIn === expected.totalIn &&
    actual.capital?.totalOut === expected.totalOut &&
    actual.capital?.net === expected.net
  console.log(`           ${ok ? 'PASS' : 'FAIL'}  float capital (${label}): expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual.capital)}`)
  if (!ok) failures++
}

// ── Event helpers ───────────────────────────────────────────────────────────

async function logCapitalIn(amount, source, note) {
  const isFirst = state.capitalIn === 0 && state.capitalOut === 0
  if (isFirst) {
    await prisma.setting.create({
      data: { key: 'supplierFloatCapitalBaseline', value: { balance: 0, capturedAt: nextTime().toISOString() } },
    })
  }
  const reimbursement = source === 'reimbursement'
  await prisma.ledgerEntry.create({
    data: {
      idempotencyKey: randomUUID(),
      kind: reimbursement ? 'capital_in_reimbursement' : 'capital_in',
      amount,
      affectsProfit: false,
      description: note,
      occurredAt: nextTime(),
    },
  })
  state.capitalIn += amount
  if (reimbursement) state.reimbursementLogged += amount
  console.log(`  -> logged capital_in${reimbursement ? '_reimbursement' : ''} +${amount}p (${note})`)
}

async function logCapitalOut(amount, note) {
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: randomUUID(), kind: 'capital_out', amount: -amount, affectsProfit: false, description: note, occurredAt: nextTime() },
  })
  state.capitalOut += amount
  console.log(`  -> logged capital_out -${amount}p (${note})`)
}

async function directSale({ ref, product, actualCost, note }) {
  const orderId = randomUUID()
  const p = PRODUCTS[product]
  const adminMargin = p.standardPrice - p.supplierCost
  const subtotal = p.supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const createdAt = nextTime()
  const completedAt = nextTime()

  const split = {
    supplierCost: p.supplierCost,
    shares: [{ userId: ADMIN_ID, name: 'James', role: 'admin', depth: 0, paid: p.supplierCost, charged: p.standardPrice, margin: adminMargin }],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId, reference: ref, productId: p.id, productName: p.name, network: p.network, category: 'data',
      recipient: '0244000001', salePrice, split, status: 'completed', paidWith: 'momo', buyer: 'Guest',
      buyerPhone: '0244000001', providerReference: `TEST-${ref}`, createdAt, completedAt,
    },
  })
  await prisma.payment.create({
    data: {
      reference: ref, purpose: 'order', status: 'paid', amount: salePrice, orderId, channel: 'mobile_money',
      network: p.network, fee: processingFee, providerId: `TEST-PAY-${ref}`, paidAt: createdAt, createdAt,
    },
  })
  await prisma.supplierDispatch.create({
    data: {
      orderId, orderRef: ref, supplierCode: p.supplierCode, recipient: '0244000001', costPrice: p.supplierCost,
      outcome: 'pending', simulated: true, providerReference: `TEST-DISP-${ref}`, providerStatus: 'SUCCESSFUL',
      providerCharged: actualCost, createdAt: completedAt,
    },
  })
  await prisma.ledgerEntry.createMany({
    data: [
      { idempotencyKey: key('order', ref, 'revenue'), kind: 'revenue', amount: salePrice, affectsProfit: true, description: `Sale - ${p.name}`, orderRef: ref, paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('payment', ref, 'fee'), kind: 'payment_fee', amount: -processingFee, affectsProfit: true, description: 'Paystack fee - mobile_money', paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('order', ref, 'supplier_cost'), kind: 'supplier_cost', amount: -actualCost, affectsProfit: true, description: `Bundle cost - ${p.name}`, orderRef: ref, occurredAt: completedAt },
    ],
  })

  state.revenueAllPaid += salePrice
  state.paystackFeeAllPaid += processingFee
  state.supplierCostCompleted += actualCost

  console.log(`  -> ${ref} (${product}) direct sale, completed. sale=${salePrice}p actualCost=${actualCost}p  (${note})`)
}

async function agentSale({ ref, product, agentMargin, actualCost, note }) {
  const orderId = randomUUID()
  const p = PRODUCTS[product]
  const agentResalePrice = p.adminPrice + agentMargin
  const adminMargin = p.adminPrice - p.supplierCost
  const subtotal = p.supplierCost + agentMargin + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const createdAt = nextTime()
  const completedAt = nextTime()

  const split = {
    supplierCost: p.supplierCost,
    shares: [
      { userId: AGENT_ID, name: AGENT_NAME, role: 'agent', depth: 0, paid: p.adminPrice, charged: agentResalePrice, margin: agentMargin },
      { userId: ADMIN_ID, name: 'James', role: 'admin', depth: 2, paid: p.supplierCost, charged: p.adminPrice, margin: adminMargin },
    ],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId, reference: ref, productId: p.id, productName: p.name, network: p.network, category: 'data',
      recipient: '0244000002', salePrice, split, soldByCode: AGENT_CODE, status: 'completed', paidWith: 'momo',
      buyer: 'Guest', buyerPhone: '0244000002', providerReference: `TEST-${ref}`, createdAt, completedAt,
    },
  })
  await prisma.payment.create({
    data: {
      reference: ref, purpose: 'order', status: 'paid', amount: salePrice, orderId, channel: 'mobile_money',
      network: p.network, fee: processingFee, providerId: `TEST-PAY-${ref}`, paidAt: createdAt, createdAt,
    },
  })
  await prisma.supplierDispatch.create({
    data: {
      orderId, orderRef: ref, supplierCode: p.supplierCode, recipient: '0244000002', costPrice: p.supplierCost,
      outcome: 'pending', simulated: true, providerReference: `TEST-DISP-${ref}`, providerStatus: 'SUCCESSFUL',
      providerCharged: actualCost, createdAt: completedAt,
    },
  })
  await prisma.ledgerEntry.createMany({
    data: [
      { idempotencyKey: key('order', ref, 'revenue'), kind: 'revenue', amount: salePrice, affectsProfit: true, description: `Sale - ${p.name}`, orderRef: ref, paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('payment', ref, 'fee'), kind: 'payment_fee', amount: -processingFee, affectsProfit: true, description: 'Paystack fee - mobile_money', paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('order', ref, 'supplier_cost'), kind: 'supplier_cost', amount: -actualCost, affectsProfit: true, description: `Bundle cost - ${p.name}`, orderRef: ref, occurredAt: completedAt },
      { idempotencyKey: key('order', ref, 'agent_margin'), kind: 'agent_margin', amount: -agentMargin, affectsProfit: true, description: `Agent margin - ${AGENT_NAME}`, orderRef: ref, userId: AGENT_ID, occurredAt: completedAt },
    ],
  })
  await prisma.earning.create({
    data: { userId: AGENT_ID, type: 'sale', amount: agentMargin, balanceAfter: state.agentBalance + agentMargin, description: `Sale - ${p.name}`, reference: ref, depth: 0 },
  })
  await prisma.user.update({ where: { id: AGENT_ID }, data: { balance: { increment: agentMargin } } })

  state.revenueAllPaid += salePrice
  state.paystackFeeAllPaid += processingFee
  state.supplierCostCompleted += actualCost
  state.agentMarginEarned += agentMargin
  state.agentBalance += agentMargin

  console.log(`  -> ${ref} (${product}) agent sale, completed. sale=${salePrice}p actualCost=${actualCost}p agentMargin=${agentMargin}p  (${note})`)
}

async function failedOrder({ ref, product, refundState, note }) {
  const orderId = randomUUID()
  const p = PRODUCTS[product]
  const adminMargin = p.standardPrice - p.supplierCost
  const subtotal = p.supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const createdAt = nextTime()
  const refunded = refundState === 'real' || refundState === 'manual'

  const split = {
    supplierCost: p.supplierCost,
    shares: [{ userId: ADMIN_ID, name: 'James', role: 'admin', depth: 0, paid: p.supplierCost, charged: p.standardPrice, margin: adminMargin }],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId, reference: ref, productId: p.id, productName: p.name, network: p.network, category: 'data',
      recipient: '0244000003', salePrice, split,
      status: 'failed', paidWith: 'momo', buyer: 'Guest', buyerPhone: '0244000003',
      providerReference: `TEST-${ref}`, createdAt, refunded,
    },
  })
  await prisma.payment.create({
    data: {
      reference: ref, purpose: 'order', status: 'paid', amount: salePrice, orderId, channel: 'mobile_money',
      network: p.network, fee: processingFee, providerId: `TEST-PAY-${ref}`, paidAt: createdAt, createdAt,
    },
  })
  await prisma.supplierDispatch.create({
    data: {
      orderId, orderRef: ref, supplierCode: p.supplierCode, recipient: '0244000003', costPrice: p.supplierCost,
      outcome: 'rejected', reason: 'Insufficient balance', simulated: true, providerReference: `TEST-DISP-${ref}`, createdAt,
    },
  })
  await prisma.ledgerEntry.createMany({
    data: [
      { idempotencyKey: key('order', ref, 'revenue'), kind: 'revenue', amount: salePrice, affectsProfit: true, description: `Sale - ${p.name}`, orderRef: ref, paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('payment', ref, 'fee'), kind: 'payment_fee', amount: -processingFee, affectsProfit: true, description: 'Paystack fee - mobile_money', paymentRef: ref, occurredAt: createdAt },
    ],
  })
  state.revenueAllPaid += salePrice
  state.paystackFeeAllPaid += processingFee

  const refundId = randomUUID()
  if (refundState === 'pending') {
    await prisma.refundRequest.create({
      data: {
        id: refundId, orderId, orderRef: ref, productName: p.name, buyerName: 'Guest', buyerPhone: '0244000003',
        amount: salePrice, method: 'transfer', reason: 'Insufficient balance', status: 'pending', createdAt: nextTime(),
      },
    })
    state.pendingRefundAmount += salePrice
    console.log(`  -> ${ref} (${product}) failed, refund PENDING. sale=${salePrice}p  (${note})`)
    return
  }

  const decidedAt = nextTime()
  const isReal = refundState === 'real'
  await prisma.refundRequest.create({
    data: {
      id: refundId, orderId, orderRef: ref, productName: p.name, buyerName: 'Guest', buyerPhone: '0244000003',
      amount: salePrice, method: 'transfer', reason: 'Insufficient balance', status: 'approved',
      decidedAt, decidedBy: ADMIN_ID, momoNetwork: 'MTN',
      transferStatus: 'success', paidAt: decidedAt,
      transferCode: isReal ? `TEST-TRF-${ref}` : null,
      transferNote: isReal ? null : `Sent manually - test scenario (${ref})`,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      idempotencyKey: key('order', ref, 'refund'), kind: 'refund', amount: -salePrice, affectsProfit: true,
      description: isReal ? `Refund - ${p.name}` : `Refund (sent manually) - ${p.name}`, orderRef: ref, occurredAt: decidedAt,
    },
  })
  state.ledgerRefundReversal += salePrice

  if (isReal) {
    state.refundTransfersReal += salePrice
    console.log(`  -> ${ref} (${product}) failed, refund SENT via real Paystack transfer. sale=${salePrice}p  (${note})`)
  } else {
    await prisma.ledgerEntry.create({
      data: {
        idempotencyKey: key('order', ref, 'capital_in'), kind: 'capital_in', amount: salePrice, affectsProfit: false,
        description: `Covered refund ${ref} personally - test scenario`, orderRef: ref, occurredAt: decidedAt,
      },
    })
    state.manualRefundAdvanceOutstanding += salePrice
    console.log(`  -> ${ref} (${product}) failed, refund settled MANUALLY, not yet reimbursed. sale=${salePrice}p  (${note})`)
  }
}

async function reimburseAdvance(ref) {
  const advance = await prisma.ledgerEntry.findFirst({ where: { kind: 'capital_in', orderRef: ref } })
  await prisma.ledgerEntry.create({
    data: {
      idempotencyKey: key('order', ref, 'capital_out'), kind: 'capital_out', amount: -advance.amount,
      affectsProfit: false, description: `Reimbursed - refund ${ref}`, orderRef: ref, occurredAt: nextTime(),
    },
  })
  state.manualRefundAdvanceOutstanding -= advance.amount
  console.log(`  -> ${ref}'s manual refund advance reimbursed (${advance.amount}p) - cleared from manualRefundAdvances`)
}

async function undeliveredOrder({ ref, product, status, note }) {
  const orderId = randomUUID()
  const p = PRODUCTS[product]
  const adminMargin = p.standardPrice - p.supplierCost
  const subtotal = p.supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const createdAt = nextTime()

  const split = {
    supplierCost: p.supplierCost,
    shares: [{ userId: ADMIN_ID, name: 'James', role: 'admin', depth: 0, paid: p.supplierCost, charged: p.standardPrice, margin: adminMargin }],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId, reference: ref, productId: p.id, productName: p.name, network: p.network, category: 'data',
      recipient: '0244000004', salePrice, split,
      status, paidWith: 'momo', buyer: 'Guest', buyerPhone: '0244000004', providerReference: `TEST-${ref}`, createdAt,
    },
  })
  await prisma.payment.create({
    data: {
      reference: ref, purpose: 'order', status: 'paid', amount: salePrice, orderId, channel: 'mobile_money',
      network: p.network, fee: processingFee, providerId: `TEST-PAY-${ref}`, paidAt: createdAt, createdAt,
    },
  })
  await prisma.ledgerEntry.createMany({
    data: [
      { idempotencyKey: key('order', ref, 'revenue'), kind: 'revenue', amount: salePrice, affectsProfit: true, description: `Sale - ${p.name}`, orderRef: ref, paymentRef: ref, occurredAt: createdAt },
      { idempotencyKey: key('payment', ref, 'fee'), kind: 'payment_fee', amount: -processingFee, affectsProfit: true, description: 'Paystack fee - mobile_money', paymentRef: ref, occurredAt: createdAt },
    ],
  })
  state.revenueAllPaid += salePrice
  state.paystackFeeAllPaid += processingFee
  state.undeliveredSalePrice += salePrice
  console.log(`  -> ${ref} (${product}) now ${status}. sale=${salePrice}p  (${note})`)
}

async function requestWithdrawal(amount) {
  const id = randomUUID()
  await prisma.withdrawal.create({
    data: { id, userId: AGENT_ID, agentName: AGENT_NAME, agentPhone: '0595024589', amount, momoNetwork: 'MTN', status: 'pending', requestedAt: nextTime() },
  })
  state.agentBalance -= amount
  await prisma.earning.create({
    data: { userId: AGENT_ID, type: 'withdrawal', amount: -amount, balanceAfter: state.agentBalance, description: 'Withdrawal requested - MTN 0595024589', reference: `WDR-${id.slice(0, 8).toUpperCase()}`, depth: 0 },
  })
  await prisma.user.update({ where: { id: AGENT_ID }, data: { balance: { decrement: amount } } })
  state.pendingPayoutAmount += amount
  console.log(`  -> withdrawal ${id.slice(0, 8)} requested, ${amount}p, pending`)
  return id
}

async function approveWithdrawalStuck(id, amount) {
  const decidedAt = nextTime()
  await prisma.withdrawal.update({ where: { id }, data: { status: 'approved', decidedAt, transferStatus: 'otp', transferNote: 'Waiting on an OTP in the Paystack dashboard' } })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: key('withdrawal', id, 'payout'), kind: 'payout', amount: -amount, affectsProfit: false, description: `Paid out to ${AGENT_NAME} - 0595024589`, withdrawalId: id, userId: AGENT_ID, occurredAt: decidedAt },
  })
  state.pendingPayoutAmount -= amount
  state.stuckPayoutAmount += amount
  console.log(`  -> withdrawal ${id.slice(0, 8)} approved but stuck (transferStatus=otp)`)
}

async function approveWithdrawalPaid(id, amount) {
  const paidAt = nextTime()
  await prisma.withdrawal.update({ where: { id }, data: { status: 'approved', decidedAt: paidAt, transferStatus: 'success', transferCode: `TEST-WD-TRF-${id.slice(0, 6)}`, paidAt } })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: key('withdrawal', id, 'payout'), kind: 'payout', amount: -amount, affectsProfit: false, description: `Paid out to ${AGENT_NAME} - 0595024589`, withdrawalId: id, userId: AGENT_ID, occurredAt: paidAt },
  })
  state.pendingPayoutAmount -= amount
  state.withdrawalTransfersReal += amount
  console.log(`  -> withdrawal ${id.slice(0, 8)} approved and PAID (real transfer)`)
}

async function rejectWithdrawal(id, amount) {
  const rejectedAt = nextTime()
  state.agentBalance += amount
  await prisma.withdrawal.update({ where: { id }, data: { status: 'rejected', decidedAt: rejectedAt } })
  await prisma.earning.create({
    data: { userId: AGENT_ID, type: 'withdrawal', amount, balanceAfter: state.agentBalance, description: 'Withdrawal rejected - amount returned to your balance', reference: `WDR-${id.slice(0, 8).toUpperCase()}-R`, depth: 0 },
  })
  await prisma.user.update({ where: { id: AGENT_ID }, data: { balance: { increment: amount } } })
  state.pendingPayoutAmount -= amount
  console.log(`  -> withdrawal ${id.slice(0, 8)} rejected, ${amount}p returned to agent balance`)
}

// ── The series of events ────────────────────────────────────────────────────

async function main() {
  console.log(`Admin JWT minted, calling ${API} as James (${ADMIN_ID})\n`)

  console.log('--- 1. James funds the DataHub float ---')
  await logCapitalIn(5000, 'external', 'Capital added: GHS 50.00')
  await verifyPosition('float funded (no sales yet - no effect on position)')
  await verifyFloatCapital('after funding')

  console.log('\n--- 2-4. Direct sales, three catalogue-cost outcomes ---')
  await directSale({ ref: 'JDC-S01', product: 'gb1', actualCost: 470, note: 'exact catalogue cost' })
  await verifyPosition('JDC-S01 direct sale, exact cost')

  await directSale({ ref: 'JDC-S02', product: 'gb1', actualCost: 420, note: 'DataHub charged less than catalogue' })
  await verifyPosition('JDC-S02 direct sale, DataHub charged less')

  await directSale({ ref: 'JDC-S03', product: 'gb1', actualCost: 520, note: 'DataHub charged more than catalogue' })
  await verifyPosition('JDC-S03 direct sale, DataHub charged more')

  console.log('\n--- 5-7. Agent sales, three catalogue-cost outcomes ---')
  await agentSale({ ref: 'JDC-S04', product: 'gb1', agentMargin: 100, actualCost: 470, note: 'exact catalogue cost' })
  await verifyPosition('JDC-S04 agent sale, exact cost')

  await agentSale({ ref: 'JDC-S05', product: 'gb1', agentMargin: 100, actualCost: 420, note: 'DataHub charged less' })
  await verifyPosition('JDC-S05 agent sale, DataHub charged less')

  await agentSale({ ref: 'JDC-S06', product: 'gb2', agentMargin: 150, actualCost: 1050, note: 'DataHub charged more' })
  await verifyPosition('JDC-S06 agent sale, DataHub charged more')

  console.log('\n--- 8-10. Failed orders, three refund outcomes ---')
  await failedOrder({ ref: 'JDC-S07', product: 'gb1', refundState: 'pending', note: 'awaiting a decision' })
  await verifyPosition('JDC-S07 failed, refund pending')

  await failedOrder({ ref: 'JDC-S08', product: 'gb1', refundState: 'real', note: 'Paystack sent it' })
  await verifyPosition('JDC-S08 failed, refund sent via real transfer')

  await failedOrder({ ref: 'JDC-S09', product: 'gb1', refundState: 'manual', note: "Paystack refused, settled from someone's pocket" })
  await verifyPosition('JDC-S09 failed, refund settled manually')

  console.log('\n--- 11. James pays DataHub back for bundles already bought ---')
  await logCapitalIn(200, 'reimbursement', 'Moved to DataHub from Paystack: GHS 2.00')
  await verifyPosition('reimbursement logged (spentOnBundles should drop by 200p)')
  await verifyFloatCapital('after reimbursement')

  console.log('\n--- 12. James takes some float capital back out ---')
  await logCapitalOut(1000, 'Capital withdrawn: GHS 10.00')
  await verifyPosition('capital_out logged (no effect on position - float-only)')
  await verifyFloatCapital('after capital_out')

  console.log("\n--- 13. James is reimbursed for personally covering S09's refund ---")
  await reimburseAdvance('JDC-S09')
  await verifyPosition('JDC-S09 manual advance reimbursed (manualRefundAdvances should drop to 0)')

  console.log('\n--- 14-15. Orders still in flight ---')
  await undeliveredOrder({ ref: 'JDC-S10', product: 'gb1', status: 'processing', note: 'still processing' })
  await verifyPosition('JDC-S10 processing (undelivered liability should rise)')

  await undeliveredOrder({ ref: 'JDC-S11', product: 'gb1', status: 'awaiting_approval', note: 'number needs DataHub approval' })
  await verifyPosition('JDC-S11 awaiting_approval (undelivered liability should rise again)')

  console.log('\n--- 16-19. Withdrawals, four outcomes ---')
  const idA = await requestWithdrawal(50)
  await verifyPosition('withdrawal A requested (50p pending)')

  const idB = await requestWithdrawal(100)
  await verifyPosition('withdrawal B requested (100p pending)')
  await approveWithdrawalStuck(idB, 100)
  await verifyPosition('withdrawal B approved but stuck (still owed, moved from pending to stuck)')

  const idC = await requestWithdrawal(100)
  await verifyPosition('withdrawal C requested (100p pending)')
  await approveWithdrawalPaid(idC, 100)
  await verifyPosition('withdrawal C approved and paid (real transfer - leaves expectedAtPaystack)')

  const idD = await requestWithdrawal(50)
  await verifyPosition('withdrawal D requested (50p pending)')
  await rejectWithdrawal(idD, 50)
  await verifyPosition('withdrawal D rejected (returned to agent balance)')

  console.log('\n--- 20. Float reconciliation - deliberately offset live reading ---')
  {
    const capitalNet = state.capitalIn - state.capitalOut
    const expectedFloat = 0 + capitalNet - state.supplierCostCompleted
    const observedBalance = expectedFloat - 1000 // deliberate 1000p shortfall, to prove flagging works
    await prisma.setting.create({
      data: { key: 'supplierFloat', value: { balance: observedBalance, observedAt: nextTime().toISOString(), orderRef: 'JDC-S06' } },
    })
    const res = await fetch(`${API}/admin/supplier/float`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const actual = await res.json()
    const ok =
      actual.reconciliation?.expected === expectedFloat &&
      actual.reconciliation?.observed === observedBalance &&
      actual.reconciliation?.shortfall === 1000 &&
      actual.reconciliation?.flagged === true
    console.log(`step ${String(++stepNo).padStart(2, '0')}  ${ok ? 'PASS' : 'FAIL'}  float reconciliation with a real 1000p shortfall`)
    console.log(`      expected=${JSON.stringify({ expected: expectedFloat, observed: observedBalance, shortfall: 1000, flagged: true })}`)
    console.log(`      actual  =${JSON.stringify(actual.reconciliation)}`)
    if (!ok) failures++
  }

  console.log(`\n=== ${failures === 0 ? 'ALL STEPS PASSED' : `${failures} STEP(S) FAILED`} (${stepNo} checks) ===`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
