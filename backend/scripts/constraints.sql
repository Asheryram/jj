-- Constraints as correctness, not decoration (skills-breakdown.md §5).
--
-- Prisma's schema language cannot express CHECK, so these are applied after
-- migration. Every statement is idempotent, `npm run setup` may run repeatedly.
--
-- These are the last line of defence. The application already refuses to
-- overdraw a wallet inside a transaction; this makes an application bug a failed
-- statement instead of lost money.

-- FR-2.5 / NFR-3.3, a balance can never go negative, whatever the code does.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_balance_non_negative;
ALTER TABLE users ADD CONSTRAINT users_balance_non_negative CHECK (balance >= 0);

-- A markup below zero would mean an agent selling under their own cost.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_markup_sane;
ALTER TABLE users ADD CONSTRAINT users_markup_sane
  CHECK (markup_percent >= 0 AND markup_percent <= 200);

-- Prices. Just non-negative here, neither selling price is pinned to
-- `supplier_cost` at the row level any more.
--
-- The real rule ("never sell below what this actually costs") still holds,
-- but it is checked in `AdminService.setTier` against the *real* floor, the
-- last real delivery's charge when one exists, which can honestly sit above
-- or below this row's own `supplier_cost`, not against this single stored
-- column. Pinning the CHECK to `supplier_cost` would either block a price
-- that is genuinely fine against a cheaper real cost, or wave through one
-- that is genuinely underwater against a real cost the catalogue hasn't
-- caught up to yet. Same reasoning as `agent_prices_positive` below: a floor
-- that depends on more than one row's own columns cannot be a row-level
-- CHECK, so it is enforced in the service instead.
--
-- `standard_price` is intentionally free relative to `admin_price`. James retails
-- as well as wholesales, and whether his own counter price sits below, level
-- with, or above what he charges agents is his commercial call per product.
--
-- There is no ceiling. Agents price their own stock however they like above cost;
-- the cascade that made a platform cap necessary is gone, so an overpriced agent
-- now simply loses the sale to a cheaper one.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tiers_ordered;
ALTER TABLE products ADD CONSTRAINT products_tiers_ordered
  CHECK (supplier_cost >= 0
     AND admin_price >= 0
     AND standard_price >= 0);

-- FR-3.4, an agent's resale price is never negative. The real floor is their
-- own cost, which depends on the chain and so cannot be a row-level CHECK; that
-- rule is enforced in the pricing domain and asserted in the service.
ALTER TABLE agent_prices DROP CONSTRAINT IF EXISTS agent_prices_positive;
ALTER TABLE agent_prices ADD CONSTRAINT agent_prices_positive CHECK (resale_price > 0);

-- An order can never have been sold for nothing.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sale_price_positive;
ALTER TABLE orders ADD CONSTRAINT orders_sale_price_positive CHECK (sale_price > 0);

-- A voucher is all-or-nothing: serial without PIN is useless to the buyer.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_voucher_complete;
ALTER TABLE orders ADD CONSTRAINT orders_voucher_complete
  CHECK ((voucher_serial IS NULL) = (voucher_pin IS NULL));

-- Withdrawals and credits are always for a real amount.
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_amount_positive;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_amount_positive CHECK (amount > 0);

ALTER TABLE claimable_credits DROP CONSTRAINT IF EXISTS credits_amount_positive;
ALTER TABLE claimable_credits ADD CONSTRAINT credits_amount_positive CHECK (amount > 0);

-- Ledger rows never land on a negative running balance.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_balance_non_negative;
ALTER TABLE transactions ADD CONSTRAINT transactions_balance_non_negative
  CHECK (balance_after >= 0);

ALTER TABLE earnings DROP CONSTRAINT IF EXISTS earnings_balance_non_negative;
ALTER TABLE earnings ADD CONSTRAINT earnings_balance_non_negative
  CHECK (balance_after >= 0);

-- Sign discipline on the ledgers: a purchase debits, a top-up credits. Catches
-- a missing minus sign, which is otherwise a silent free-money bug.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_sign_matches_type;
ALTER TABLE transactions ADD CONSTRAINT transactions_sign_matches_type
  CHECK ((type = 'purchase' AND amount < 0) OR (type <> 'purchase' AND amount > 0));

-- `withdrawal` is the one type that legitimately goes both ways: negative when
-- the agent requests and the amount is held, positive when James rejects it and
-- the hold is released. Everything else has a fixed direction.
ALTER TABLE earnings DROP CONSTRAINT IF EXISTS earnings_sign_matches_type;
ALTER TABLE earnings ADD CONSTRAINT earnings_sign_matches_type
  CHECK ((type = 'reversal' AND amount < 0)
      OR (type IN ('sale', 'downline') AND amount > 0)
      OR (type = 'withdrawal' AND amount <> 0));

-- A payment for an order must ask for exactly what that order sold for. Not
-- expressible as a plain CHECK (it reaches across tables), so it is a
-- trigger instead, the same shape as a foreign key, for an invariant a
-- foreign key can't state. `amount` is set once, at payment creation, from
-- the order's own `sale_price` at that moment (`PaymentsService.startOrderPayment`)
-- and neither ever changes after; a mismatch here means application code
-- diverged from that, which is exactly the kind of bug behind the "8
-- customers credited GHS 196" incident referenced on `RefundRequest`'s own
-- doc comment. A wallet top-up (`purpose = 'topup'`, no `order_id`) has
-- nothing to check against and is left alone.
CREATE OR REPLACE FUNCTION payments_amount_matches_order_sale_price() RETURNS trigger AS $$
DECLARE
  expected INTEGER;
BEGIN
  IF NEW.purpose <> 'order' OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sale_price INTO expected FROM orders WHERE id = NEW.order_id;

  IF expected IS NOT NULL AND expected <> NEW.amount THEN
    RAISE EXCEPTION 'payment % amount % does not match order % sale_price %',
      NEW.reference, NEW.amount, NEW.order_id, expected;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_amount_matches_order_sale_price ON payments;
CREATE TRIGGER payments_amount_matches_order_sale_price
  BEFORE INSERT OR UPDATE OF amount, order_id ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_amount_matches_order_sale_price();
