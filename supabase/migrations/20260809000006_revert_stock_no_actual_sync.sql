-- RPC for the "Revert Stock" pencil inside the Add Stock modal.
-- Updates stock_qty WITHOUT syncing stock_check_actuals.
-- The broad trg_sync_actual_qty trigger is temporarily suppressed by
-- operating inside a security-definer function that disables the trigger
-- for the session duration of the call.
--
-- Usage: supabase.rpc("revert_stock_qty", { p_product_id, p_new_qty, p_owner_id })

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

  -- Disable the sync trigger for this session so actuals are NOT touched
  ALTER TABLE public.products DISABLE TRIGGER trg_sync_actual_qty;

  UPDATE public.products
     SET stock_qty = p_new_qty
   WHERE id = p_product_id
     AND owner_id = p_owner_id;

  -- Re-enable the trigger
  ALTER TABLE public.products ENABLE TRIGGER trg_sync_actual_qty;

EXCEPTION WHEN OTHERS THEN
  -- Always re-enable even on error
  ALTER TABLE public.products ENABLE TRIGGER trg_sync_actual_qty;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_stock_qty(UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_stock_qty(UUID, INTEGER, UUID) TO authenticated;
