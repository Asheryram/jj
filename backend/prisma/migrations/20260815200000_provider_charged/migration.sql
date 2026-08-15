-- What the provider actually debited, against what we thought it would.
--
-- `supplier_products.cost_price` was seeded from estimates, and every margin the
-- platform shows is measured from it. Recording the real figure alongside makes
-- a wrong estimate visible instead of silently skewing every number.
ALTER TABLE "supplier_dispatches" ADD COLUMN "provider_charged" INTEGER;
