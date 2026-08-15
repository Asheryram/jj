import { Module } from '@nestjs/common'
import { SupplierService } from './supplier.service'
import { DatahubClient } from './datahub.client'
import { DatahubSource } from './datahub.source'
import { CatalogueImportService } from './catalogue-import.service'
import { CATALOGUE_SOURCES } from './catalogue-source'

/**
 * The provider seam — the adapters, their transports, and the list of places we
 * buy from. Provided once.
 *
 * SupplierService and DatahubClient were previously listed in two modules'
 * `providers`, so Nest built two of each and `onModuleInit` ran twice (visible
 * as the duplicated DATAHUB_LIVE warning at boot). Nothing here holds state, so
 * that cost a repeated log line and nothing more — but "how many of these exist"
 * should not be an accident, least of all for the object that spends real money.
 *
 * Adding a supplier means writing a CatalogueSource and adding it to the array
 * below. DataHub sells data bundles and nothing else, so airtime, voice and SMS
 * will arrive that way.
 *
 * The reconciler and webhook controller stay in OrdersModule: they settle
 * orders, and settlement belongs to FulfilmentService.
 */
@Module({
  providers: [
    SupplierService,
    DatahubClient,
    DatahubSource,
    CatalogueImportService,
    {
      provide: CATALOGUE_SOURCES,
      useFactory: (datahub: DatahubSource) => [datahub],
      inject: [DatahubSource],
    },
  ],
  exports: [SupplierService, DatahubClient, CatalogueImportService],
})
export class SupplierModule {}
