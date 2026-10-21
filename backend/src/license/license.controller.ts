import { Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../common/auth'
import { LicenseService, type LicenseStatus } from './license.service'

/** All the public side ever learns: nothing about money or dates. */
export interface PublicLicenseStatus {
  /** `ok` unless sales are paused. `restricted` pauses buying and sign-ups; `suspended` pauses the whole public shop. */
  level: 'ok' | 'restricted' | 'suspended'
}

@ApiTags('license')
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  /**
   * Public, because the shop has to know whether to show a "paused" page to
   * someone who is not signed in. It says only whether selling is paused and
   * how far, never that the business is behind on a bill, when, or by how much.
   */
  @Get('status')
  publicStatus(): PublicLicenseStatus {
    const status = this.license.status()
    if (!status.paused) return { level: 'ok' }
    return { level: status.stage === 'suspended' ? 'suspended' : 'restricted' }
  }

  /** The full picture, for the admin's banner and settings card. */
  @ApiBearerAuth()
  @Roles('admin')
  @Get('admin')
  adminStatus(): LicenseStatus {
    return this.license.status()
  }

  /** "Check again" after paying: asks the billing server now instead of waiting for the next check. */
  @ApiBearerAuth()
  @Roles('admin')
  @Post('check')
  async checkNow(): Promise<LicenseStatus> {
    await this.license.refresh()
    return this.license.status()
  }
}
