-- Credit tab sessions: one credit_transactions row per running tab.
-- End Tab on the Customers page calls close_credit_tab().
-- record_credit_charge is left as-is so chain-bar credit sales stay unchanged.

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS tab_status TEXT CHECK (tab_status IN ('open', 'closed'));

DROP POLICY IF EXISTS "Update credit transactions tab" ON public.credit_transactions;
CREATE POLICY "Update credit transactions tab"
  ON public.credit_transactions FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_transactions TO authenticated;

DROP FUNCTION IF EXISTS public.open_credit_tab(UUID, UUID);

CREATE OR REPLACE FUNCTION public.open_credit_tab(
  p_credit_account_id UUID,
  p_cashier_id        UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_owner_id   UUID;
  v_existing   UUID;
  v_tab_id     UUID;
BEGIN
  SELECT owner_id INTO v_owner_id
    FROM public.credit_accounts WHERE id = p_credit_account_id;

  SELECT id INTO v_existing
    FROM public.credit_transactions
   WHERE credit_account_id = p_credit_account_id
     AND tab_status = 'open'
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.credit_transactions
    (credit_account_id, owner_id, cashier_id, type, amount, items, note, tab_status)
  VALUES
    (p_credit_account_id, v_owner_id, p_cashier_id, 'charge', 0, '[]'::jsonb,
     'Open Tab', 'open')
  RETURNING id INTO v_tab_id;

  RETURN v_tab_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_credit_tab(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.append_to_tab(
  p_tab_tx_id  UUID,
  p_cashier_id UUID,
  p_amount     NUMERIC,
  p_items      JSONB,
  p_note       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_credit_account_id UUID;
  v_owner_id          UUID;
  v_account_name      TEXT;
  v_cashier_name      TEXT;
  v_old_balance       NUMERIC;
  v_new_balance       NUMERIC;
  v_owner_is_cashier  BOOLEAN;
  v_is_chain_master   BOOLEAN;
  v_existing_items    JSONB;
  v_new_note          TEXT;
BEGIN
  SELECT ct.credit_account_id, ct.items, ca.owner_id, ca.full_name, ca.balance_owed
    INTO v_credit_account_id, v_existing_items, v_owner_id, v_account_name, v_old_balance
    FROM public.credit_transactions ct
    JOIN public.credit_accounts ca ON ca.id = ct.credit_account_id
   WHERE ct.id = p_tab_tx_id AND ct.tab_status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tab not found or already closed: %', p_tab_tx_id;
  END IF;

  SELECT username INTO v_cashier_name FROM public.profiles WHERE id = p_cashier_id;

  v_new_balance := v_old_balance + p_amount;

  SELECT (parent_id = p_cashier_id AND is_bar_account = true)
    INTO v_is_chain_master
    FROM public.profiles WHERE id = v_owner_id;

  v_owner_is_cashier := (p_cashier_id = v_owner_id) OR COALESCE(v_is_chain_master, false);

  v_existing_items := COALESCE(v_existing_items, '[]'::jsonb) || COALESCE(p_items, '[]'::jsonb);
  v_new_note := COALESCE(p_note, 'Tab order');

  UPDATE public.credit_transactions
     SET amount = amount + p_amount,
         items  = v_existing_items,
         note   = v_new_note
   WHERE id = p_tab_tx_id;

  UPDATE public.credit_accounts
     SET balance_owed = v_new_balance, status = 'open', updated_at = now()
   WHERE id = v_credit_account_id;

  -- Stock uses units_consumed when set (variation deals) and strips
  -- variation suffixes (uuid__key) so the product id stays a real uuid.
  IF p_items IS NOT NULL THEN
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
      FROM jsonb_array_elements(p_items) AS el
      WHERE (el->>'id') IS NOT NULL
        AND (el->>'id') NOT LIKE 'shot-%'
        AND (el->>'id') NOT LIKE 'pack-%'
        AND length(el->>'id') >= 36
        AND COALESCE((el->>'qty')::integer, 0) > 0
      GROUP BY 1
    ) agg
    WHERE p.id::text = agg.product_id_text
      AND p.stock_qty IS NOT NULL;
  END IF;

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, credit_tx_id)
  VALUES (
    v_owner_id, 0, 'credit_charge',
    'TAB: ' || COALESCE(v_account_name, 'Customer')
      || ' | +$' || p_amount::text
      || ' | Balance: $' || v_new_balance::text
      || CASE WHEN v_owner_is_cashier THEN ''
              ELSE ' | Cashier: ' || COALESCE(v_cashier_name, 'Unknown') END,
    p_tab_tx_id
  );

  IF NOT v_owner_is_cashier THEN
    INSERT INTO public.wallet_transactions(profile_id, amount, type, note, credit_tx_id)
    VALUES (
      p_cashier_id, 0, 'credit_charge',
      'TAB: ' || COALESCE(v_account_name, 'Customer')
        || ' | +$' || p_amount::text
        || ' | Balance: $' || v_new_balance::text,
      p_tab_tx_id
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_to_tab(UUID, UUID, NUMERIC, JSONB, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.close_credit_tab(UUID);

CREATE OR REPLACE FUNCTION public.close_credit_tab(
  p_tab_tx_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tab_amount NUMERIC;
BEGIN
  SELECT amount INTO v_tab_amount
    FROM public.credit_transactions
   WHERE id = p_tab_tx_id AND tab_status = 'open';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_tab_amount = 0 THEN
    DELETE FROM public.credit_transactions WHERE id = p_tab_tx_id;
  ELSE
    UPDATE public.credit_transactions
       SET tab_status = 'closed',
           note = 'Tab — Closed'
     WHERE id = p_tab_tx_id AND tab_status = 'open';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_credit_tab(UUID) TO authenticated;
