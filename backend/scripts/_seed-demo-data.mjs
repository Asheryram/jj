import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const ADMIN_ID = 'dd9dc161-2741-4eee-9a53-b3fb52accc53' // James
const AGENT_ID = '043dd2ee-8fe1-4edd-a9e5-e71caacd3d9a' // Platform operator, agent, code PLATFO90
const AGENT_CODE = 'PLATFO90'
const AGENT_NAME = 'Platform operator'

const FEE_BP = 200 // matches admin/settings paystackFeeBp
const fee = (subtotal) => Math.ceil((subtotal * FEE_BP) / 10_000)
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000)

const key = (...parts) => parts.filter(Boolean).join(':')

async function main() {
  console.log('Seeding demo transactions — leaves the users table untouched.')

  // ── Order 2: direct sale, MTN 2GB, clean (no catalogue diff) ──────────────
  await directSale({
    ref: 'JDC-204718',
    productId: 'mtn-data-2gb',
    productName: '2GB Data',
    network: 'MTN',
    supplierCode: 'DH-YELLO-2GB',
    supplierCost: 950,
    standardPrice: 1212,
    actualCost: 950,
    buyerPhone: '0244991122',
    createdAt: daysAgo(25),
  })

  // ── Order 3: direct sale, MTN 5GB, supplier charged LESS than the catalogue (extra profit) ──
  await directSale({
    ref: 'JDC-317552',
    productId: 'mtn-data-5gb',
    productName: '5GB Data',
    network: 'MTN',
    supplierCode: 'DH-YELLO-5GB',
    supplierCost: 2250,
    standardPrice: 2870,
    actualCost: 2100,
    buyerPhone: '0244882233',
    createdAt: daysAgo(20),
  })

  // ── Order 4: direct sale, Telecel 10GB, supplier charged MORE than the catalogue (a real loss) ──
  await directSale({
    ref: 'JDC-458821',
    productId: 'telecel-data-10gb',
    productName: '10GB Data',
    network: 'Telecel',
    supplierCode: 'DH-TELECEL-10GB',
    supplierCost: 4200,
    standardPrice: 5358,
    actualCost: 4500,
    buyerPhone: '0201778899',
    createdAt: daysAgo(15),
  })

  // ── Order 5: agent sale via PLATFO90, MTN 3GB, clean ──────────────────────
  await agentSale({
    ref: 'JDC-663012',
    productId: 'mtn-data-3gb',
    productName: '3GB Data',
    network: 'MTN',
    supplierCode: 'DH-YELLO-3GB',
    supplierCost: 1400,
    adminPrice: 1643,
    agentResalePrice: 1900,
    actualCost: 1400,
    buyerPhone: '0244556677',
    createdAt: daysAgo(6),
  })

  // ── Order 6: agent sale via PLATFO90, MTN 1GB, same catalogue gap as the real order (extra profit) ──
  await agentSale({
    ref: 'JDC-771904',
    productId: 'mtn-data-1gb',
    productName: '1GB Data',
    network: 'MTN',
    supplierCode: 'DH-YELLO-1GB',
    supplierCost: 470,
    adminPrice: 552,
    agentResalePrice: 650,
    actualCost: 420,
    buyerPhone: '0244334455',
    createdAt: daysAgo(3),
  })

  // ── Order 7: paid, then DataHub rejected — pending refund, network already known ──
  await failedOrder({
    ref: 'JDC-829140',
    productId: 'mtn-data-8gb',
    productName: '8GB Data',
    network: 'MTN',
    supplierCost: 3600,
    standardPrice: 4592,
    reason: 'They are temporarily unable to supply this bundle.',
    buyerPhone: '0244123456',
    paymentNetwork: 'MTN',
    createdAt: daysAgo(1),
    approveRefund: false,
  })

  // ── Order 8: paid, then rejected, refund already approved and paid back ──
  await failedOrder({
    ref: 'JDC-905337',
    productId: 'mtn-data-1gb',
    productName: '1GB Data',
    network: 'MTN',
    supplierCost: 470,
    standardPrice: 600,
    reason: 'No automated fulfilment for this bundle.',
    buyerPhone: '0201234567',
    paymentNetwork: 'Telecel',
    createdAt: daysAgo(12),
    approveRefund: true,
  })

  console.log('Done.')
}

async function directSale({
  ref,
  productId,
  productName,
  network,
  supplierCode,
  supplierCost,
  standardPrice,
  actualCost,
  buyerPhone,
  createdAt,
}) {
  const orderId = randomUUID()
  const adminMargin = standardPrice - supplierCost
  const subtotal = supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const completedAt = new Date(createdAt.getTime() + 5 * 60_000)

  const split = {
    supplierCost,
    shares: [
      {
        userId: ADMIN_ID,
        name: 'James',
        role: 'admin',
        depth: 0,
        paid: supplierCost,
        charged: standardPrice,
        margin: adminMargin,
      },
    ],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId,
      reference: ref,
      productId,
      productName,
      network,
      category: 'data',
      recipient: buyerPhone,
      salePrice,
      split,
      status: 'completed',
      paidWith: 'momo',
      buyer: 'Guest',
      buyerPhone,
      providerReference: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
      createdAt,
      completedAt,
    },
  })

  await prisma.payment.create({
    data: {
      reference: ref,
      purpose: 'order',
      status: 'paid',
      amount: salePrice,
      orderId,
      channel: 'mobile_money',
      network,
      fee: processingFee,
      providerId: String(Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)),
      paidAt: createdAt,
      createdAt,
    },
  })

  await prisma.supplierDispatch.create({
    data: {
      orderId,
      orderRef: ref,
      supplierCode,
      recipient: buyerPhone,
      costPrice: supplierCost,
      outcome: 'pending',
      simulated: true,
      providerReference: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
      providerStatus: 'SUCCESSFUL',
      providerCharged: actualCost,
      createdAt: completedAt,
    },
  })

  await prisma.ledgerEntry.createMany({
    data: [
      {
        idempotencyKey: key('order', ref, 'revenue'),
        kind: 'revenue',
        amount: salePrice,
        affectsProfit: true,
        description: `Sale · ${productName}`,
        orderRef: ref,
        paymentRef: ref,
        occurredAt: createdAt,
      },
      {
        idempotencyKey: key('payment', ref, 'fee'),
        kind: 'payment_fee',
        amount: -processingFee,
        affectsProfit: true,
        description: 'Paystack fee · mobile_money',
        paymentRef: ref,
        occurredAt: createdAt,
      },
      {
        idempotencyKey: key('order', ref, 'supplier_cost'),
        kind: 'supplier_cost',
        amount: -actualCost,
        affectsProfit: true,
        description:
          actualCost !== supplierCost
            ? `Bundle cost · ${productName} (expected ${(supplierCost / 100).toFixed(2)}, charged ${(actualCost / 100).toFixed(2)})`
            : `Bundle cost · ${productName}`,
        orderRef: ref,
        occurredAt: completedAt,
      },
    ],
  })

  console.log(`  direct  ${ref}  ${productName}  sale=${salePrice}p  true profit=${salePrice - actualCost - processingFee}p`)
}

async function agentSale({
  ref,
  productId,
  productName,
  network,
  supplierCode,
  supplierCost,
  adminPrice,
  agentResalePrice,
  actualCost,
  buyerPhone,
  createdAt,
}) {
  const orderId = randomUUID()
  const agentMargin = agentResalePrice - adminPrice
  const adminMargin = adminPrice - supplierCost
  const subtotal = supplierCost + agentMargin + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const completedAt = new Date(createdAt.getTime() + 5 * 60_000)

  const split = {
    supplierCost,
    shares: [
      {
        userId: AGENT_ID,
        name: AGENT_NAME,
        role: 'agent',
        depth: 0,
        paid: adminPrice,
        charged: agentResalePrice,
        margin: agentMargin,
      },
      {
        userId: ADMIN_ID,
        name: 'James',
        role: 'admin',
        depth: 2,
        paid: supplierCost,
        charged: adminPrice,
        margin: adminMargin,
      },
    ],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId,
      reference: ref,
      productId,
      productName,
      network,
      category: 'data',
      recipient: buyerPhone,
      salePrice,
      split,
      soldByCode: AGENT_CODE,
      status: 'completed',
      paidWith: 'momo',
      buyer: 'Guest',
      buyerPhone,
      providerReference: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
      createdAt,
      completedAt,
    },
  })

  await prisma.payment.create({
    data: {
      reference: ref,
      purpose: 'order',
      status: 'paid',
      amount: salePrice,
      orderId,
      channel: 'mobile_money',
      network,
      fee: processingFee,
      providerId: String(Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)),
      paidAt: createdAt,
      createdAt,
    },
  })

  await prisma.supplierDispatch.create({
    data: {
      orderId,
      orderRef: ref,
      supplierCode,
      recipient: buyerPhone,
      costPrice: supplierCost,
      outcome: 'pending',
      simulated: true,
      providerReference: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
      providerStatus: 'SUCCESSFUL',
      providerCharged: actualCost,
      createdAt: completedAt,
    },
  })

  await prisma.ledgerEntry.createMany({
    data: [
      {
        idempotencyKey: key('order', ref, 'revenue'),
        kind: 'revenue',
        amount: salePrice,
        affectsProfit: true,
        description: `Sale · ${productName}`,
        orderRef: ref,
        paymentRef: ref,
        occurredAt: createdAt,
      },
      {
        idempotencyKey: key('payment', ref, 'fee'),
        kind: 'payment_fee',
        amount: -processingFee,
        affectsProfit: true,
        description: 'Paystack fee · mobile_money',
        paymentRef: ref,
        occurredAt: createdAt,
      },
      {
        idempotencyKey: key('order', ref, 'supplier_cost'),
        kind: 'supplier_cost',
        amount: -actualCost,
        affectsProfit: true,
        description:
          actualCost !== supplierCost
            ? `Bundle cost · ${productName} (expected ${(supplierCost / 100).toFixed(2)}, charged ${(actualCost / 100).toFixed(2)})`
            : `Bundle cost · ${productName}`,
        orderRef: ref,
        occurredAt: completedAt,
      },
      {
        idempotencyKey: key('order', ref, 'agent_margin', AGENT_ID),
        kind: 'agent_margin',
        amount: -agentMargin,
        affectsProfit: true,
        description: `Agent margin · ${AGENT_NAME}`,
        orderRef: ref,
        userId: AGENT_ID,
        occurredAt: completedAt,
      },
    ],
  })

  const updated = await prisma.user.update({
    where: { id: AGENT_ID },
    data: { balance: { increment: agentMargin } },
    select: { balance: true },
  })

  await prisma.earning.create({
    data: {
      userId: AGENT_ID,
      type: 'sale',
      amount: agentMargin,
      balanceAfter: updated.balance,
      description: `Your sale · ${productName} → ${buyerPhone}`,
      productName,
      reference: ref,
      depth: 0,
      createdAt: completedAt,
    },
  })

  console.log(
    `  agent   ${ref}  ${productName}  sale=${salePrice}p  agent margin=${agentMargin}p  admin true profit=${salePrice - actualCost - processingFee - agentMargin}p`,
  )
}

async function failedOrder({
  ref,
  productId,
  productName,
  network,
  supplierCost,
  standardPrice,
  reason,
  buyerPhone,
  paymentNetwork,
  createdAt,
  approveRefund,
}) {
  const orderId = randomUUID()
  const adminMargin = standardPrice - supplierCost
  const subtotal = supplierCost + adminMargin
  const processingFee = fee(subtotal)
  const salePrice = subtotal + processingFee
  const failedAt = new Date(createdAt.getTime() + 5 * 60_000)

  const split = {
    supplierCost,
    shares: [
      {
        userId: ADMIN_ID,
        name: 'James',
        role: 'admin',
        depth: 0,
        paid: supplierCost,
        charged: standardPrice,
        margin: adminMargin,
      },
    ],
    processingFee,
  }

  await prisma.order.create({
    data: {
      id: orderId,
      reference: ref,
      productId,
      productName,
      network,
      category: 'data',
      recipient: buyerPhone,
      salePrice,
      split,
      status: 'failed',
      refunded: approveRefund,
      paidWith: 'momo',
      buyer: 'Guest',
      buyerPhone,
      providerReference: String(Math.floor(1_000_000 + Math.random() * 8_000_000)),
      createdAt,
      completedAt: null,
    },
  })

  await prisma.payment.create({
    data: {
      reference: ref,
      purpose: 'order',
      status: 'paid',
      amount: salePrice,
      orderId,
      channel: 'mobile_money',
      network: paymentNetwork,
      fee: processingFee,
      providerId: String(Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)),
      paidAt: createdAt,
      createdAt,
    },
  })

  await prisma.supplierDispatch.create({
    data: {
      orderId,
      orderRef: ref,
      supplierCode: 'DH-YELLO-8GB',
      recipient: buyerPhone,
      costPrice: supplierCost,
      outcome: 'rejected',
      reason,
      simulated: true,
      createdAt: failedAt,
    },
  })

  // Revenue and the Paystack fee are booked the moment the payment is
  // confirmed — before fulfilment is even attempted — the same as the live
  // code does. No supplier_cost or agent_margin: nothing was actually
  // delivered.
  await prisma.ledgerEntry.createMany({
    data: [
      {
        idempotencyKey: key('order', ref, 'revenue'),
        kind: 'revenue',
        amount: salePrice,
        affectsProfit: true,
        description: `Sale · ${productName}`,
        orderRef: ref,
        paymentRef: ref,
        occurredAt: createdAt,
      },
      {
        idempotencyKey: key('payment', ref, 'fee'),
        kind: 'payment_fee',
        amount: -processingFee,
        affectsProfit: true,
        description: 'Paystack fee · mobile_money',
        paymentRef: ref,
        occurredAt: createdAt,
      },
    ],
  })

  const refundId = randomUUID()
  await prisma.refundRequest.create({
    data: {
      id: refundId,
      orderId,
      orderRef: ref,
      productName,
      buyerName: 'Guest',
      buyerPhone,
      amount: salePrice,
      method: 'transfer',
      reason,
      status: approveRefund ? 'approved' : 'pending',
      momoNetwork: paymentNetwork,
      transferStatus: approveRefund ? 'success' : null,
      paidAt: approveRefund ? failedAt : null,
      decidedAt: approveRefund ? failedAt : null,
      decidedBy: approveRefund ? ADMIN_ID : null,
      createdAt: failedAt,
    },
  })

  if (approveRefund) {
    await prisma.ledgerEntry.create({
      data: {
        idempotencyKey: key('order', ref, 'refund'),
        kind: 'refund',
        amount: -salePrice,
        affectsProfit: true,
        description: `Refund · ${productName}`,
        orderRef: ref,
        occurredAt: failedAt,
      },
    })
  }

  console.log(
    `  failed  ${ref}  ${productName}  sale=${salePrice}p  refund=${approveRefund ? 'approved & paid' : 'pending'}`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
