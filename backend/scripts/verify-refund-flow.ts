/**
 * Prove that a failed paid order queues a refund and pays nothing until approved.
 *
 * Uses a wallet order, which is the only way to get a genuinely paid order to fail
 * on demand without spending real money at a provider: the wallet is credited from
 * a real Paystack top-up already on the books, the admin failure switch makes the
 * delivery fail, and the whole refund path runs for real.
 *
 * Run with: npx tsx scripts/verify-refund-flow.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const API = 'http://localhost:3001/api'
const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin' } })
  const customer = await prisma.user.findFirstOrThrow({
    where: { email: 'paystack-chain@example.com' },
  })

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: process.env.SEED_PASSWORD ?? 'demo1234' }),
  }).then((r) => r.json() as Promise<{ accessToken: string }>)
  const auth = { Authorization: `Bearer ${login.accessToken}` }

  // Make the next delivery fail, so a paid order fails without touching DataHub.
  await fetch(`${API}/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ key: 'simulateFailure', value: true }),
  })

  const product = await prisma.product.findFirstOrThrow({
    where: { active: true, standardPrice: { lte: customer.balance } },
    orderBy: { standardPrice: 'asc' },
  })

  // Sign the customer in so the order is paid from their wallet.
  const asCustomer = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: customer.email, password: 'not-a-login' }),
  })
  // The seeded test customer has no usable password, so drive the wallet debit
  // through the database instead and place the order as a guest-with-wallet is
  // impossible — use the order API with a token minted for them.
  if (!asCustomer.ok) {
    console.log('(test customer has no password — setting one)')
    const bcrypt = await import('bcryptjs')
    await prisma.user.update({
      where: { id: customer.id },
      data: { passwordHash: await bcrypt.hash('refundflow123', 10) },
    })
  }

  const customerLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: customer.email, password: 'refundflow123' }),
  }).then((r) => r.json() as Promise<{ accessToken?: string; message?: string }>)

  if (!customerLogin.accessToken) {
    throw new Error(`could not sign the test customer in: ${customerLogin.message}`)
  }

  const before = (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).balance
  console.log(`customer balance before : ${ghs(before)}`)
  console.log(`buying                  : ${product.name} at ${ghs(product.standardPrice)}`)

  const order = (await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerLogin.accessToken}`,
    },
    body: JSON.stringify({
      productId: product.id,
      recipient: '0592559823',
      payWith: 'wallet',
      idempotencyKey: `refund-flow-${Date.now().toString(36)}`,
    }),
  }).then((r) => r.json())) as { reference?: string; message?: string }

  if (!order.reference) throw new Error(`order refused: ${order.message}`)
  console.log(`order                   : ${order.reference}`)

  // Let the forced failure land.
  await new Promise((resolve) => setTimeout(resolve, 6000))

  const failed = await prisma.order.findUniqueOrThrow({
    where: { reference: order.reference },
    include: { refundRequest: true },
  })
  const afterFailure = (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).balance

  console.log(`\nafter the failure`)
  console.log(`  order status          : ${failed.status}`)
  console.log(`  order.refunded        : ${failed.refunded}   (must be false — nobody approved it)`)
  console.log(`  refund request        : ${failed.refundRequest?.status ?? 'NONE'} ${failed.refundRequest ? ghs(failed.refundRequest.amount) : ''}`)
  console.log(`  customer balance      : ${ghs(afterFailure)}   (must still be down — not refunded yet)`)

  const queuedCorrectly =
    failed.status === 'failed' &&
    failed.refunded === false &&
    failed.refundRequest?.status === 'pending' &&
    afterFailure === before - product.standardPrice

  // Now approve it, as James would.
  const approved = await fetch(`${API}/admin/refunds/${failed.refundRequest?.id}/approve`, {
    method: 'POST',
    headers: auth,
  }).then((r) => r.json())
  console.log(`\napprove                 : ${JSON.stringify(approved)}`)

  const afterApproval = (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).balance
  const settled = await prisma.order.findUniqueOrThrow({
    where: { reference: order.reference },
    include: { refundRequest: true },
  })
  const ledger = await prisma.ledgerEntry.findMany({
    where: { orderRef: order.reference, kind: 'refund' },
  })

  console.log(`  order.refunded        : ${settled.refunded}   (now true)`)
  console.log(`  customer balance      : ${ghs(afterApproval)}   (whole again)`)
  console.log(`  ledger refund lines   : ${ledger.length}   (exactly 1)`)

  // Approving twice must not pay twice.
  const replay = await fetch(`${API}/admin/refunds/${failed.refundRequest?.id}/approve`, {
    method: 'POST',
    headers: auth,
  }).then((r) => r.json() as Promise<{ code?: string }>)
  const finalBalance = (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).balance
  console.log(`\napprove again           : ${replay.code ?? 'ACCEPTED — BUG'}`)
  console.log(`  customer balance      : ${ghs(finalBalance)}   (unchanged)`)

  await fetch(`${API}/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ key: 'simulateFailure', value: false }),
  })

  const paidOnce =
    settled.refunded === true &&
    afterApproval === before &&
    ledger.length === 1 &&
    replay.code === 'ALREADY_DECIDED' &&
    finalBalance === before

  console.log(`\n${queuedCorrectly && paidOnce ? 'PASS' : 'FAIL'} — queued without paying, then paid once`)
  if (!(queuedCorrectly && paidOnce)) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(String(error))
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
