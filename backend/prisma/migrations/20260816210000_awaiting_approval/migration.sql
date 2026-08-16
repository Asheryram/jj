-- Orders paid for but held until the provider approves the recipient's number.
--
-- Previously these were refused at checkout, which turned a first-time customer
-- away rather than selling to them. They are now taken, held, and either
-- delivered once the number is approved or refunded when the hold expires.
ALTER TYPE "OrderStatus" ADD VALUE 'awaiting_approval' BEFORE 'completed';
