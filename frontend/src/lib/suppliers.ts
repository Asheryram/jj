/**
 * Every supplier the admin screens can show, described once. Mirrors
 * `backend/src/supplier/providers.ts`.
 *
 * Screens used to spell out `'datahub-gh' | 'gmpl'` and
 * `p === 'gmpl' ? 'GMPL' : 'DataHub'` dozens of times, so a third supplier
 * would have shown as "DataHub" everywhere. Lists come from `SUPPLIERS`,
 * names from `supplierName`; a new supplier is added here and nowhere else.
 */
export type SupplierCode = 'datahub-gh' | 'gmpl' | 'netpulse'

export interface SupplierInfo {
  code: SupplierCode
  /** Short name: "DataHub", "GMPL". */
  label: string
  /** Fuller name for float and treasury screens: "DataHub GH". */
  fullLabel: string
  /** Its balance can be checked on demand, not only from an order reply. */
  liveBalance: boolean
  /** Networks it sells, null for all. Used to hide routing choices it cannot take. */
  networks: string[] | null
}

export const SUPPLIERS: SupplierInfo[] = [
  { code: 'datahub-gh', label: 'DataHub', fullLabel: 'DataHub GH', liveBalance: false, networks: null },
  { code: 'gmpl', label: 'GMPL', fullLabel: 'GMPL', liveBalance: true, networks: ['MTN', 'Telecel'] },
  { code: 'netpulse', label: 'NetPulse', fullLabel: 'NetPulse', liveBalance: true, networks: null },
]

export const SUPPLIER_CODES: SupplierCode[] = SUPPLIERS.map((s) => s.code)

const byCode = new Map(SUPPLIERS.map((s) => [s.code as string, s]))

export function supplierInfo(code: string | null | undefined): SupplierInfo | undefined {
  // No supplier on a row means DataHub, the only supplier before GMPL.
  return byCode.get(code ?? 'datahub-gh')
}

/** "DataHub" / "GMPL" (or "DataHub GH" with `full`), the raw code for one we do not know. */
export function supplierName(code: string | null | undefined, full = false): string {
  const info = supplierInfo(code)
  if (!info) return code ?? ''
  return full ? info.fullLabel : info.label
}

/** Whether this supplier sells this network, for routing choices. */
export function sellsNetwork(code: SupplierCode, network: string): boolean {
  const networks = supplierInfo(code)?.networks
  return !networks || networks.includes(network)
}

/**
 * Suppliers as answers to "where did you send it?", the one it went to first
 * listed first and marked, so the admin picks one deliberately instead of
 * leaving a toggle on its default.
 */
export function supplierChoices(
  original: string | null | undefined,
  only?: (code: SupplierCode) => boolean,
): { value: SupplierCode; title: string; detail: string }[] {
  const first = supplierInfo(original)?.code ?? null
  const list = SUPPLIERS.filter((s) => !only || only(s.code))
  return [...list.filter((s) => s.code === first), ...list.filter((s) => s.code !== first)].map((s) => ({
    value: s.code,
    title: s.code === first ? `${s.label} (same as before)` : s.label,
    detail:
      s.code === first
        ? 'The supplier it was sent to the first time.'
        : `A different supplier${first ? ` from the first time (${supplierInfo(first)?.label})` : ''}. Its cost comes out of the ${s.label} balance.`,
  }))
}
