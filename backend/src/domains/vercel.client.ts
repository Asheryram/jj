import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const VERCEL_API = 'https://api.vercel.com'
const TIMEOUT_MS = 10_000

export type HostingCheck =
  /** Vercel serves it, its DNS points there and it is verified. HTTPS may still be issuing. */
  | { kind: 'ready' }
  | { kind: 'waiting'; reason: string }
  | { kind: 'error'; reason: string }

/**
 * The few Vercel REST calls that attach an agent's subdomain to the shop.
 *
 * The frontend is deployed on Vercel, and Vercel only serves hostnames added
 * to the project. With one wildcard CNAME at the registrar (`*` to
 * `cname.vercel-dns.com`) every subdomain points at Vercel, but only the
 * ones added here actually load the shop; any other returns Vercel's own
 * "not found". So approving a subdomain adds it, revoking removes it.
 *
 * Optional: without `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` nothing here is
 * called, a domain is added in Vercel by hand and marked live from the
 * admin screen, exactly as before. Never throws; every failure comes back as
 * a plain-words reason for the admin screen.
 */
@Injectable()
export class VercelClient {
  private readonly log = new Logger(VercelClient.name)
  private readonly token: string
  private readonly projectId: string
  private readonly teamId: string

  constructor(config: ConfigService) {
    this.token = config.get<string>('VERCEL_TOKEN')?.trim() ?? ''
    this.projectId = config.get<string>('VERCEL_PROJECT_ID')?.trim() ?? ''
    this.teamId = config.get<string>('VERCEL_TEAM_ID')?.trim() ?? ''
  }

  get configured(): boolean {
    return Boolean(this.token && this.projectId)
  }

  /** Add a hostname to the project. Already on this project counts as success. */
  async addDomain(domain: string): Promise<{ ok: boolean; reason?: string }> {
    const response = await this.call('POST', `/v10/projects/${encodeURIComponent(this.projectId)}/domains`, { name: domain })
    if (response.ok) return { ok: true }
    if (response.status === 409 && /already/i.test(response.message) && !/another project/i.test(response.message)) {
      return { ok: true }
    }
    return { ok: false, reason: response.message }
  }

  /** Take a hostname off the project. Already gone counts as success. */
  async removeDomain(domain: string): Promise<{ ok: boolean; reason?: string }> {
    const response = await this.call('DELETE', `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(domain)}`)
    if (response.ok || response.status === 404) return { ok: true }
    return { ok: false, reason: response.message }
  }

  /** Whether Vercel has the domain, verified, with DNS pointing at it. */
  async check(domain: string): Promise<HostingCheck> {
    const project = await this.call('GET', `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(domain)}`)
    if (project.status === 404) return { kind: 'error', reason: 'Not added to hosting yet.' }
    if (!project.ok) return { kind: 'error', reason: project.message }
    const body = project.body as { verified?: boolean }
    if (!body.verified) {
      // Asks Vercel to re-check now rather than waiting for its own schedule.
      await this.call('POST', `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(domain)}/verify`)
      return { kind: 'waiting', reason: 'Hosting is verifying the domain.' }
    }
    const config = await this.call('GET', `/v6/domains/${encodeURIComponent(domain)}/config`)
    if (!config.ok) return { kind: 'error', reason: config.message }
    if ((config.body as { misconfigured?: boolean }).misconfigured) {
      return { kind: 'waiting', reason: 'DNS does not point at hosting yet (check the * CNAME record).' }
    }
    return { kind: 'ready' }
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; body: unknown; message: string }> {
    const url = `${VERCEL_API}${path}${this.teamId ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(this.teamId)}` : ''}`
    try {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      const message = json.error?.message ?? `Hosting answered ${response.status}.`
      if (!response.ok) this.log.warn(`Vercel ${method} ${path}: ${response.status} ${message}`)
      return { ok: response.ok, status: response.status, body: json, message }
    } catch (error) {
      this.log.warn(`Vercel ${method} ${path} failed: ${String(error)}`)
      return { ok: false, status: 0, body: {}, message: 'Could not reach hosting just now.' }
    }
  }
}
