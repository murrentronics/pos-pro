-- Fix revert_stock_qty: remove the ALTER TABLE DISABLE/ENABLE TRIGGER pattern.
--
-- Problem: ALTER TABLE ... DISABLE TRIGGER requires superuser or the table owner
-- role. In Supabase's hosted environment, SECURITY DEFINER functions run as the
-- function owner (postgres), which should have that right — BUT the trigger must
-- already exist on the table. If the trigger does not exist, the ALTER TABLE
-- statement errors with "trigger does not exist".
--
-- Safer pattern: use a session-local GUC (app.skip_actual_sync = 'true') that
-- the trigger function checks. The trigger short-circuits and returns without
-- touching stock_check_actuals when the flag is set.
-- This never touches the trigger's enabled/disabled state, so it works
-- regardless of whether the trigger currently exists.

-- 1. Update the sync function to check the skip flag
CREATE OR REPLACE FUNCTION public.sync_actual_qty_on_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta INTEGER;
BEGIN
  -- Allow callers to skip syncing by setting app.skip_actual_sync = 'true'
  IF current_setting('app.skip_actual_sync', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only act when stock_qty actually changed
  IF NEW.stock_qty IS NOT DISTINCT FROM OLD.stock_qty THEN
    RETURN NEW;
  END IF;

  v_delta := NEW.stock_qty - OLD.stock_qty;

  -- Apply the same delta to actual_qty, clamped to >= 0.
  -- If no actual row exists yet, insert one seeded at NEW.stock_qty
  -- (zero discrepancy) so all future deltas track correctly from day one.
  INSERT INTO public.stock_check_actuals (owner_id, product_id, actual_qty, updated_at)
  VALUES (NEW.owner_id, NEW.id, NEW.stock_qty, now())
  ON CONFLICT (owner_id, product_id) DO UPDATE
    SET actual_qty = GREATEST(0, stock_check_actuals.actual_qty + v_delta),
        updated_at = now();

  RETURN NEW;
END;
$$;

-- Recreate the trigger (idempotent)
DROP TRIGGER IF EXISTS trg_sync_actual_qty ON public.products;

CREATE TRIGGER trg_sync_actual_qty
  AFTER UPDATE OF stock_qty ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_actual_qty_on_stock_change();


-- 2. Rewrite revert_stock_qty to use the GUC flag instead of ALTER TABLE
CREATE OR REPLACE FUNCTION public.revert_stock_qty(
  p_product_id UUID,
  p_new_qty    INTEGER,
  p_owner_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the owner can call this for their own products
  IF auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Signal the sync trigger to skip actual_qty changes for this update
  PERFORM set_config('app.skip_actual_sync', 'true', true);

  UPDATE public.products
     SET stock_qty = p_new_qty
   WHERE id = p_product_id
     AND owner_id = p_owner_id;

  -- Clear the flag (true = local to this transaction)
  PERFORM set_config('app.skip_actual_sync', 'false', true);

EXCEPTION WHEN OTHERS THEN
  -- Always clear the flag on error
  PERFORM set_config('app.skip_actual_sync', 'false', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_stock_qty(UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_stock_qty(UUID, INTEGER, UUID) TO authenticated;
