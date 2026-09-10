import type { Mail } from './mailer.service'

/**
 * The messages the platform sends.
 *
 * Kept together and kept plain. Every one is a transactional message that exists
 * to get somebody to do one thing, so each has a single obvious action and no
 * marketing around it — a password link buried under a banner reads like phishing,
 * which is exactly what a recipient should be suspicious of.
 *
 * Both a text and an HTML body every time. Text is not a fallback nobody sees: it
 * is what spam filters read, what a watch shows, and what survives a client that
 * blocks remote content.
 */

/**
 * Inline styles only. Email clients strip stylesheets.
 *
 * Exported so other senders — the float alert, for one — get the same card,
 * font and brand colour as a password email rather than inventing their own
 * look. One visual language for every platform email, not one per sender.
 */
export function wrap(shopName: string, heading: string, body: string, footer?: string): string {
  const defaultFooter = `You are getting this because somebody with access to ${escape(shopName)} asked us to send it.
      If that was not you, you can ignore it — nothing changes until the link is used.`
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1e293b">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
      <p style="margin:0 0 20px;font-weight:700;font-size:15px;color:#0b3b8f">${escape(shopName)}</p>
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;color:#0f172a">${escape(heading)}</h1>
      ${body}
    </div>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#64748b">
      ${footer ?? defaultFooter}
    </p>
  </body>
</html>`
}

/** A name or a URL in an attribute is untrusted input. */
export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function button(link: string, label: string): string {
  return `<p style="margin:0 0 20px">
      <a href="${escape(link)}" style="display:inline-block;background:#0b3b8f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:11px">${escape(label)}</a>
    </p>
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">Or paste this into your browser:</p>
    <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${escape(link)}" style="color:#0b3b8f">${escape(link)}</a></p>`
}

/** A brand-new account choosing its first password. */
export function setupMail(input: {
  to: string
  name: string
  shopName: string
  link: string
  invitedBy?: string
}): Mail {
  const heading = 'Set your password'
  const intro = input.invitedBy
    ? `${input.invitedBy} has set up an account for you on ${input.shopName}.`
    : `An account has been created for you on ${input.shopName}.`

  return {
    to: input.to,
    subject: `Set your ${input.shopName} password`,
    text: [
      `Hello ${input.name},`,
      '',
      intro,
      'Choose your own password using the link below. Nobody else knows it, including whoever created the account.',
      '',
      input.link,
      '',
      'The link works once and expires in 48 hours.',
    ].join('\n'),
    html: wrap(
      input.shopName,
      heading,
      `<p style="margin:0 0 8px;font-size:15px;line-height:1.6">Hello ${escape(input.name)},</p>
       <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escape(intro)} Choose your own password below — nobody else knows it, including whoever created the account.</p>
       ${button(input.link, 'Set my password')}
       <p style="margin:0;font-size:13px;color:#64748b">The link works once and expires in 48 hours.</p>`,
    ),
  }
}

/**
 * One agent's digest of every product whose price to them has moved since
 * the last one — consolidated by `PendingPriceChange`, so this is always
 * "here's what's different now," never one email per edit.
 */
export function priceChangeMail(input: {
  to: string
  name: string
  shopName: string
  changes: { name: string; network: string | null; from: number; to: number }[]
}): Mail {
  const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
  const line = (c: { name: string; network: string | null; from: number; to: number }) =>
    `${c.network ? `${c.network} ` : ''}${c.name}: ${ghs(c.from)} -> ${ghs(c.to)}` +
    (c.to > c.from ? ' (up)' : ' (down)')

  const heading =
    input.changes.length === 1 ? 'A price you pay just changed' : `${input.changes.length} prices you pay just changed`

  return {
    to: input.to,
    subject: `${input.shopName}: ${heading.toLowerCase().replace(/^a /, 'your ')}`,
    text: [
      `Hello ${input.name},`,
      '',
      `What ${input.shopName} charges you for the following changed. Update your own resale price if you want to keep the same margin.`,
      '',
      ...input.changes.map(line),
    ].join('\n'),
    html: wrap(
      input.shopName,
      heading,
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hello ${escape(input.name)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6">What ${escape(input.shopName)} charges you for the following changed. Update your own resale price if you want to keep the same margin.</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px">
         ${input.changes
           .map(
             (c) => `<tr>
               <td style="padding:8px 0;border-top:1px solid #e2e8f0">${escape(c.network ? `${c.network} ${c.name}` : c.name)}</td>
               <td style="padding:8px 0;border-top:1px solid #e2e8f0;text-align:right;white-space:nowrap">
                 ${escape(ghs(c.from))} &rarr;
                 <strong style="color:${c.to > c.from ? '#b91c1c' : '#15803d'}">${escape(ghs(c.to))}</strong>
               </td>
             </tr>`,
           )
           .join('')}
       </table>`,
    ),
  }
}

/** Somebody locked out of an account that already has a password. */
export function resetMail(input: { to: string; name: string; shopName: string; link: string }): Mail {
  return {
    to: input.to,
    subject: `Reset your ${input.shopName} password`,
    text: [
      `Hello ${input.name},`,
      '',
      `Somebody asked to reset the password for this account on ${input.shopName}.`,
      '',
      input.link,
      '',
      'The link works once and expires in one hour. If you did not ask for this, ignore it —',
      'your current password keeps working and nothing changes until the link is used.',
    ].join('\n'),
    html: wrap(
      input.shopName,
      'Reset your password',
      `<p style="margin:0 0 8px;font-size:15px;line-height:1.6">Hello ${escape(input.name)},</p>
       <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Somebody asked to reset the password for this account.</p>
       ${button(input.link, 'Choose a new password')}
       <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">The link works once and expires in one hour. If you did not ask for this, ignore it — your current password keeps working and nothing changes until the link is used.</p>`,
    ),
  }
}
