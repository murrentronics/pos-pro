-- ─── Allow cashiers/owners to UPDATE their own order rows ────────────────────
DROP POLICY IF EXISTS "Cashier can update own orders" ON public.orders;
CREATE POLICY "Cashier can update own orders"
  ON public.orders FOR UPDATE
  USING  (cashier_id = auth.uid())
  WITH CHECK (cashier_id = auth.uid());

-- ─── RPC: edit_order ──────────────────────────────────────────────────────────
-- Atomically updates an existing order row and recalculates wallet balances.
-- The handle_order_insert trigger does NOT fire on UPDATE, so this function
-- manually adjusts wallet_balance and replaces the wallet_transactions rows.
--
-- Parameters:
--   p_order_id       — UUID of the order to edit
--   p_items          — new JSONB items array
--   p_total          — new discounted total
--   p_paid           — amount paid by customer
--   p_change_given   — change returned
--   p_discount_amount — order-level discount (NULL if none)
--   p_original_total  — pre-discount total (NULL if no discount)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_cashier_id     UUID;
  v_owner_id       UUID;
  v_delta          NUMERIC;
  v_cashier_name   TEXT;
  v_items_text     TEXT;
  v_discount_text  TEXT := '';
BEGIN
  -- 1. Fetch the existing order
  SELECT total, cashier_id, owner_id
    INTO v_old_total, v_cashier_id, v_owner_id
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- 2. Only the cashier who placed the order (or the owner) may edit it
  IF auth.uid() <> v_cashier_id AND auth.uid() <> v_owner_id THEN
    RAISE EXCEPTION 'Not authorised to edit this order';
  END IF;

  -- 3. Wallet balance delta (new - old)
  v_delta := p_total - v_old_total;

  -- 4. Update order row (preserve id and created_at)
  UPDATE public.orders SET
    items           = p_items,
    total           = p_total,
    paid            = p_paid,
    change_given    = p_change_given,
    discount_amount = p_discount_amount,
    original_total  = p_original_total
  WHERE id = p_order_id;

  -- 5. Adjust cashier wallet_balance by the delta
  UPDATE public.profiles
     SET wallet_balance = wallet_balance + v_delta
   WHERE id = v_cashier_id;

  -- 6. Replace cashier's wallet_transaction for this order
  DELETE FROM public.wallet_transactions
   WHERE order_id = p_order_id
     AND profile_id = v_cashier_id
     AND type = 'sale';

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (v_cashier_id, p_total, 'sale', 'Order sale (edited)', p_order_id);

  -- 7. Replace owner's cashier_sale wallet_transaction (only when cashier ≠ owner)
  IF v_cashier_id IS DISTINCT FROM v_owner_id THEN
    SELECT username INTO v_cashier_name
      FROM public.profiles WHERE id = v_cashier_id;

    SELECT string_agg((item->>'qty') || 'x ' || (item->>'name'), ', ')
      INTO v_items_text
      FROM jsonb_array_elements(p_items) AS item;

    IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
      v_discount_text := ' | Disc: -$' || p_discount_amount::text
                      || ' (orig $'    || COALESCE(p_original_total::text, (p_total + p_discount_amount)::text) || ')';
    END IF;

    DELETE FROM public.wallet_transactions
     WHERE order_id = p_order_id
       AND profile_id = v_owner_id
       AND type = 'cashier_sale';

    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (
      v_owner_id,
      p_total,
      'cashier_sale',
      'Cashier: ' || COALESCE(v_cashier_name, 'Unknown')
        || ' | Total: $'  || p_total::text
        || ' · Paid: $'   || COALESCE(p_paid::text, p_total::text)
        || ' · Change: $' || COALESCE(p_change_given::text, '0')
        || v_discount_text
        || ' | ' || COALESCE(v_items_text, ''),
      p_order_id
    );
  END IF;
END;
$$;

-- Grant execute to authenticated users (RLS inside the function enforces ownership)
GRANT EXECUTE ON FUNCTION public.edit_order(UUID, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;
