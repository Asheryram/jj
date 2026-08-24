import type { Role } from '../data/types'

/**
 * Does this role satisfy an admin check?
 *
 * The frontend mirror of `satisfies` in the server's auth guard: a superadmin
 * passes every admin gate, and an admin never passes a superadmin one. Written
 * once because the raw comparison is the bug — `role === 'admin'` silently
 * excludes the operator who runs the platform, and the symptom is never an
 * error. It is an admin screen that loads with no data, or a superadmin being
 * shown a customer's wallet balance, both of which look like something else.
 */
export function isAdmin(role: Role | undefined | null): boolean {
  return role === 'admin' || role === 'superadmin'
}
