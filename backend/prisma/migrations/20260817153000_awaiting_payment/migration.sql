-- Orders placed but not yet paid for.
--
-- These were previously `pending`, which the restart-recovery sweep treats as
-- "never dispatched" — so an unpaid order was fulfilled for free on the next
-- reboot. Nothing sweeps this status.
ALTER TYPE "OrderStatus" ADD VALUE 'awaiting_payment' BEFORE 'pending';
