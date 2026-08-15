-- Wire the catalogue to DataHub GH's actual API shape.
--
-- Their /data-purchase takes `{ networkKey, capacity }`, not a SKU code, so the
-- two columns below are what an order is really placed with. Both stay NULL for
-- anything DataHub does not sell — airtime, voice, SMS, AFA and result checkers
-- — which is how the adapter knows a product has no automated fulfilment.
ALTER TABLE "supplier_products" ADD COLUMN "network_key" TEXT;
ALTER TABLE "supplier_products" ADD COLUMN "capacity_gb" TEXT;

-- Their reference is the only handle we have on their side of a transaction:
-- it is what an inbound webhook carries and what /order-status is queried by.
ALTER TABLE "supplier_dispatches" ADD COLUMN "provider_reference" TEXT;
ALTER TABLE "supplier_dispatches" ADD COLUMN "provider_status" TEXT;

ALTER TABLE "orders" ADD COLUMN "provider_reference" TEXT;

-- Unique: a webhook is matched on this, and two orders sharing one reference
-- would make a status update ambiguous — which here means crediting the wrong
-- agent for somebody else's sale.
CREATE UNIQUE INDEX "orders_provider_reference_key" ON "orders"("provider_reference");
