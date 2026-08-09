-- Move stock restoration into the handle_order_delete trigger so it is atomic
-- with the order delete. Previously, restore_stock_item was called from the
-- client side with raw cart item ids — variation keys like "uuid__pv__varId"
-- failed silently because they couldn't be cast to UUID.
--
-- Also fixes the standalone restore_stock_item RPC to handle variation keys
-- so any client calls still work correctly.

-- ── 1. Fix restore_stock_item RPC — strip variation suffixes ─────────────────
CREATE OR REPLACE FUNCTION public.restore_stock_item(p_items JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_id     TEXT;
  v_product_id UUID;
  v_qty        INTEGER;
BEGIN
  -- Aggregate qty by real product id, then restore in one pass
  UPDATE public.products p
  SET stock_qty = p.stock_qty + agg.total_qty
  FROM (
    SELECT
      CASE
        WHEN position('__' IN (el->>'id')) > 0
        THEN split_part(el->>'id', '__', 1)
        ELSE el->>'id'
      END AS product_id_text,
      SUM(COALESCE((el->>'qty')::integer, 0)) AS total_qty
    FROM jsonb_array_elements(p_items) AS el
    WHERE (el->>'id') IS NOT NULL
      AND length(el->>'id') >= 36
      AND COALESCE((el->>'qty')::integer, 0) > 0
      AND (el->>'id') NOT LIKE 'shot-%'
      AND (el->>'id') NOT LIKE 'pack-%'
    GROUP BY 1
  ) agg
  WHERE p.id::text = agg.product_id_text
    AND p.stock_qty IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_stock_item(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_stock_item(jsonb) TO authenticated;


-- ── 2. Add stock restoration to handle_order_delete trigger ──────────────────
-- This makes stock restore atomic with the delete — even if the client call
-- was skipped or failed, the DB always restores stock correctly.
CREATE OR REPLACE FUNCTION public.handle_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Reverse the wallet credit applied at insert time
  UPDATE public.profiles
     SET wallet_balance = GREATEST(0, wallet_balance - OLD.total)
   WHERE id = OLD.cashier_id;

  -- 2. Restore stock_qty for every product in the deleted order.
  --    Handles variation cart keys (uuid__pv__varId) by stripping the suffix.
  --    Skips shot- and pack- synthetic ids (those are handled separately).
  IF OLD.items IS NOT NULL THEN
    UPDATE public.products p
    SET stock_qty = p.stock_qty + agg.total_qty
    FROM (
      SELECT
        CASE
          WHEN position('__' IN (el->>'id')) > 0
          THEN split_part(el->>'id', '__', 1)
          ELSE el->>'id'
        END AS product_id_text,
        SUM(COALESCE((el->>'qty')::integer, 0)) AS total_qty
      FROM jsonb_array_elements(OLD.items::jsonb) AS el
      WHERE (el->>'id') IS NOT NULL
        AND length(el->>'id') >= 36
        AND COALESCE((el->>'qty')::integer, 0) > 0
        AND (el->>'id') NOT LIKE 'shot-%'
        AND (el->>'id') NOT LIKE 'pack-%'
      GROUP BY 1
    ) agg
    WHERE p.id::text = agg.product_id_text
      AND p.stock_qty IS NOT NULL;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_order_delete ON public.orders;
CREATE TRIGGER on_order_delete
  AFTER DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_delete();
