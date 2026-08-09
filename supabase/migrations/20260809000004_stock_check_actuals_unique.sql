-- Add unique constraint on (owner_id, product_id) to stock_check_actuals
-- so that the upsert in the stock check page works correctly.
ALTER TABLE public.stock_check_actuals
  DROP CONSTRAINT IF EXISTS stock_check_actuals_owner_product_unique;

ALTER TABLE public.stock_check_actuals
  ADD CONSTRAINT stock_check_actuals_owner_product_unique
  UNIQUE (owner_id, product_id);
