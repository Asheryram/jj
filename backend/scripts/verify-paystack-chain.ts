/**
 * Prove the paid path against a real Paystack transaction.
 *
 * A transaction our app has already `initialize`d cannot be completed through the
 * API — Paystack owns that reference and only their checkout page can finish it,
 * which is exactly the duplicate protection we rely on. So this goes the other
 * way round: charge a fresh reference with their documented test card, then hand
 * that reference to our own confirm path and check what it does with it.
 *
 * A top-up rather than an order, deliberately: it exercises the same `applyPaid`
 * code without dispatching anything to DataHub, so no supplier float is spent
 * proving a payment works.
 *
 * Run with: npx tsx scripts/verify-paystack-chain.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const API = 'http://localhost:3001/api'
const KEY = process.env.PAYSTACK_SECRET_KEY
const AMOUNT = 1000 // GHS 10.00 in pesewas

async function paystack(path: string, body: unknown) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  return (await response.json()) as {
    status?: boolean
    message?: string
    data?: { status?: string; reference?: string; gateway_response?: string }
  }
}

async function main() {
  if (!KEY?.startsWith('sk_test')) {
    throw new Error('Refusing to run: this needs a Paystack TEST key.')
  }

  // Somebody to credit. Reused across runs so this does not litter the database.
  const email = 'paystack-chain@example.com'
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: {
        name: 'Paystack Chain Test',
        email,
        phone: '0209999001',
        passwordHash: 'not-a-login',
        role: 'customer',
        referralCode: 'PSKTEST',
        status: 'active',
      },
    }))

  const before = user.balance
  const reference = `TOPTEST-${Date.now().toString(36).toUpperCase()}`

  console.log(`user balance before : GHS ${(before / 100).toFixed(2)}`)
  console.log(`reference           : ${reference}`)

  // 1 — a real charge at Paystack, with their test card.
  let result = await paystack('/charge', {
    email,
    amount: AMOUNT,
    currency: 'GHS',
    reference,
    card: { number: '4084084084084081', cvv: '408', expiry_month: '12', expiry_year: '30' },
  })
  console.log(`charge              : ${result.data?.status ?? result.message}`)

  if (result.data?.status === 'send_pin') {
    result = await paystack('/charge/submit_pin', { pin: '0000', reference })
    console.log(`submit_pin          : ${result.data?.status ?? result.message}`)
  }
  if (result.data?.status === 'send_otp') {
    result = await paystack('/charge/submit_otp', { otp: '123456', reference })
    console.log(`submit_otp          : ${result.data?.status ?? result.message}`)
  }

  if (result.data?.status !== 'success') {
    throw new Error(`Paystack did not complete the charge: ${JSON.stringify(result).slice(0, 300)}`)
  }
  console.log(`paystack            : success (${result.data.gateway_response})`)

  // 2 — the pending expectation our checkout would have written.
  await prisma.payment.create({
    data: { reference, purpose: 'topup', amount: AMOUNT, userId: user.id },
  })

  // 3 — our own confirm path, which re-verifies with Paystack and applies it.
  const confirm = await fetch(`${API}/payments/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  })
  console.log(`our confirm         : ${JSON.stringify(await confirm.json())}`)

  // 4 — and again, because Paystack retries and customers refresh.
  const replay = await fetch(`${API}/payments/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  })
  console.log(`confirm replayed    : ${JSON.stringify(await replay.json())}`)

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  const ledger = await prisma.transaction.findMany({ where: { reference } })
  const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } })

  console.log(`\npayment status      : ${payment.status} via ${payment.channel}`)
  console.log(`user balance after  : GHS ${(after.balance / 100).toFixed(2)}`)
  console.log(`ledger rows         : ${ledger.length} (must be 1 — replay must not double-credit)`)
  console.log(
    `credited            : GHS ${((after.balance - before) / 100).toFixed(2)} of GHS ${(AMOUNT / 100).toFixed(2)}`,
  )

  const ok =
    payment.status === 'paid' && ledger.length === 1 && after.balance - before === AMOUNT
  console.log(`\n${ok ? 'PASS' : 'FAIL'} — paid once, credited once`)
}

main()
  .catch((error) => {
    console.error(String(error))
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
