import { ConfigService } from '@nestjs/config'

/**
 * A link back to the app for an email to send someone to, preferring the
 * sender's own trusted browser origin over the static `PUBLIC_APP_URL`
 * config value. Without this, every email pointed at production even when
 * whoever triggered it (an admin escalating something, sending an
 * announcement) was actually looking at staging or a local dev build.
 *
 * Never trusted blindly. `origin` is a request header a client controls, so
 * it only wins here when it exactly matches one of the origins this API
 * already trusts for CORS, the same allowlist a browser itself would need
 * to satisfy to call this endpoint at all (see `main.ts`'s CORS setup).
 * Anything else, missing, malformed, or simply not on the list, falls back
 * to `PUBLIC_APP_URL`.
 */
export function appUrl(config: ConfigService, path: string, origin?: string): string {
  // Same default `main.ts` uses when building the actual CORS allowlist.
  // This has to mirror that exactly, or "trusted" here would mean
  // something subtly different from what the server actually accepts.
  const trustedOrigins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const base =
    origin && trustedOrigins.includes(origin)
      ? origin.replace(/\/$/, '')
      : (config.get<string>('PUBLIC_APP_URL')?.trim() || 'http://localhost:5173').replace(/\/$/, '')
  return `${base}${path}`
}
