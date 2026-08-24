import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'

export interface Mail {
  to: string
  subject: string
  /** Plain text. Always sent — some mail clients and most filters prefer it. */
  text: string
  html: string
}

/**
 * Sending email, through SMTP or Resend, whichever is configured.
 *
 * ── Why two transports ───────────────────────────────────────────────────────
 *
 * Resend refuses to send to anybody but the account owner until a domain is
 * verified, and verifying a domain means owning one. That is the right long-term
 * setup and it is a hard blocker on day one — so SMTP exists as the path that
 * works with a Gmail account and no domain at all.
 *
 * SMTP wins when both are configured, because it is the one that can actually
 * reach an agent. Resend stays for the day a domain is verified: switch by
 * clearing the SMTP variables, no code change.
 *
 * ── Two rules, whichever transport is used ───────────────────────────────────
 *
 * **Sending never fails the thing that triggered it.** A password link that could
 * not be emailed is still a valid link, and an account creation that rolled back
 * because a mail server hiccuped would be worse than a message somebody hands
 * over by another route. Callers get `sent: false` and a reason.
 *
 * **Nothing is dropped silently.** With no transport at all, the message is
 * written to the log marked as unsent. Somebody waiting forever for a reset that
 * was never sent is the failure this avoids.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name)
  private transporter: Transporter | null = null

  constructor(private readonly config: ConfigService) {}

  private get smtpUser(): string | null {
    return this.config.get<string>('SMTP_USER')?.trim() || null
  }

  private get smtpPass(): string | null {
    // Not trimmed at the ends only — Gmail app passwords are shown in groups of
    // four and get pasted with spaces, which SMTP auth then rejects.
    return this.config.get<string>('SMTP_PASS')?.replace(/\s+/g, '') || null
  }

  /** SMTP is preferred: it is the transport that can reach anybody. */
  private get useSmtp(): boolean {
    return Boolean(this.smtpUser && this.smtpPass)
  }

  private get resendKey(): string | null {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || null
  }

  get configured(): boolean {
    return this.useSmtp || Boolean(this.resendKey)
  }

  /**
   * Who mail comes from.
   *
   * Over SMTP this must be the authenticated mailbox. Gmail rewrites or refuses
   * anything else, so a mismatched MAIL_FROM would either be silently replaced or
   * bounce — and both are worse than ignoring it. The display name is still ours,
   * so mail arrives as "JamesDataConsult <the.account@gmail.com>".
   */
  private get from(): string {
    const configured = this.config.get<string>('MAIL_FROM')?.trim()

    if (this.useSmtp) {
      const mailbox = this.smtpUser as string
      const name = configured?.match(/^([^<]+)</)?.[1]?.trim()
      return name ? `${name} <${mailbox}>` : `JamesDataConsult <${mailbox}>`
    }

    return configured || 'JamesDataConsult <onboarding@resend.dev>'
  }

  /** True while sending from Resend's shared domain — delivery is limited. */
  get usingSharedSender(): boolean {
    return !this.useSmtp && this.from.includes('onboarding@resend.dev')
  }

  async send(mail: Mail): Promise<{ sent: boolean; reason?: string }> {
    if (this.useSmtp) {
      const result = await this.sendOverSmtp(mail)
      if (result.sent) return result

      /**
       * SMTP failed. Try Resend rather than give up.
       *
       * Container platforms routinely block outbound SMTP, and the failure is
       * not a configuration mistake anybody can fix from here: the port simply
       * does not answer. Where a Resend key exists it reaches the same inbox
       * over HTTPS, which no host blocks. Nothing was delivered on the failed
       * attempt, so this cannot duplicate a message.
       */
      if (this.resendKey) {
        this.log.warn(`SMTP failed (${result.reason ?? 'no reason given'}) — trying Resend`)
      } else {
        this.logUnsent(mail, result.reason ?? 'SMTP refused it')
        return result
      }
    }

    if (!this.resendKey) {
      this.logUnsent(mail, 'no SMTP_USER/SMTP_PASS and no RESEND_API_KEY configured')
      return { sent: false, reason: 'Email is not configured on this server.' }
    }

    const first = await this.sendOverResend(mail, this.from)
    if (first.sent) return first

    /**
     * One retry from Resend's shared sender, when the configured domain is not
     * verified.
     *
     * Narrow on purpose. Resend lets that sender reach only the address owning
     * the account, so this rescues the operator's own setup and reset links on a
     * platform whose domain is not set up — and cannot quietly deliver customer
     * mail from the wrong address, because Resend refuses that too.
     */
    if (first.unverifiedDomain && !this.usingSharedSender) {
      this.log.warn(
        `${this.from} is not a verified Resend domain. Retrying from onboarding@resend.dev, ` +
          'which reaches only your own Resend account address.',
      )
      const retry = await this.sendOverResend(mail, 'JamesDataConsult <onboarding@resend.dev>')
      if (retry.sent) return retry
    }

    this.logUnsent(mail, first.reason ?? 'refused')
    return { sent: false, reason: first.reason }
  }

  /**
   * SMTP, over an implicit-TLS connection on 465.
   *
   * The transporter is built once and kept: it pools connections, and rebuilding
   * per message means a fresh TLS handshake and login for every email.
   */
  private async sendOverSmtp(mail: Mail): Promise<{ sent: boolean; reason?: string }> {
    try {
      this.transporter ??= createTransport({
        host: this.config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com',
        port: Number(this.config.get<string>('SMTP_PORT') ?? 465),
        // 465 is TLS from the first byte. 587 negotiates it afterwards, which
        // nodemailer handles when `secure` is false.
        secure: Number(this.config.get<string>('SMTP_PORT') ?? 465) === 465,
        auth: { user: this.smtpUser as string, pass: this.smtpPass as string },

        /**
         * Fail in seconds, not minutes.
         *
         * Without these, nodemailer inherits the OS timeout: a blocked SMTP port
         * hangs for around two minutes. That is long enough to delay startup —
         * the boot email is awaited — so a mail problem became a deploy that
         * looked stalled and failed six health checks before answering. Mail is
         * not important enough to hold the API's boot; better to give up quickly
         * and log the link.
         */
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      })

      await this.transporter.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })

      this.log.log(`sent "${mail.subject}" to ${mail.to} over SMTP as ${this.smtpUser}`)
      return { sent: true }
    } catch (error) {
      const message = String((error as Error)?.message ?? error)

      // The two failures worth naming, because neither message says what to do.
      const reason = /invalid login|username and password not accepted|535/i.test(message)
        ? 'The mail server rejected the login. A Gmail account needs an App Password (16 characters, created after turning on 2-Step Verification) — not the normal account password.'
        : /limit|quota|550/i.test(message)
          ? 'The mail account has hit its sending limit for now. A free Gmail account allows roughly 500 messages a day.'
          : `SMTP failed: ${message}`

      this.log.error(`mail to ${mail.to} failed over SMTP: ${message.slice(0, 300)}`)
      // Dropped so the next attempt reconnects rather than reusing a dead socket.
      this.transporter = null
      return { sent: false, reason }
    }
  }

  private async sendOverResend(
    mail: Mail,
    from: string,
  ): Promise<{ sent: boolean; reason?: string; unverifiedDomain?: boolean }> {
    const key = this.resendKey
    if (!key) return { sent: false, reason: 'Email is not configured on this server.' }

    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      return { sent: false, reason: `We could not reach the email service: ${String(error)}` }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      // Their most common refusal deserves naming: an unverified domain reads as
      // a permissions error rather than as a setup step.
      const unverifiedDomain = /domain is not verified|only send testing emails/i.test(body)
      const reason = unverifiedDomain
        ? 'Resend refused it: the sending domain is not verified, so mail can only reach your own Resend account address.'
        : `Resend returned ${response.status}.`
      this.log.error(`mail to ${mail.to} refused by Resend: ${body.slice(0, 300)}`)
      return { sent: false, reason, unverifiedDomain }
    }

    this.log.log(`sent "${mail.subject}" to ${mail.to} from ${from}`)
    return { sent: true }
  }

  /**
   * The message, in the log, clearly marked as not delivered.
   *
   * Deliberately includes the body: with no working transport this is the only
   * way the operator gets the link somebody is waiting for.
   */
  private logUnsent(mail: Mail, why: string): void {
    this.log.warn(
      [
        '',
        '── EMAIL NOT SENT ────────────────────────────────────────────────',
        ` reason  : ${why}`,
        ` to      : ${mail.to}`,
        ` subject : ${mail.subject}`,
        '',
        mail.text,
        '──────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
  }
}
