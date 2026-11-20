import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CurrentUser, Roles, type AuthUser } from '../common/auth'
import { ValidationError } from '../common/domain-errors'
import { PaymentsService } from './payments.service'

/**
 * The return page after an agent pays a domain renewal by Paystack. Same path
 * it always had under `domains/`, but answered by `PaymentsService`, so it
 * takes the same confirm path as an order's checkout: a fresh verify with
 * Paystack, the amount check, and a `pending` answer while a Mobile Money
 * prompt is still waiting to be approved.
 */
@ApiTags('domains')
@Controller('domains')
export class DomainRenewalPaymentController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles('agent')
  @Get('mine/renew/pay-paystack/confirm')
  confirm(@Query('reference') reference: string, @CurrentUser() user: AuthUser) {
    if (!reference || !reference.startsWith('DOMREN-')) {
      throw new ValidationError('That is not a domain renewal payment.')
    }
    return this.payments.confirmDomainRenewal(reference, user.id)
  }
}
