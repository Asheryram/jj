-- Track the markup behind each price, so a provider cost change moves the price
-- instead of eating the margin.
--
-- Before this, a cost rise was absorbed with `max(price, cost)`: the sale stayed
-- legal and the margin quietly became zero. Backfilled from the prices already
-- set, so nothing moves today — this only changes what happens on the next sync.
ALTER TABLE "products" ADD COLUMN "agent_markup_bp" INTEGER;
ALTER TABLE "products" ADD COLUMN "walkup_markup_bp" INTEGER;

UPDATE "products" SET
  "agent_markup_bp" = CASE
    WHEN "supplier_cost" > 0
      THEN ROUND((("admin_price"::numeric / "supplier_cost") - 1) * 10000)
    ELSE 0 END,
  "walkup_markup_bp" = CASE
    WHEN "supplier_cost" > 0
      THEN ROUND((("standard_price"::numeric / "supplier_cost") - 1) * 10000)
    ELSE 0 END;

ALTER TABLE "products" ALTER COLUMN "agent_markup_bp" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "walkup_markup_bp" SET NOT NULL;

-- A negative markup would mean selling below cost, which the app refuses anyway.
ALTER TABLE "products" ADD CONSTRAINT "products_markup_non_negative"
  CHECK ("agent_markup_bp" >= 0 AND "walkup_markup_bp" >= 0);
