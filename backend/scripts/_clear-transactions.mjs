/**
 * Clears every transactional record — orders, payments, dispatches, ledger
 * entries, earnings, withdrawals, refunds — and resets agent/customer wallet
 * balances and float/solvency tracking state back to a blank slate.
 *
 * Deliberately leaves untouched: the users table (rows, roles, phones — per
 * instruction), the product/supplier catalogue, agent custom prices,
 * branding, and every configuration setting (paystackFeeBp, minWithdrawal,
 * paystackBusinessAccount, floatWatchAt/RiskAt, agentsAutoApprove, etc.) —
 * those are deliberate configuration, not transaction history.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const STATE_SETTING_KEYS = [
  'supplierFloat',
  'supplierFloatAlertLevel',
  'supplierFloatCapitalBaseline',
  'supplierFloatDiscrepancyAlerted',
  'solvencyBalanceMismatchAlerted',
]

await prisma.$transaction([
  prisma.supplierDispatch.deleteMany(),
  prisma.ledgerEntry.deleteMany(),
  prisma.refundRequest.deleteMany(),
  prisma.claimableCredit.deleteMany(),
  prisma.beneficiaryRequest.deleteMany(),
  prisma.withdrawal.deleteMany(),
  prisma.earning.deleteMany(),
  prisma.transaction.deleteMany(),
  prisma.payment.deleteMany(),
  prisma.order.deleteMany(),
  prisma.setting.deleteMany({ where: { key: { in: STATE_SETTING_KEYS } } }),
  prisma.user.updateMany({ data: { balance: 0 } }),
])

const counts = await Promise.all([
  prisma.order.count(),
  prisma.payment.count(),
  prisma.ledgerEntry.count(),
  prisma.withdrawal.count(),
  prisma.refundRequest.count(),
  prisma.earning.count(),
  prisma.user.count(),
  prisma.product.count(),
])

console.log(
  JSON.stringify(
    {
      orders: counts[0],
      payments: counts[1],
      ledgerEntries: counts[2],
      withdrawals: counts[3],
      refundRequests: counts[4],
      earnings: counts[5],
      usersKept: counts[6],
      productsKept: counts[7],
    },
    null,
    2,
  ),
)

await prisma.$disconnect()
process.exit(0)
