-- Daily Order # per store, same idea as Bartendaz.
-- Assigned on the row before insert so the receipt and the wallet use one number.
-- Resets at midnight Trinidad time.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number INTEGER;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_order_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_order_date DATE;

CREATE OR REPLACE FUNCTION public.get_next_order_number(_owner_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'America/Port_of_Spain')::date;
  _current_count INTEGER;
  _current_date DATE;
  _next_num INTEGER;
BEGIN
  SELECT daily_order_count, last_order_date
    INTO _current_count, _current_date
    FROM public.profiles
   WHERE id = _owner_id
   FOR UPDATE;

  IF _current_date IS NULL OR _current_date <> _today THEN
    _next_num := 1;
  ELSE
    _next_num := COALESCE(_current_count, 0) + 1;
  END IF;

  UPDATE public.profiles
     SET daily_order_count = _next_num,
         last_order_date = _today
   WHERE id = _owner_id;

  RETURN _next_num;
END;
$$;

-- Number sales that already exist, one sequence per store per Trinidad day.
WITH numbered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY owner_id, (created_at AT TIME ZONE 'America/Port_of_Spain')::date
           ORDER BY created_at, id
         ) AS n
  FROM public.orders
  WHERE order_number IS NULL
)
UPDATE public.orders o
   SET order_number = numbered.n
  FROM numbered
 WHERE o.id = numbered.id;

UPDATE public.profiles p
   SET daily_order_count = c.max_n,
       last_order_date = (now() AT TIME ZONE 'America/Port_of_Spain')::date
  FROM (
    SELECT owner_id, MAX(order_number) AS max_n
      FROM public.orders
     WHERE (created_at AT TIME ZONE 'America/Port_of_Spain')::date
           = (now() AT TIME ZONE 'America/Port_of_Spain')::date
     GROUP BY owner_id
  ) c
 WHERE p.id = c.owner_id;

UPDATE public.wallet_transactions wt
   SET note = 'Order #' || o.order_number::text
  FROM public.orders o
 WHERE wt.order_id = o.id
   AND wt.type = 'sale'
   AND o.order_number IS NOT NULL
   AND COALESCE(wt.note, '') IN ('Order sale', '');

CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    NEW.order_number := public.get_next_order_number(NEW.owner_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_order_insert ON public.orders;
CREATE TRIGGER before_order_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_number();

-- Keep stock and staff labels. Sale note is now "Order #1".
CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items_text    TEXT;
  v_discount_text TEXT := '';
  v_label         TEXT;
  v_order_label   TEXT;
BEGIN
  v_order_label := 'Order #' || COALESCE(NEW.order_number::text, substr(NEW.id::text, 1, 8));

  UPDATE public.profiles
    SET wallet_balance = wallet_balance + NEW.total
    WHERE id = NEW.cashier_id;

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (NEW.cashier_id, NEW.total, 'sale', v_order_label, NEW.id);

  IF NEW.cashier_id IS DISTINCT FROM NEW.owner_id THEN
    v_label := public.staff_sale_label(NEW.cashier_id);

    SELECT string_agg((item->>'qty') || 'x ' || (item->>'name'), ', ')
      INTO v_items_text
      FROM jsonb_array_elements(NEW.items::jsonb) AS item;

    IF NEW.discount_amount IS NOT NULL AND NEW.discount_amount > 0 THEN
      v_discount_text := ' | Disc: -$' || NEW.discount_amount::text
                      || ' (orig $' || COALESCE(NEW.original_total::text, (NEW.total + NEW.discount_amount)::text) || ')';
    END IF;

    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      NEW.owner_id,
      NEW.total,
      'cashier_sale',
      COALESCE(v_label, 'Cashier: Unknown')
        || ' | Total: $'  || NEW.total::text
        || ' · Paid: $'   || COALESCE(NEW.paid::text, NEW.total::text)
        || ' · Change: $' || COALESCE(NEW.change_given::text, '0')
        || v_discount_text
        || ' | ' || COALESCE(v_items_text, ''),
      NEW.id
    );
  END IF;

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

GRANT EXECUTE ON FUNCTION public.get_next_order_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_number() TO authenticated;
