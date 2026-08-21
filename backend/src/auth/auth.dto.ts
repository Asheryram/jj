import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator'

/**
 * Normalise an email before it is validated.
 *
 * Order matters: `@IsEmail()` runs against the transformed value, so without
 * this a leading capital or a trailing space — exactly what a phone keyboard and
 * an autocomplete suggestion produce — fails validation and the user is told
 * their perfectly good address is not an email.
 */
const NormaliseEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )

/**
 * A Ghana mobile number, normalised. The frontend already validates and strips
 * `+233` before sending; this is the server-side repeat of that rule, because a
 * client-side check is a convenience, not a guarantee.
 */
const GH_PHONE = /^0\d{9}$/

export class LoginDto {
  /**
   * Email, not phone. A phone number changes hands in Ghana — SIMs are swapped,
   * numbers get recycled — and an identifier that can end up belonging to
   * someone else is the wrong thing to hang an account on. The number stays on
   * the account for delivery and payout; it is just not the credential.
   */
  @NormaliseEmail()
  @IsEmail({}, { message: 'Enter the email address on your account.' })
  email!: string

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  password!: string
}

export class RegisterDto {
  @IsString()
  @MinLength(3, { message: 'Enter your full name as it appears on your ID.' })
  name!: string

  @Matches(GH_PHONE, { message: 'Enter your 10-digit Ghana phone number.' })
  phone!: string

  @NormaliseEmail()
  @IsEmail({}, { message: 'Enter an email we can send your receipts to.' })
  email!: string

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters.' })
  password!: string

  /**
   * Only agents register.
   *
   * A buyer needs no account: they enter a number, pay with Mobile Money, and the
   * bundle goes to the number they gave. A customer account only ever existed to
   * hold a wallet, and a wallet is somebody else's money sitting on the platform
   * — a liability to reconcile, top up, refund and audit, for a convenience
   * nobody asked for. Deferred rather than removed: the `customer` role and the
   * wallet ledger stay in the schema for when it earns its keep.
   *
   * Enforced here rather than only in the UI, so a crafted request cannot create
   * a wallet the platform is not ready to manage.
   */
  @IsIn(['agent'], {
    message: 'Only agent accounts can be created. Buying needs no account at all.',
  })
  accountType!: 'agent'

  /** FR-1.2 — the referral code they signed up through, if any. */
  @IsOptional()
  @IsString()
  referralCode?: string
}
