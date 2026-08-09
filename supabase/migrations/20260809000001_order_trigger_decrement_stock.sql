-- Move stock decrement into the handle_order_insert trigger so it is atomic
-- with the order insert. Previously, stock was decremented by a separate
-- client-side RPC call (decrement_stock_item) which could fail silently,
-- leaving stock_qty unchanged in the DB after a sale.
--
-- This trigger now handles everything on order INSERT:
--   1. Credit cashier wallet (unchanged)
--   2. Insert wallet_transaction for cashier (unchanged)
--   3. Insert read-only wallet_transaction for owner when cashier ≠ owner (unchanged)
--   4. Decrement stock_qty for every item in the order (NEW — atomic, server-side)
--
-- For variation cart keys (uuid__pv__xxx or uuid__gid__oid), we extract
-- the product UUID from the part before the first "__".

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

  -- 3. Decrement stock_qty for each item in the order.
  --    Uses a subquery aggregation to sum qty per product_id so multiple
  --    variation lines for the same product are combined in one UPDATE.
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

  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();
