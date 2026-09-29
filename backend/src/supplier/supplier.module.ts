import { Module } from '@nestjs/common'
import { SettingsModule } from '../settings/settings.module'
import { MailModule } from '../mail/mail.module'
import { SupplierService } from './supplier.service'
import { FloatMonitorService } from './float-monitor.service'
import { DatahubClient } from './datahub.client'
import { DatahubSource } from './datahub.source'
import { GmplClient } from './gmpl.client'
import { GmplSource } from './gmpl.source'
import { CatalogueImportService } from './catalogue-import.service'
import { CATALOGUE_SOURCES } from './catalogue-source'

/**
 * The provider seam, the adapters, their transports, and the list of places we
 * buy from. Provided once.
 *
 * SupplierService and DatahubClient were previously listed in two modules'
 * `providers`, so Nest built two of each and `onModuleInit` ran twice (visible
 * as the duplicated DATAHUB_LIVE warning at boot). Nothing here holds state, so
 * that cost a repeated log line and nothing more, but "how many of these exist"
 * should not be an accident, least of all for the object that spends real money.
 *
 * Adding a supplier means writing a CatalogueSource and adding it to the array
 * below (DataHub GH and GMPL both sell data bundles and nothing else, so
 * airtime, voice and SMS will arrive from a different one still), plus, for a
 * supplier that also dispatches and reconciles orders rather than only
 * pricing them, its own client wired into SupplierService/ReconcilerService.
 *
 * The reconciler and webhook controller stay in OrdersModule: they settle
 * orders, and settlement belongs to FulfilmentService.
 */
@Module({
  // The float monitor reads the thresholds and sends the warning.
  imports: [SettingsModule, MailModule],
  providers: [
    SupplierService,
    FloatMonitorService,
    DatahubClient,
    DatahubSource,
    GmplClient,
    GmplSource,
    CatalogueImportService,
    {
      provide: CATALOGUE_SOURCES,
      useFactory: (datahub: DatahubSource, gmpl: GmplSource) => [datahub, gmpl],
      inject: [DatahubSource, GmplSource],
    },
  ],
  exports: [SupplierService, DatahubClient, GmplClient, CatalogueImportService, FloatMonitorService],
})
export class SupplierModule {}
