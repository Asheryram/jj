import { mapProviderStatus } from './datahub.client'
import { mapGmplOrderStatus } from './gmpl.client'
import { mapNetpulseStatus } from './netpulse.client'

/**
 * Every supplier we buy from, described once.
 *
 * Before this, "which supplier" was answered by about sixty two-way branches,
 * `provider === 'gmpl' ? <GMPL thing> : <DataHub thing>`, which was fine for
 * two and wrong for three: a third supplier fell silently into every DataHub
 * branch (DataHub's API, DataHub's status words, DataHub's refund rules), with
 * nothing failing loudly.
 *
 * The rule now: anything that differs by supplier is either a field here or a
 * `Record<SupplierProviderCode, …>` at the call site. Adding a code to
 * `SupplierProviderCode` then fails to compile at every place that has to
 * decide what the new supplier does, instead of compiling and guessing.
 *
 * No Nest or Prisma imports, so settings, analytics and the clients can all
 * read it without a dependency cycle.
 */
export type SupplierProviderCode = 'datahub-gh' | 'gmpl' | 'netpulse'

export const KNOWN_PROVIDERS = ['datahub-gh', 'gmpl', 'netpulse'] as const satisfies readonly SupplierProviderCode[]

/** Our reading of a supplier's order status: final one way or the other, or not yet. */
export type MappedStatus = 'completed' | 'failed' | null

export interface ProviderInfo {
  /** Short name for screens and messages: "DataHub", "GMPL". */
  readonly label: string
  /** Fuller name for emails and float alerts: "DataHub GH". */
  readonly fullLabel: string
  /** The env var that must be exactly "true" before real orders go out. */
  readonly liveEnvKey: string
  /** Their status words, read into ours. The only place a status is compared. */
  readonly mapStatus: (status: string) => MappedStatus
  /**
   * Whether a FAILED order's charge comes back to our wallet on its own.
   * GMPL refunds every failure; DataHub keeps the charge unless it reports
   * REFUNDED (`FulfilmentService.bookProviderRefund`). Booking this wrong
   * makes the float look short, or long, by every failed order.
   */
  readonly refundsFailedCharge: boolean
  /**
   * Whether their purchase call needs `capacityGb` as well as `networkKey`.
   * DataHub takes a network key plus a size; GMPL takes only a bundle id,
   * stored in `networkKey`. See `hasAutomatedFulfilment`.
   */
  readonly needsCapacity: boolean
  /**
   * Whether this supplier refuses numbers that are not on its approved list
   * (DataHub's beneficiary list, GMPL's MTN Up2U). Only these take part in
   * the number-approval flow, see `ApprovalProvider`.
   */
  readonly numberApproval: boolean
  /** Networks that may be routed to them. Null means any. */
  readonly networks: readonly string[] | null
  /** Product categories that may be routed to them. Null means any. */
  readonly categories: readonly string[] | null
}

export const PROVIDERS: Readonly<Record<SupplierProviderCode, ProviderInfo>> = {
  'datahub-gh': {
    label: 'DataHub',
    fullLabel: 'DataHub GH',
    liveEnvKey: 'DATAHUB_LIVE',
    mapStatus: mapProviderStatus,
    refundsFailedCharge: false,
    needsCapacity: true,
    numberApproval: true,
    networks: null,
    categories: null,
  },
  gmpl: {
    label: 'GMPL',
    fullLabel: 'GMPL',
    liveEnvKey: 'GMPL_LIVE',
    mapStatus: mapGmplOrderStatus,
    refundsFailedCharge: true,
    needsCapacity: false,
    numberApproval: true,
    networks: ['MTN', 'Telecel'],
    categories: ['data'],
  },
  netpulse: {
    label: 'NetPulse',
    fullLabel: 'NetPulse',
    liveEnvKey: 'NETPULSE_LIVE',
    mapStatus: mapNetpulseStatus,
    // Confirmed with NetPulse, 21 Nov 2026: a failed order's charge goes back to the wallet.
    refundsFailedCharge: true,
    // `networkKey` holds their exact capacity string, all `/purchase` needs with the network.
    needsCapacity: false,
    // No approved-numbers list in their API.
    numberApproval: false,
    networks: ['MTN', 'Telecel', 'AirtelTigo'],
    categories: ['data'],
  },
}

/** The suppliers that run a number-approval list. Approval code is typed to these alone. */
export type ApprovalProvider = 'datahub-gh' | 'gmpl'

export function isApprovalProvider(provider: SupplierProviderCode): provider is ApprovalProvider {
  return PROVIDERS[provider].numberApproval
}

export function isProvider(value: unknown): value is SupplierProviderCode {
  return typeof value === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(value)
}

/**
 * A stored provider string, checked.
 *
 * Null or empty is DataHub: rows written before GMPL existed carry no provider,
 * and DataHub was the only supplier then. Anything else that is not a known
 * code throws, rather than being treated as DataHub and sent to DataHub's API.
 */
export function asProvider(value: string | null | undefined): SupplierProviderCode {
  if (value == null || value === '') return 'datahub-gh'
  if (isProvider(value)) return value
  throw new Error(`Unknown supplier "${value}". Add it to PROVIDERS before using it.`)
}

/** "DataHub", "GMPL", or the raw code for something not (yet) in `PROVIDERS`. */
export function providerName(provider: string | null | undefined): string {
  return isProvider(provider) ? PROVIDERS[provider].label : (provider ?? '')
}

/** Why a network/category cannot be routed to this supplier, or null if it can. */
export function routingRefusal(provider: SupplierProviderCode, network: string, category: string): string | null {
  const info = PROVIDERS[provider]
  if (info.networks && !info.networks.includes(network)) {
    return `${info.label} doesn't sell ${network}, route it to another supplier.`
  }
  if (info.categories && !info.categories.includes(category)) {
    return `${info.label} only sells ${info.categories.join(' and ')}, route other categories to another supplier.`
  }
  return null
}
