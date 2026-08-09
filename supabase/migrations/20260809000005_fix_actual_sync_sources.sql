-- Restore the broad sync trigger and remove the overly-restricted version.
--
-- The sync trigger fires on ANY products.stock_qty change and applies the same
-- delta to stock_check_actuals so the discrepancy gap is preserved.
-- This is correct for: sales, order deletes, Add Stock, Undo, Revert, Bulk Edit.
--
-- The ONLY exception is editing via the Edit Item dialog (name/price/category)
-- but that dialog does NOT touch stock_qty so the trigger never fires for it.
--
-- The previous migration 20260809000005 incorrectly removed this trigger.
-- This migration restores it and cleans up the now-unnecessary helper function.

-- Drop the explicit per-trigger sync calls added in previous version
DROP FUNCTION IF EXISTS public.apply_actual_delta(UUID, UUID, INTEGER);

-- Restore the broad sync trigger function
CREATE OR REPLACE FUNCTION public.sync_actual_qty_on_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta INTEGER;
BEGIN
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

DROP TRIGGER IF EXISTS trg_sync_actual_qty ON public.products;

CREATE TRIGGER trg_sync_actual_qty
  AFTER UPDATE OF stock_qty ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_actual_qty_on_stock_change();


-- Also restore handle_order_insert and handle_order_delete to their clean versions
-- (without the redundant explicit apply_actual_delta calls — the trigger covers them).

CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cashier_username TEXT;
  v_items_text       TEXT;
  item               JSONB;
BEGIN
  -- 1. Credit the cashier's wallet
  UPDATE public.profiles
    SET wallet_balance = wallet_balance + NEW.total
    WHERE id = NEW.cashier_id;

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (NEW.cashier_id, NEW.total, 'sale', 'Order sale', NEW.id);

  -- 2. Owner feed entry when cashier ≠ owner
  IF NEW.cashier_id IS DISTINCT FROM NEW.owner_id THEN
    SELECT username INTO v_cashier_username
      FROM public.profiles WHERE id = NEW.cashier_id;

    SELECT string_agg((i->>'qty') || 'x ' || (i->>'name'), ', ')
    INTO v_items_text
    FROM jsonb_array_elements(NEW.items::jsonb) AS i;

    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      NEW.owner_id, 0, 'cashier_sale',
      'Cashier: ' || COALESCE(v_cashier_username, 'Unknown')
        || ' | $' || NEW.total::text
        || ' | ' || COALESCE(v_items_text, ''),
      NEW.id
    );
  END IF;

  -- 3. Decrement stock_qty (trg_sync_actual_qty fires automatically to sync actuals)
  UPDATE public.products p
  SET stock_qty = GREATEST(0, p.stock_qty - agg.total_qty)
  FROM (
    SELECT
      CASE WHEN position('__' IN (el->>'id')) > 0
        THEN split_part(el->>'id', '__', 1)
        ELSE el->>'id'
      END AS product_id_text,
      SUM(COALESCE((el->>'qty')::integer, 0)) AS total_qty
    FROM jsonb_array_elements(NEW.items::jsonb) AS el
    WHERE (el->>'id') IS NOT NULL
      AND length(el->>'id') >= 36
      AND COALESCE((el->>'qty')::integer, 0) > 0
    GROUP BY 1
  ) agg
  WHERE p.id::text = agg.product_id_text
    AND p.stock_qty IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();


CREATE OR REPLACE FUNCTION public.handle_order_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 1. Reverse wallet credit
  UPDATE public.profiles
     SET wallet_balance = GREATEST(0, wallet_balance - OLD.total)
   WHERE id = OLD.cashier_id;

  -- 2. Restore stock_qty (trg_sync_actual_qty fires automatically to sync actuals)
  IF OLD.items IS NOT NULL THEN
    UPDATE public.products p
    SET stock_qty = p.stock_qty + agg.total_qty
    FROM (
      SELECT
        CASE WHEN position('__' IN (el->>'id')) > 0
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
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_delete();
