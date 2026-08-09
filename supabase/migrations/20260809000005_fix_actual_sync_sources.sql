-- Drop the broad trigger that fires on ANY stock_qty change.
-- It incorrectly adjusts actual_qty when the owner manually edits qty
-- via the pencil in the Products page.
--
-- Instead, we explicitly sync actuals only in the two legitimate places:
--   1. handle_order_insert  — sales decrement stock (already handled)
--   2. handle_order_delete  — sale reversal restores stock (already handled)
--
-- For "Add Stock" (owner_expenses insert path), the client already saves
-- the new stock_qty directly. We add explicit actual sync there via a new
-- helper function called from the Add Stock RPC / trigger below.
--
-- Manual pencil edits via products page do NOT touch actual_qty — the gap
-- (discrepancy) persists until the owner does a fresh stock check.

DROP TRIGGER IF EXISTS trg_sync_actual_qty ON public.products;


-- ── Helper: apply a stock delta to actuals (used by order triggers) ──────────
-- This replaces the broad trigger with an explicit call only from
-- handle_order_insert and handle_order_delete.
CREATE OR REPLACE FUNCTION public.apply_actual_delta(
  p_owner_id  UUID,
  p_product_id UUID,
  p_delta      INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only adjust if an actual row already exists (owner has done a stock check).
  -- If no row exists yet, leave it alone — zero discrepancy is the default.
  UPDATE public.stock_check_actuals
     SET actual_qty = GREATEST(0, actual_qty + p_delta),
         updated_at = now()
   WHERE owner_id   = p_owner_id
     AND product_id = p_product_id;
END;
$$;


-- ── Update handle_order_insert to explicitly sync actuals on sale ─────────────
CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cashier_username TEXT;
  v_items_text       TEXT;
  item               JSONB;
  v_product_id       UUID;
  v_qty              INTEGER;
  v_raw_id           TEXT;
BEGIN
  -- 1. Credit the cashier's wallet
  UPDATE public.profiles
    SET wallet_balance = wallet_balance + NEW.total
    WHERE id = NEW.cashier_id;

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (NEW.cashier_id, NEW.total, 'sale', 'Order sale', NEW.id);

  -- 2. Owner feed entry when a cashier (not the owner) places the order
  IF NEW.cashier_id IS DISTINCT FROM NEW.owner_id THEN
    SELECT username INTO v_cashier_username
      FROM public.profiles WHERE id = NEW.cashier_id;

    SELECT string_agg(
      (i->>'qty') || 'x ' || (i->>'name'),
      ', '
    )
    INTO v_items_text
    FROM jsonb_array_elements(NEW.items::jsonb) AS i;

    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      NEW.owner_id,
      0,
      'cashier_sale',
      'Cashier: ' || COALESCE(v_cashier_username, 'Unknown')
        || ' | $' || NEW.total::text
        || ' | ' || COALESCE(v_items_text, ''),
      NEW.id
    );
  END IF;

  -- 3. Decrement stock_qty and sync actuals for each item in the order.
  UPDATE public.products p
  SET stock_qty = GREATEST(0, p.stock_qty - agg.total_qty)
  FROM (
    SELECT
      CASE
        WHEN position('__' IN (el->>'id')) > 0
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

  -- 3b. Sync actuals (apply same negative delta) so discrepancy gap is preserved
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items::jsonb)
  LOOP
    v_raw_id := item->>'id';
    v_qty    := COALESCE((item->>'qty')::integer, 0);
    CONTINUE WHEN v_qty <= 0 OR v_raw_id IS NULL OR length(v_raw_id) < 36;
    IF v_raw_id LIKE '%__%' THEN v_raw_id := split_part(v_raw_id, '__', 1); END IF;
    BEGIN v_product_id := v_raw_id::uuid; EXCEPTION WHEN others THEN CONTINUE; END;
    PERFORM apply_actual_delta(NEW.owner_id, v_product_id, -v_qty);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();


-- ── Update handle_order_delete to explicitly sync actuals on reversal ─────────
CREATE OR REPLACE FUNCTION public.handle_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item         JSONB;
  v_raw_id     TEXT;
  v_product_id UUID;
  v_qty        INTEGER;
BEGIN
  -- 1. Reverse the wallet credit
  UPDATE public.profiles
     SET wallet_balance = GREATEST(0, wallet_balance - OLD.total)
   WHERE id = OLD.cashier_id;

  -- 2. Restore stock_qty and sync actuals
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

    -- 2b. Sync actuals (apply same positive delta back)
    FOR item IN SELECT * FROM jsonb_array_elements(OLD.items::jsonb)
    LOOP
      v_raw_id := item->>'id';
      v_qty    := COALESCE((item->>'qty')::integer, 0);
      CONTINUE WHEN v_qty <= 0 OR v_raw_id IS NULL OR length(v_raw_id) < 36;
      CONTINUE WHEN v_raw_id LIKE 'shot-%' OR v_raw_id LIKE 'pack-%';
      IF v_raw_id LIKE '%__%' THEN v_raw_id := split_part(v_raw_id, '__', 1); END IF;
      BEGIN v_product_id := v_raw_id::uuid; EXCEPTION WHEN others THEN CONTINUE; END;
      PERFORM apply_actual_delta(OLD.owner_id, v_product_id, v_qty);
    END LOOP;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_order_delete ON public.orders;
CREATE TRIGGER on_order_delete
  AFTER DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_delete();
