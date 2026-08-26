import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { deriveBrand, type BrandRamp } from '../domain/branding'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'

/** What a shop front needs to render itself. */
export interface PublicBranding {
  shopName: string
  brandColor: string
  ramp: BrandRamp
  /**
   * The colour and ramp used on a dark background. Equal to `brandColor`/`ramp`
   * when nobody has chosen a separate one — same colour, applied through
   * whichever ramp step a dark surface calls for.
   */
  brandColorDark: string
  rampDark: BrandRamp
  /** Where to fetch the logo, or null to use the platform mark. */
  logoUrl: string | null
  /** True when this is an agent's own branding rather than the platform's. */
  custom: boolean
}

/** The platform's identity, used wherever nothing has been customised. */
const DEFAULT_NAME = 'JamesDataConsult'
const DEFAULT_COLOR = '#0B3B8F'

/**
 * A logo is capped at 100KB.
 *
 * Generous for a shop mark and small enough that holding it in a row costs
 * nothing. The cap is not about disk — it is about a 6MB phone photo being
 * uploaded as a logo, served on every page load, and read by the whole country on
 * mobile data.
 */
const MAX_LOGO_BYTES = 100 * 1024

/**
 * What an image file actually is, read from its first bytes.
 *
 * The filename and the browser's declared MIME type are both supplied by whoever
 * is uploading, so neither is evidence. This checks the signature.
 *
 * SVG is deliberately absent. It is XML that may contain `<script>`, and serving
 * one from our own origin would run it with our cookies — a stored XSS on a page
 * where customers type card details. A raster logo is a small price for that not
 * being possible.
 */
function detectImage(bytes: Buffer): string | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * Shop identity: name, logo and colour, for the platform and for each agent.
 *
 * Two rules shape this service.
 *
 * **Nothing an agent submits goes live unseen.** Their proposal is held in
 * `BrandingRequest` until the platform owner approves it. The queue exists
 * because an agent shop collects payment details, so a shop convincingly named
 * and badged as a bank or a network is a fraud risk the platform carries. The
 * owner's own branding needs no approval — it is their platform.
 *
 * **The colour ramp is derived on read, never stored.** `deriveBrand` includes a
 * contrast correction that keeps white button text readable, and freezing its
 * output into the database would leave every existing shop on whatever the rule
 * was the day they saved.
 */
@Injectable()
export class BrandingService {
  private readonly log = new Logger(BrandingService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The branding to render, for a shop reached through `sellerCode` or for the
   * platform when there is none.
   *
   * Falls back field by field rather than all-or-nothing: an agent who sets only
   * a name keeps the platform's colour, which is almost always what they meant.
   */
  async forShop(sellerCode?: string | null): Promise<PublicBranding> {
    const platform = await this.prisma.branding.findFirst({ where: { userId: null } })

    let agent: Awaited<ReturnType<typeof this.prisma.branding.findFirst>> = null
    let agentKey: string | null = null

    if (sellerCode) {
      const owner = await this.prisma.user.findFirst({
        where: { referralCode: sellerCode, role: 'agent', status: 'active' },
        select: { id: true, referralCode: true },
      })
      if (owner) {
        agent = await this.prisma.branding.findUnique({ where: { userId: owner.id } })
        agentKey = owner.referralCode
      }
    }

    const color = agent?.brandColor ?? platform?.brandColor ?? DEFAULT_COLOR
    const derived = deriveBrand(color) ?? deriveBrand(DEFAULT_COLOR)!

    // Falls all the way back to the light colour, not just to a default — a
    // shop that has not picked a dark variant still gets a working dark theme,
    // built from the one colour it does have.
    const colorDark = agent?.brandColorDark ?? platform?.brandColorDark ?? color
    const derivedDark = deriveBrand(colorDark) ?? derived

    // Only offer a logo URL when there are bytes behind it, so the client never
    // renders a broken image where a mark should be.
    const logoUrl = agent?.logoBytes
      ? `/api/branding/logo/${encodeURIComponent(agentKey ?? '')}`
      : platform?.logoBytes
        ? '/api/branding/logo/platform'
        : null

    return {
      shopName: agent?.shopName ?? platform?.shopName ?? DEFAULT_NAME,
      brandColor: derived.requested,
      ramp: derived.ramp,
      brandColorDark: derivedDark.requested,
      rampDark: derivedDark.ramp,
      logoUrl,
      custom: Boolean(agent?.shopName || agent?.brandColor || agent?.logoBytes),
    }
  }

  /** The logo bytes for a shop key: an agent's referral code, or "platform". */
  async logo(key: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const row =
      key === 'platform'
        ? await this.prisma.branding.findFirst({ where: { userId: null } })
        : await this.prisma.user
            .findFirst({
              where: { referralCode: key, role: 'agent' },
              select: { id: true },
            })
            .then((owner) =>
              owner ? this.prisma.branding.findUnique({ where: { userId: owner.id } }) : null,
            )

    if (!row?.logoBytes || !row.logoMime) return null
    return { mime: row.logoMime, bytes: Buffer.from(row.logoBytes) }
  }

  /** What an agent currently has live, plus anything they have submitted. */
  async mine(userId: string) {
    const [live, pending] = await Promise.all([
      this.prisma.branding.findUnique({ where: { userId } }),
      this.prisma.brandingRequest.findFirst({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const lastDecision = await this.prisma.brandingRequest.findFirst({
      where: { userId, status: { in: ['approved', 'rejected'] } },
      orderBy: { decidedAt: 'desc' },
      select: { status: true, note: true, decidedAt: true },
    })

    return {
      live: live
        ? {
            shopName: live.shopName,
            brandColor: live.brandColor,
            brandColorDark: live.brandColorDark,
            hasLogo: Boolean(live.logoBytes),
          }
        : null,
      pending: pending
        ? {
            id: pending.id,
            shopName: pending.shopName,
            brandColor: pending.brandColor,
            brandColorDark: pending.brandColorDark,
            hasLogo: Boolean(pending.logoBytes),
            createdAt: pending.createdAt.toISOString(),
          }
        : null,
      lastDecision: lastDecision
        ? {
            status: lastDecision.status,
            note: lastDecision.note,
            decidedAt: lastDecision.decidedAt?.toISOString() ?? null,
          }
        : null,
    }
  }

  /**
   * An agent proposes branding. Replaces any earlier unreviewed proposal.
   *
   * Replacing rather than queueing a second one: two pending proposals from one
   * agent would mean approving the older of them puts something stale live, and
   * there is no sensible order to review them in.
   */
  async submit(
    user: { id: string; name: string; referralCode: string },
    input: {
      shopName?: string
      brandColor?: string
      brandColorDark?: string
      logo?: { buffer: Buffer }
    },
  ) {
    const shopName = input.shopName?.trim()
    if (shopName !== undefined && shopName.length > 0 && shopName.length < 2) {
      throw new ValidationError('A shop name needs at least two characters.')
    }
    if (shopName && shopName.length > 40) {
      throw new ValidationError('Keep the shop name under 40 characters.')
    }

    if (input.brandColor && !deriveBrand(input.brandColor)) {
      throw new ValidationError('That is not a colour we recognise. Use a hex value like #0B3B8F.')
    }
    if (input.brandColorDark && !deriveBrand(input.brandColorDark)) {
      throw new ValidationError(
        'That dark-mode colour is not one we recognise. Use a hex value like #0B3B8F.',
      )
    }

    const logo = input.logo ? this.checkLogo(input.logo.buffer) : null

    if (!shopName && !input.brandColor && !input.brandColorDark && !logo) {
      throw new ValidationError('Change at least one thing before sending it for approval.')
    }

    const existing = await this.prisma.brandingRequest.findFirst({
      where: { userId: user.id, status: 'pending' },
    })
    if (existing) {
      await this.prisma.brandingRequest.delete({ where: { id: existing.id } })
    }

    const created = await this.prisma.brandingRequest.create({
      data: {
        userId: user.id,
        agentName: user.name,
        agentCode: user.referralCode,
        shopName: shopName || null,
        brandColor: input.brandColor ?? null,
        brandColorDark: input.brandColorDark ?? null,
        logoMime: logo?.mime ?? null,
        logoBytes: logo?.bytes ?? null,
      },
    })

    this.log.log(`${user.referralCode} submitted branding for approval`)
    return { id: created.id, status: created.status }
  }

  private checkLogo(buffer: Buffer): { mime: string; bytes: Uint8Array<ArrayBuffer> } {
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new ValidationError(
        `That image is ${Math.round(buffer.length / 1024)}KB. Keep a logo under ${MAX_LOGO_BYTES / 1024}KB so your shop loads quickly on mobile data.`,
      )
    }

    const mime = detectImage(buffer)
    if (!mime) {
      throw new ValidationError(
        'That file is not a PNG, JPEG or WebP image. SVG is not accepted because it can carry scripts.',
      )
    }

    // Prisma's `Bytes` column takes a Uint8Array over a plain ArrayBuffer. A
    // Buffer may sit on a SharedArrayBuffer, which the types will not accept, so
    // this copies into a freshly allocated one — a few kilobytes, once per
    // upload, in exchange for not casting the type away.
    const bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength))
    bytes.set(buffer)
    return { mime, bytes }
  }

  // ── The platform owner's side ─────────────────────────────────────────────

  /** Everything waiting to be reviewed, oldest first. */
  async queue(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    const rows = await this.prisma.brandingRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    return rows.map((row) => ({
      id: row.id,
      agentName: row.agentName,
      agentCode: row.agentCode,
      shopName: row.shopName,
      brandColor: row.brandColor,
      brandColorDark: row.brandColorDark,
      /** Preview URL for the submitted logo — the pending one, not the live one. */
      logoUrl: row.logoBytes ? `/api/admin/branding/requests/${row.id}/logo` : null,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    }))
  }

  /** The submitted logo, so it can be looked at before it goes live. */
  async requestLogo(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const row = await this.prisma.brandingRequest.findUnique({ where: { id } })
    if (!row?.logoBytes || !row.logoMime) return null
    return { mime: row.logoMime, bytes: Buffer.from(row.logoBytes) }
  }

  /** Approve a proposal and put it live. */
  async approve(id: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.brandingRequest.findUnique({ where: { id } })
      if (!request) throw new NotFoundError('We could not find that branding request.')
      // Guarded on the row's own state inside the transaction, so a double-click
      // cannot approve twice.
      if (request.status !== 'pending') {
        throw new ConflictError('ALREADY_DECIDED', `That request was already ${request.status}.`)
      }

      // Only the fields they actually submitted move. A proposal that changes the
      // colour must not wipe a name approved last week.
      const changes = {
        ...(request.shopName !== null ? { shopName: request.shopName } : {}),
        ...(request.brandColor !== null ? { brandColor: request.brandColor } : {}),
        ...(request.brandColorDark !== null
          ? { brandColorDark: request.brandColorDark }
          : {}),
        ...(request.logoBytes !== null
          ? { logoMime: request.logoMime, logoBytes: request.logoBytes }
          : {}),
      }

      await tx.branding.upsert({
        where: { userId: request.userId },
        create: { userId: request.userId, ...changes },
        update: changes,
      })

      await tx.brandingRequest.update({
        where: { id },
        data: { status: 'approved', decidedAt: new Date(), decidedBy: adminId },
      })

      this.log.log(`branding for ${request.agentCode} approved by ${adminId}`)
      return { id, status: 'approved' as const }
    })
  }

  /** Refuse a proposal, with a reason the agent is shown. */
  async reject(id: string, adminId: string, note: string) {
    const reason = note.trim()
    if (reason.length < 5) {
      throw new ValidationError('Tell the agent why, so they can fix it and try again.')
    }

    const request = await this.prisma.brandingRequest.findUnique({ where: { id } })
    if (!request) throw new NotFoundError('We could not find that branding request.')
    if (request.status !== 'pending') {
      throw new ConflictError('ALREADY_DECIDED', `That request was already ${request.status}.`)
    }

    await this.prisma.brandingRequest.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: adminId, note: reason },
    })

    this.log.warn(`branding for ${request.agentCode} refused by ${adminId}: ${reason}`)
    return { id, status: 'rejected' as const }
  }

  /**
   * The platform owner's own branding, applied immediately.
   *
   * No queue: it is their platform, and there is nobody above them to approve it.
   */
  async setPlatform(input: {
    shopName?: string
    brandColor?: string
    brandColorDark?: string
    logo?: { buffer: Buffer }
  }) {
    const shopName = input.shopName?.trim()
    if (shopName && shopName.length > 40) {
      throw new ValidationError('Keep the name under 40 characters.')
    }
    if (input.brandColor && !deriveBrand(input.brandColor)) {
      throw new ValidationError('That is not a colour we recognise. Use a hex value like #0B3B8F.')
    }
    if (input.brandColorDark && !deriveBrand(input.brandColorDark)) {
      throw new ValidationError(
        'That dark-mode colour is not one we recognise. Use a hex value like #0B3B8F.',
      )
    }

    const logo = input.logo ? this.checkLogo(input.logo.buffer) : null
    const existing = await this.prisma.branding.findFirst({ where: { userId: null } })

    const changes = {
      ...(shopName !== undefined ? { shopName: shopName || null } : {}),
      ...(input.brandColor ? { brandColor: input.brandColor } : {}),
      ...(input.brandColorDark ? { brandColorDark: input.brandColorDark } : {}),
      ...(logo ? { logoMime: logo.mime, logoBytes: logo.bytes } : {}),
    }

    if (existing) {
      await this.prisma.branding.update({ where: { id: existing.id }, data: changes })
    } else {
      await this.prisma.branding.create({ data: { userId: null, ...changes } })
    }

    this.log.log('platform branding updated')
    return this.forShop(null)
  }
}
