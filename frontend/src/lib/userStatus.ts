import type { UserStatus } from '../data/types'

/**
 * What each account status is called, and how it looks.
 *
 * Shared because it was written twice and wrong once. Every screen that renders a
 * status used `status === 'active' ? 'Active' : 'Suspended'`, which silently
 * reported the two states nobody had looked at yet — `pending` and `rejected` — as
 * an account somebody had stopped. Telling an admin that a waiting applicant was
 * suspended is not a cosmetic problem: it is the difference between "approve this
 * person" and "somebody already turned them down".
 */
export const STATUS_LABEL: Record<UserStatus, string> = {
  pending: 'Awaiting approval',
  active: 'Active',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

export const STATUS_TONE: Record<UserStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  active: 'success',
  rejected: 'neutral',
  suspended: 'danger',
}
