import { IsInt, Max, Min } from 'class-validator'

export class SetPriceDto {
  /** Integer pesewas. The legal band is checked server-side against the chain. */
  @IsInt({ message: 'Enter a price like 7.50.' })
  @Min(1, { message: 'A price has to be more than nothing.' })
  @Max(1_000_000, { message: 'That price is not plausible — check the amount.' })
  resalePrice!: number
}

export class SetMarkupDto {
  @IsInt({ message: 'A markup is a whole number of percent.' })
  @Min(0)
  @Max(200)
  markupPercent!: number
}
