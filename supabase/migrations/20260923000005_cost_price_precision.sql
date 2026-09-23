-- Unit cost was NUMERIC(12,2). $20 for 48 units stored as $0.42,
-- and reverting 48 units refunded 0.42 * 48 = $20.16 instead of $20.00.
-- Six decimal places lets qty × cost round back to the amount that was paid.
ALTER TABLE public.products
  ALTER COLUMN cost_price TYPE numeric(16,6);
