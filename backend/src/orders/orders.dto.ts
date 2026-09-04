import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

const GH_PHONE = /^0\d{9}$/

export class PlaceOrderDto {
  @IsString()
  productId!: string

  /** FR-4.1 / FR-4.2 — the number that receives the bundle. */
  @Matches(GH_PHONE, { message: 'A Ghana number needs 10 digits.' })
  recipient!: string

  /** Where the receipt goes. Defaults to the recipient. */
  @IsOptional()
  @Matches(GH_PHONE, { message: 'A Ghana number needs 10 digits.' })
  buyerPhone?: string

  /** FR-4.8 — a guest gives a name or gets 'Guest'. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  buyerName?: string

  @IsIn(['wallet', 'momo'], { message: 'Choose how you would like to pay.' })
  payWith!: 'wallet' | 'momo'

  /** The sell link the buyer arrived through (FR-5.7). */
  @IsOptional()
  @IsString()
  @MaxLength(24)
  sellerCode?: string | null

  /**
   * Idempotency key (§4.4). A double-tapped Confirm button on a flaky connection
   * must not produce two debits and two deliveries. The client generates one per
   * checkout attempt; replaying it returns the original order untouched.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotencyKey?: string
}

export class TrackOrderDto {
  @IsString()
  @MinLength(4)
  reference!: string

  @IsString()
  @MinLength(4, { message: 'Enter the phone number used for the order.' })
  phone!: string
}

export class VerifyRecipientDto {
  @IsString()
  productId!: string

  @Matches(GH_PHONE, { message: 'A Ghana number needs 10 digits.' })
  recipient!: string
}

export class ResolveOrderDto {
  @IsIn(['delivered', 'rejected'])
  outcome!: 'delivered' | 'rejected'

  /**
   * Why this is being decided by hand rather than by the provider's own
   * answer. Required and kept on the record — same reason a refund refusal
   * requires one: nothing else here confirms the claim.
   */
  @IsString()
  @MinLength(5, { message: 'Say why you are resolving this by hand.' })
  @MaxLength(500)
  note!: string
}

export class AcknowledgeConflictDto {
  /** What was checked to confirm this is safe to clear. Kept on the record. */
  @IsString()
  @MinLength(5, { message: 'Say what you checked.' })
  @MaxLength(500)
  note!: string
}
