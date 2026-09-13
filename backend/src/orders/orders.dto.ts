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

export class RetryDispatchDto {
  /**
   * What was checked before retrying — the delivery partner's own dashboard,
   * specifically, for this recipient. Required and kept on the record, same
   * reason `ResolveOrderDto.note` is: a retry is only safe once a human has
   * confirmed the first attempt genuinely never landed, and this is the
   * record of that confirmation, not a guess.
   */
  @IsString()
  @MinLength(5, { message: 'Say what you checked before retrying.' })
  @MaxLength(500)
  note!: string
}

export class ReorderDto {
  /**
   * Why this failed order is being reordered. Required and kept on the
   * record, though for a different reason than `RetryDispatchDto.note`: a
   * `rejected` outcome already means DataHub, or our own validation, said no
   * outright — there is no ambiguity to have checked on a dashboard, only a
   * decision that the reason for the rejection no longer applies.
   */
  @IsString()
  @MinLength(5, { message: 'Say why this is being reordered.' })
  @MaxLength(500)
  note!: string

  /**
   * Which supplier SKU to fulfil this against, chosen by the admin from the
   * live catalogue at reorder time rather than reused from the order's own
   * frozen `supplierCodeAtSale`.
   *
   * Deliberately not silently reused, for two reasons: it can be stale in a
   * way nobody caused — see the migration that left it `null` on every order
   * still open when `supplier_code_at_sale` was introduced — and the cost
   * behind a SKU moves over time, so the admin needs to see today's price
   * against what the customer already paid before deciding this is still
   * worth fulfilling, not after.
   */
  @IsString()
  @MinLength(1, { message: 'Choose which bundle this should be fulfilled against.' })
  supplierCode!: string
}

export class AcknowledgeConflictDto {
  /** What was checked to confirm this is safe to clear. Kept on the record. */
  @IsString()
  @MinLength(5, { message: 'Say what you checked.' })
  @MaxLength(500)
  note!: string
}
