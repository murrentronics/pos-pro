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
-- The items JSONB column stores objects like:
--   { "id": "<uuid or uuid__pv__varid>", "name": "...", "qty": 2, ... }
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
      (item->>'qty') || 'x ' || (item->>'name'),
      ', '
    )
    INTO v_items_text
    FROM jsonb_array_elements(NEW.items::jsonb) AS item;

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
  --    Aggregate qty by product_id first so multiple variation lines for the
  --    same product are summed before the UPDATE (avoids racing UPDATEs).
  CREATE TEMP TABLE IF NOT EXISTS _stock_delta (product_id UUID, qty INTEGER)
    ON COMMIT DROP;
  TRUNCATE _stock_delta;

  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items::jsonb)
  LOOP
    v_raw_id := item->>'id';
    v_qty    := COALESCE((item->>'qty')::integer, 0);

    -- Skip items with no qty or clearly invalid ids
    CONTINUE WHEN v_qty <= 0 OR v_raw_id IS NULL OR length(v_raw_id) < 36;

    -- Variation cart keys: "uuid__pv__varId"  or  "uuid__gid__optId"
    -- Extract the UUID prefix (everything before the first "__")
    IF v_raw_id LIKE '%__%' THEN
      v_raw_id := split_part(v_raw_id, '__', 1);
    END IF;

    -- Silently skip if it can't be cast to UUID
    BEGIN
      v_product_id := v_raw_id::uuid;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    INSERT INTO _stock_delta(product_id, qty)
      VALUES (v_product_id, v_qty)
      ON CONFLICT (product_id) DO UPDATE
        SET qty = _stock_delta.qty + EXCLUDED.qty;
  END LOOP;

  -- Apply the aggregated decrements, clamping at 0
  UPDATE public.products p
    SET stock_qty = GREATEST(0, p.stock_qty - d.qty)
    FROM _stock_delta d
    WHERE p.id = d.product_id
      AND p.stock_qty IS NOT NULL;

  RETURN NEW;
END;
$$;

-- Recreate the trigger (DROP + CREATE is idempotent with CREATE OR REPLACE above,
-- but the trigger binding itself must be dropped and re-added if it already exists)
DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();
