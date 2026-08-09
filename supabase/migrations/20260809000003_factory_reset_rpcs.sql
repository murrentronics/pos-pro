-- Factory Reset RPCs for P.O.S. Pro owners
-- Two modes:
--
-- 1. soft_reset_owner(p_owner_id)
--    Clears all financial/sales records and resets stock qty to 0.
--    KEEPS: products (with prices), categories, cashiers, credit_accounts, profile.
--
-- 2. full_wipe_owner(p_owner_id)
--    Deletes everything owned by this owner except their own profile row.
--    Products, categories, cashiers, customers, orders, expenses — all gone.
--
-- Both functions are SECURITY DEFINER and require the calling user to be the owner.

-- ── 1. Soft Reset ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soft_reset_owner(p_owner_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the owner themselves can call this
  IF auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Clear all financial records
  DELETE FROM public.orders              WHERE owner_id = p_owner_id;
  DELETE FROM public.owner_expenses      WHERE owner_id = p_owner_id;
  DELETE FROM public.store_sessions      WHERE owner_id = p_owner_id;
  DELETE FROM public.store_sub_sessions  WHERE owner_id = p_owner_id;
  DELETE FROM public.credit_transactions WHERE owner_id = p_owner_id;
  DELETE FROM public.cashier_last_delete WHERE cashier_id = p_owner_id;

  -- Clear wallet_transactions for owner + all their cashiers
  DELETE FROM public.wallet_transactions
    WHERE profile_id = p_owner_id
       OR profile_id IN (SELECT id FROM public.profiles WHERE parent_id = p_owner_id);

  -- Reset cashier wallet balances to 0
  UPDATE public.profiles SET wallet_balance = 0
    WHERE parent_id = p_owner_id;

  -- Reset owner wallet balance and session state
  UPDATE public.profiles SET
    wallet_balance       = 0,
    cashier_float        = 0,
    cashier_float_set_at = NULL,
    store_session_start  = NULL,
    store_closed_at      = NULL
  WHERE id = p_owner_id;

  -- Reset all product stock to 0 (keep product rows with prices)
  UPDATE public.products SET stock_qty = 0 WHERE owner_id = p_owner_id;

  -- Clear stock check actuals
  DELETE FROM public.stock_check_actuals WHERE owner_id = p_owner_id;

  -- Clear bar sort order
  DELETE FROM public.bar_sort_order WHERE owner_id = p_owner_id;

  -- Clear owner_financials initial expense
  UPDATE public.owner_financials SET initial_expense = 0 WHERE owner_id = p_owner_id;

END;
$$;

REVOKE ALL ON FUNCTION public.soft_reset_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_reset_owner(uuid) TO authenticated;


-- ── 2. Full Wipe ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.full_wipe_owner(p_owner_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the owner themselves can call this
  IF auth.uid() <> p_owner_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Delete all financial records (same as soft reset)
  DELETE FROM public.orders              WHERE owner_id = p_owner_id;
  DELETE FROM public.owner_expenses      WHERE owner_id = p_owner_id;
  DELETE FROM public.store_sessions      WHERE owner_id = p_owner_id;
  DELETE FROM public.store_sub_sessions  WHERE owner_id = p_owner_id;
  DELETE FROM public.credit_transactions WHERE owner_id = p_owner_id;
  DELETE FROM public.cashier_last_delete WHERE cashier_id = p_owner_id;

  DELETE FROM public.wallet_transactions
    WHERE profile_id = p_owner_id
       OR profile_id IN (SELECT id FROM public.profiles WHERE parent_id = p_owner_id);

  -- Delete all products and categories
  DELETE FROM public.products         WHERE owner_id = p_owner_id;
  DELETE FROM public.store_categories WHERE owner_id = p_owner_id;
  DELETE FROM public.bar_sort_order   WHERE owner_id = p_owner_id;

  -- Delete all credit accounts and customers
  DELETE FROM public.credit_accounts WHERE owner_id = p_owner_id;

  -- Delete all cashier/manager staff accounts under this owner
  -- (cascade will handle their wallet_transactions etc via parent_id FK)
  DELETE FROM public.profiles WHERE parent_id = p_owner_id;

  -- Delete stock check actuals
  DELETE FROM public.stock_check_actuals WHERE owner_id = p_owner_id;

  -- Delete specials
  DELETE FROM public.specials WHERE owner_id = p_owner_id;

  -- Reset owner profile to clean state (keep billing/subscription fields)
  UPDATE public.profiles SET
    wallet_balance       = 0,
    cashier_float        = 0,
    cashier_float_set_at = NULL,
    store_session_start  = NULL,
    store_closed_at      = NULL
  WHERE id = p_owner_id;

  -- Reset owner_financials
  UPDATE public.owner_financials SET initial_expense = 0 WHERE owner_id = p_owner_id;

END;
$$;

REVOKE ALL ON FUNCTION public.full_wipe_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.full_wipe_owner(uuid) TO authenticated;
