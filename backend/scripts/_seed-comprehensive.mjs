/**
 * A deliberately complete set of test data - one order (or record) per
 * distinct code path this session's financial reconciliation work touches -
 * so every figure on the Reserve panel, Overview, and Orders page can be
 * checked against a hand-computable expected value instead of trusted blind.
 *
 * Direct Prisma writes throughout, never the real checkout flow: this
 * backend's DATAHUB_LIVE and Paystack key are both live, so driving a real
 * order would spend real money.
 *
 * Run only after _clear-transactions.mjs. Prints a full expected-value
 * report at the end - compare it against the live API, not against this
 * script's source.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const ADMIN_ID = 'dd9dc161-2741-4eee-9a53-b3fb52accc53' // James
const AGENT_ID = '043dd2ee-8fe1-4edd-a9e5-e71caacd3d9a' // PLATFO90
const AGENT_NAME = 'Platform operator'
const AGENT_CODE = 'PLATFO90'
const FEE_BP = 200 // must match the live paystackFeeBp setting
const fee = (subtotal) => Math.ceil((subtotal * FEE_BP) / 10_000)

const PRODUCTS = {
  gb1: { id: 'mtn-data-1gb', supplierCode: 'DH-YELLO-1GB', name: '1GB Data', network: 'MTN', supplierCost: 470, adminPrice: 552, standardPrice: 600 },
  gb2: { id: 'mtn-data-2gb', supplierCode: 'DH-YELLO-2GB', name: '2GB Data', network: 'MTN', supplierCost: 950, adminPrice: 1115, standardPrice: 1212 },
}

const key = (...parts) => parts.join(':')

// Running expectations, accumulated as each scenario is built - the computer
// does this arithmetic, not a human, on purpose.
const expect = {
  revenueAllPaid: 0, // sum of every successful Payment.amount
  paystackFeeAllPaid: 0, // sum of every successful Payment.fee
  refundTransfersReal: 0, // real Paystack refund transfers only (has transferCode)
  withdrawalTransfersReal: 0, // real Paystack payout transfers only
  supplierCostCompleted: 0, // sum of actualCost for completed orders
  agentMarginEarned: 0, // sum of agent margin across completed agent sales
  undeliveredSalePrice: 0, // sum of salePrice for processing/awaiting_approval orders
  manualRefundAdvanceOutstanding: 0, // capital_in tied to an order, not yet reimbursed
  pendingRefundAmount: 0,
  pendingPayoutAmount: 0,
  stuckPayoutAmount: 0,
  ledgerRefundReversal: 0, // sum of |refund| ledger entries (both real and manual)
}

let t = new Date('2026-08-01T09:00:00.000Z')
const nextTime = () => {
  t = new Date(t.getTime() + 3600_000) // one hour apart, keeps everything ordered
  return new Date(t)
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

  expect.revenueAllPaid += salePrice
  expect.paystackFeeAllPaid += processingFee
  expect.supplierCostCompleted += actualCost

  const trueMargin = adminMargin + (p.supplierCost - actualCost)
  console.log(`  [direct]  ${ref}  ${product}  sale=${salePrice}p actualCost=${actualCost}p trueMargin=${trueMargin}p  (${note})`)
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
    data: { userId: AGENT_ID, type: 'sale', amount: agentMargin, balanceAfter: 0, description: `Sale - ${p.name}`, reference: ref, depth: 0 },
  })
  await prisma.user.update({ where: { id: AGENT_ID }, data: { balance: { increment: agentMargin } } })

  expect.revenueAllPaid += salePrice
  expect.paystackFeeAllPaid += processingFee
  expect.supplierCostCompleted += actualCost
  expect.agentMarginEarned += agentMargin

  const trueMargin = adminMargin + (p.supplierCost - actualCost)
  console.log(`  [agent]   ${ref}  ${product}  sale=${salePrice}p actualCost=${actualCost}p agentMargin=${agentMargin}p adminTrueMargin=${trueMargin}p  (${note})`)
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

  // A real order's split is computed and frozen at placement time, before the
  // outcome is known — a failed order still has one, exactly as if it had
  // gone on to complete. An empty `shares` breaks the salePrice invariant.
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
  expect.revenueAllPaid += salePrice
  expect.paystackFeeAllPaid += processingFee

  const refundId = randomUUID()
  if (refundState === 'pending') {
    await prisma.refundRequest.create({
      data: {
        id: refundId, orderId, orderRef: ref, productName: p.name, buyerName: 'Guest', buyerPhone: '0244000003',
        amount: salePrice, method: 'transfer', reason: 'Insufficient balance', status: 'pending', createdAt: nextTime(),
      },
    })
    expect.pendingRefundAmount += salePrice
    console.log(`  [failed]  ${ref}  ${product}  sale=${salePrice}p  refund PENDING  (${note})`)
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
  expect.ledgerRefundReversal += salePrice

  if (isReal) {
    expect.refundTransfersReal += salePrice
    console.log(`  [failed]  ${ref}  ${product}  sale=${salePrice}p  refund SENT via real Paystack transfer  (${note})`)
  } else {
    await prisma.ledgerEntry.create({
      data: {
        idempotencyKey: key('order', ref, 'capital_in'), kind: 'capital_in', amount: salePrice, affectsProfit: false,
        description: `Covered refund ${ref} personally - test scenario`, orderRef: ref, occurredAt: decidedAt,
      },
    })
    expect.manualRefundAdvanceOutstanding += salePrice
    console.log(`  [failed]  ${ref}  ${product}  sale=${salePrice}p  refund settled MANUALLY, not yet reimbursed  (${note})`)
  }
}

async function undeliveredOrder({ ref, product, status, note }) {
  const orderId = randomUUID()
  const p = PRODUCTS[product]
  const adminMargin = p.standardPrice - p.supplierCost
  const subtotal = p.supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const createdAt = nextTime()

  // Same reasoning as failedOrder: the split exists from placement, whatever
  // happens to the order afterward.
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
  expect.revenueAllPaid += salePrice
  expect.paystackFeeAllPaid += processingFee
  expect.undeliveredSalePrice += salePrice
  console.log(`  [${status}] ${ref}  ${product}  sale=${salePrice}p  (${note})`)
}

console.log('--- completed sales ---')
await directSale({ ref: 'JDC-T01', product: 'gb1', actualCost: 470, note: 'direct, exact catalogue' })
await directSale({ ref: 'JDC-T02', product: 'gb1', actualCost: 420, note: 'direct, DataHub charged less (+diff, extra profit)' })
await directSale({ ref: 'JDC-T03', product: 'gb1', actualCost: 520, note: 'direct, DataHub charged more (-diff, a loss)' })
await agentSale({ ref: 'JDC-T04', product: 'gb1', agentMargin: 100, actualCost: 470, note: 'agent, exact catalogue' })
await agentSale({ ref: 'JDC-T05', product: 'gb1', agentMargin: 100, actualCost: 420, note: 'agent, +diff' })
await agentSale({ ref: 'JDC-T06', product: 'gb2', agentMargin: 150, actualCost: 1050, note: 'agent, -diff' })

console.log('--- failed / refund scenarios ---')
await failedOrder({ ref: 'JDC-T07', product: 'gb1', refundState: 'pending', note: 'awaiting your decision' })
await failedOrder({ ref: 'JDC-T08', product: 'gb1', refundState: 'real', note: 'Paystack sent it - has a transferCode' })
await failedOrder({ ref: 'JDC-T09', product: 'gb1', refundState: 'manual', note: 'Paystack refused - settled from someone\'s own pocket' })

console.log('--- undelivered (in flight) ---')
await undeliveredOrder({ ref: 'JDC-T10', product: 'gb1', status: 'processing', note: 'still processing' })
await undeliveredOrder({ ref: 'JDC-T11', product: 'gb1', status: 'awaiting_approval', note: 'number needs DataHub approval' })

console.log('--- withdrawals ---')
{
  // Mirrors WithdrawalsService exactly: balance is debited (and an Earning
  // row written) the moment a request is made, not at approval; an approved
  // request also gets a `payout` ledger line regardless of whether the
  // transfer itself later succeeds; a rejection returns the hold with its
  // own Earning row.
  let runningBalance = 350 // total agent earnings from T04+T05+T06

  const request = async (amount) => {
    const id = randomUUID()
    runningBalance -= amount
    await prisma.withdrawal.create({
      data: { id, userId: AGENT_ID, agentName: AGENT_NAME, agentPhone: '0595024589', amount, momoNetwork: 'MTN', status: 'pending', requestedAt: nextTime() },
    })
    await prisma.earning.create({
      data: { userId: AGENT_ID, type: 'withdrawal', amount: -amount, balanceAfter: runningBalance, description: `Withdrawal requested - MTN 0595024589`, reference: `WDR-${id.slice(0, 8).toUpperCase()}`, depth: 0 },
    })
    return id
  }

  // A: pending
  const idA = await request(50)
  expect.pendingPayoutAmount += 50
  console.log('  [withdrawal] 50p  pending')

  // B: approved, not yet actually sent (stuck) - still gets a payout line
  const idB = await request(100)
  const decidedAtB = nextTime()
  await prisma.withdrawal.update({ where: { id: idB }, data: { status: 'approved', decidedAt: decidedAtB, transferStatus: 'otp', transferNote: 'Waiting on an OTP in the Paystack dashboard' } })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: key('withdrawal', idB, 'payout'), kind: 'payout', amount: -100, affectsProfit: false, description: `Paid out to ${AGENT_NAME} - 0595024589`, withdrawalId: idB, userId: AGENT_ID, occurredAt: decidedAtB },
  })
  expect.stuckPayoutAmount += 100
  console.log('  [withdrawal] 100p approved, stuck (transferStatus=otp)')

  // C: approved and actually paid - a real transfer
  const idC = await request(100)
  const paidAt = nextTime()
  await prisma.withdrawal.update({ where: { id: idC }, data: { status: 'approved', decidedAt: paidAt, transferStatus: 'success', transferCode: 'TEST-WD-TRF-C', paidAt } })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: key('withdrawal', idC, 'payout'), kind: 'payout', amount: -100, affectsProfit: false, description: `Paid out to ${AGENT_NAME} - 0595024589`, withdrawalId: idC, userId: AGENT_ID, occurredAt: paidAt },
  })
  expect.withdrawalTransfersReal += 100
  console.log('  [withdrawal] 100p approved and paid (real transfer)')

  // D: requested then rejected - money returns, with its own Earning row
  const idD = await request(50)
  const rejectedAt = nextTime()
  runningBalance += 50
  await prisma.withdrawal.update({ where: { id: idD }, data: { status: 'rejected', decidedAt: rejectedAt } })
  await prisma.earning.create({
    data: { userId: AGENT_ID, type: 'withdrawal', amount: 50, balanceAfter: runningBalance, description: 'Withdrawal rejected - amount returned to your balance', reference: `WDR-${idD.slice(0, 8).toUpperCase()}-R`, depth: 0 },
  })
  console.log('  [withdrawal] 50p requested then rejected (returned)')

  await prisma.user.update({ where: { id: AGENT_ID }, data: { balance: runningBalance } })
}

console.log('--- float capital ---')
{
  const baselineAt = new Date('2026-08-01T00:00:00.000Z')
  await prisma.setting.create({
    data: { key: 'supplierFloatCapitalBaseline', value: { balance: 0, capturedAt: baselineAt.toISOString() } },
  })

  await prisma.ledgerEntry.create({
    data: { idempotencyKey: 'test:capital:external', kind: 'capital_in', amount: 5000, affectsProfit: false, description: 'Capital added: GHS 50.00', occurredAt: nextTime() },
  })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: 'test:capital:reimbursement', kind: 'capital_in_reimbursement', amount: 200, affectsProfit: false, description: 'Moved to DataHub from Paystack: GHS 2.00', occurredAt: nextTime() },
  })
  await prisma.ledgerEntry.create({
    data: { idempotencyKey: 'test:capital:out', kind: 'capital_out', amount: -1000, affectsProfit: false, description: 'Capital withdrawn: GHS 10.00', occurredAt: nextTime() },
  })

  const capitalNet = 5000 + 200 - 1000
  const expectedFloat = 0 + capitalNet - expect.supplierCostCompleted // baseline + net capital - cost spent since
  const observedAt = nextTime()
  await prisma.setting.create({
    data: { key: 'supplierFloat', value: { balance: expectedFloat, observedAt: observedAt.toISOString(), orderRef: 'JDC-T06' } },
  })
  console.log(`  capital_in (external)=5000p, capital_in_reimbursement=200p, capital_out=1000p`)
  console.log(`  float baseline=0p at ${baselineAt.toISOString()}, expected float now=${expectedFloat}p, live reading set to match exactly`)
}

// Expected-value report
const netCollected = expect.revenueAllPaid - expect.paystackFeeAllPaid
const expectedAtPaystack = netCollected - expect.refundTransfersReal - expect.withdrawalTransfersReal
const liabilitiesUndelivered = expect.undeliveredSalePrice
const liabilitiesAgent = 100 // agent's final balance, computed above (350 - 300 + 50)
const liabilitiesQueuedPayouts = expect.pendingPayoutAmount + expect.stuckPayoutAmount
const liabilitiesManualAdvances = expect.manualRefundAdvanceOutstanding
const liabilitiesCustomer = expect.pendingRefundAmount
const liabilitiesTotal = liabilitiesAgent + liabilitiesCustomer + liabilitiesUndelivered + liabilitiesQueuedPayouts + liabilitiesManualAdvances
const spentOnBundles = Math.max(0, expect.supplierCostCompleted - 200 /* reimbursement logged */)
const freeToSpend = expectedAtPaystack - liabilitiesTotal - spentOnBundles

const ledgerProfit =
  expect.revenueAllPaid -
  expect.supplierCostCompleted -
  expect.paystackFeeAllPaid -
  expect.agentMarginEarned -
  expect.ledgerRefundReversal

console.log('\n=== EXPECTED VALUES - compare against the live app, not this script ===')
console.log(
  JSON.stringify(
    {
      expectedAtPaystack,
      liabilities: {
        agentEarnings: liabilitiesAgent,
        customerMoney: liabilitiesCustomer,
        undeliveredOrders: liabilitiesUndelivered,
        queuedPayouts: liabilitiesQueuedPayouts,
        manualRefundAdvances: liabilitiesManualAdvances,
        total: liabilitiesTotal,
      },
      spentOnBundles,
      freeToSpend,
      ledgerProfit,
      note:
        'freeToSpend and ledgerProfit will NOT match here, by exactly 1636p. The ledger books full ' +
        'revenue the moment a payment succeeds, before knowing whether the order will actually complete - ' +
        'T07 (pending refund), T10 (processing) and T11 (awaiting_approval) are all still unresolved, so ' +
        'the ledger counts their revenue as earned (net of fee, +600 each = +1800) while freeToSpend correctly ' +
        'holds all three back as liabilities not yet free (-1836 net once the fee-loss on each is included). ' +
        'The capital_in_reimbursement (200p) then makes freeToSpend 200p LESS pessimistic than that alone would, ' +
        'since that portion of spentOnBundles has genuinely already been paid back - 1836-200=1636. ' +
        'T08 (real refund) and T09 (manual refund) both net to exactly -12 either way - a resolved refund, ' +
        'whichever path it took, costs exactly the lost Paystack fee and nothing more, on both sides equally.',
    },
    null,
    2,
  ),
)

await prisma.$disconnect()
process.exit(0)
