ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- "Manager: Tom" or "Cashier: Sarah" — first name when it is set, otherwise the username.
CREATE OR REPLACE FUNCTION public.staff_sale_label(p_profile_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN role = 'manager' OR COALESCE(job_title, '') = 'manager' THEN 'Manager: '
      ELSE 'Cashier: '
    END
    || COALESCE(NULLIF(btrim(first_name), ''), NULLIF(btrim(username), ''), 'Unknown')
  FROM public.profiles
  WHERE id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.staff_sale_label(UUID) TO authenticated;

-- Edit an existing sale in place.
-- Restores stock for the old items and deducts stock for the new items.
-- Wallet sale rows and balances move by the difference (up or down).
-- created_at and the order id stay the same.
-- stock_check_actuals is left alone (app.skip_actual_sync), same as a stock revert.

CREATE OR REPLACE FUNCTION public.edit_order(
  p_order_id        UUID,
  p_items           JSONB,
  p_total           NUMERIC,
  p_paid            NUMERIC,
  p_change_given    NUMERIC,
  p_discount_amount NUMERIC DEFAULT NULL,
  p_original_total  NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_total      NUMERIC;
  v_old_items      JSONB;
  v_cashier_id     UUID;
  v_owner_id       UUID;
  v_delta          NUMERIC;
  v_cashier_name   TEXT;
  v_items_text     TEXT;
  v_discount_text  TEXT := '';
  v_caller         UUID := auth.uid();
  v_caller_parent  UUID;
  v_owner_parent   UUID;
  v_item           JSONB;
  v_raw_id         TEXT;
  v_pid            TEXT;
  v_units          INTEGER;
  v_sign           INTEGER;
  v_list           JSONB;
BEGIN
  SELECT total, cashier_id, owner_id, items
    INTO v_old_total, v_cashier_id, v_owner_id, v_old_items
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Cashier who rang it, the store owner, that owner's manager, or the chain master.
  IF v_caller IS DISTINCT FROM v_cashier_id AND v_caller IS DISTINCT FROM v_owner_id THEN
    SELECT parent_id INTO v_caller_parent FROM public.profiles WHERE id = v_caller;
    SELECT parent_id INTO v_owner_parent FROM public.profiles WHERE id = v_owner_id;
    IF v_caller_parent IS DISTINCT FROM v_owner_id
       AND v_owner_parent IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'Not authorised to edit this order';
    END IF;
  END IF;

  v_delta := p_total - v_old_total;

  UPDATE public.orders SET
    items           = p_items,
    total           = p_total,
    paid            = p_paid,
    change_given    = p_change_given,
    discount_amount = p_discount_amount,
    original_total  = p_original_total
  WHERE id = p_order_id;

  UPDATE public.profiles
     SET wallet_balance = wallet_balance + v_delta
   WHERE id = v_cashier_id;

  SELECT string_agg((item->>'qty') || 'x ' || (item->>'name'), ', ')
    INTO v_items_text
    FROM jsonb_array_elements(p_items) AS item;

  IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
    v_discount_text := ' | Disc: -$' || p_discount_amount::text
                    || ' (orig $'    || COALESCE(p_original_total::text, (p_total + p_discount_amount)::text) || ')';
  END IF;

  DELETE FROM public.wallet_transactions
   WHERE order_id = p_order_id
     AND profile_id = v_cashier_id
     AND type = 'sale';

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      v_cashier_id,
      p_total,
      'sale',
      'Cash: Sale (edited)'
        || v_discount_text
        || ' | Items: ' || COALESCE(v_items_text, '')
        || ' | $' || p_total::text
        || ' | Paid: $' || p_paid::text
        || ' · Change: $' || p_change_given::text,
      p_order_id
    );

  IF v_cashier_id IS DISTINCT FROM v_owner_id THEN
    v_cashier_name := public.staff_sale_label(v_cashier_id);

    DELETE FROM public.wallet_transactions
     WHERE order_id = p_order_id
       AND profile_id = v_owner_id
       AND type = 'cashier_sale';

    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      v_owner_id,
      p_total,
      'cashier_sale',
      COALESCE(v_cashier_name, 'Cashier: Unknown')
        || ' | Total: $'  || p_total::text
        || ' · Paid: $'   || COALESCE(p_paid::text, p_total::text)
        || ' · Change: $' || COALESCE(p_change_given::text, '0')
        || v_discount_text
        || ' | Items: ' || COALESCE(v_items_text, ''),
      p_order_id
    );
  END IF;

  -- Stock: put the old units back, then take the new units off.
  -- Skip the physical-count sync so an edit does not rewrite stock_check_actuals.
  PERFORM set_config('app.skip_actual_sync', 'true', true);

  FOREACH v_sign IN ARRAY ARRAY[1, -1]
  LOOP
    v_list := CASE WHEN v_sign = 1 THEN COALESCE(v_old_items, '[]'::jsonb) ELSE COALESCE(p_items, '[]'::jsonb) END;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_list)
    LOOP
      v_raw_id := v_item->>'id';
      IF v_raw_id IS NULL OR v_raw_id = '' OR v_raw_id LIKE 'shot-%' OR v_raw_id LIKE 'pack-%' THEN
        CONTINUE;
      END IF;
      v_pid := split_part(v_raw_id, '__', 1);
      IF v_pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        CONTINUE;
      END IF;
      BEGIN
        v_units := GREATEST(0, ROUND(COALESCE(
          NULLIF((v_item->>'units_consumed')::numeric, 0),
          (v_item->>'qty')::numeric,
          0
        ))::integer);
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;
      IF v_units <= 0 THEN
        CONTINUE;
      END IF;
      IF v_sign > 0 THEN
        UPDATE public.products
           SET stock_qty = COALESCE(stock_qty, 0) + v_units
         WHERE id = v_pid::uuid
           AND owner_id = v_owner_id;
      ELSE
        UPDATE public.products
           SET stock_qty = GREATEST(0, COALESCE(stock_qty, 0) - v_units)
         WHERE id = v_pid::uuid
           AND owner_id = v_owner_id;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('app.skip_actual_sync', 'false', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.skip_actual_sync', 'false', true);
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_order(UUID, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;
