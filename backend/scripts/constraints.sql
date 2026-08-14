-- Constraints as correctness, not decoration (skills-breakdown.md §5).
--
-- Prisma's schema language cannot express CHECK, so these are applied after
-- migration. Every statement is idempotent — `npm run setup` may run repeatedly.
--
-- These are the last line of defence. The application already refuses to
-- overdraw a wallet inside a transaction; this makes an application bug a failed
-- statement instead of lost money.

-- FR-2.5 / NFR-3.3 — a balance can never go negative, whatever the code does.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_balance_non_negative;
ALTER TABLE users ADD CONSTRAINT users_balance_non_negative CHECK (balance >= 0);

-- A markup below zero would mean an agent selling under their own cost.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_markup_sane;
ALTER TABLE users ADD CONSTRAINT users_markup_sane
  CHECK (markup_percent >= 0 AND markup_percent <= 200);

-- Prices. One rule: neither selling price may be below cost. Selling under cost
-- destroys money on every order, which is never a preference.
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
     AND admin_price >= supplier_cost
     AND standard_price >= supplier_cost);

-- FR-3.4 — an agent's resale price is never negative. The real floor is their
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
