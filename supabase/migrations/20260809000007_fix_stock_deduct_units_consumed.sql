-- Fix stock deduction to respect units_consumed on order items.
--
-- For variation deals (e.g. "3 pack for $60"), the client sends:
--   qty            = number of deals sold (e.g. 2)   — used for pricing
--   units_consumed = actual units leaving stock (e.g. 6) — used for stock
--
-- Previously the trigger always used qty, so 2 deals of "3 pack" only
-- decremented stock by 2 instead of 6. Now it prefers units_consumed
-- when present, falling back to qty for plain items.

CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cashier_username TEXT;
  v_items_text       TEXT;
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

  -- 3. Decrement stock_qty for each item.
  --    Uses COALESCE(units_consumed, qty) so variation deals deduct the
  --    correct number of physical units (e.g. 2 deals × 3 packs = 6 units),
  --    while plain items (no units_consumed) fall back to qty as before.
  UPDATE public.products p
  SET stock_qty = GREATEST(0, p.stock_qty - agg.total_units)
  FROM (
    SELECT
      CASE
        WHEN position('__' IN (el->>'id')) > 0
        THEN split_part(el->>'id', '__', 1)
        ELSE el->>'id'
      END AS product_id_text,
      SUM(
        COALESCE(
          NULLIF((el->>'units_consumed')::integer, 0),
          (el->>'qty')::integer,
          0
        )
      ) AS total_units
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

-- Recreate the trigger (function already replaced above)
DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();
