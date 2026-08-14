import { IsIn, IsInt, Max, Min } from 'class-validator'

export class TopUpDto {
  /** Integer pesewas. GHS 12.50 is 1250 — never a float. */
  @IsInt({ message: 'Enter an amount like 20.00.' })
  @Min(100, { message: 'The smallest top-up is GHS 1.00.' })
  @Max(500_000, { message: 'The largest single top-up is GHS 5,000.00.' })
  amount!: number

  @IsIn(['MTN', 'Telecel', 'AirtelTigo'], { message: 'Choose the network to pay from.' })
  network!: 'MTN' | 'Telecel' | 'AirtelTigo'
}
