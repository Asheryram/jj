-- Keep the Paystack checkout link, so a customer who reloads can still pay.
--
-- Paystack refuses a second initialise on the same reference, so a replayed
-- checkout previously returned a receipt for an unpaid order with no way to pay.
ALTER TABLE "payments" ADD COLUMN "authorization_url" TEXT;
