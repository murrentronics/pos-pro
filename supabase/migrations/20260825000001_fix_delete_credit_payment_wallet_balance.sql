-- Allow deleting payment records from credit accounts, and reverse the
-- cashier wallet balance so the ledger stays in sync.

CREATE OR REPLACE FUNCTION public.delete_credit_payment(
  p_credit_tx_id UUID,
  p_cashier_id   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_credit_account_id UUID;
  v_owner_id          UUID;
  v_amount            NUMERIC;
  v_payment_time      TIMESTAMPTZ;
  v_cashier_is_owner  BOOLEAN;
BEGIN
  SELECT credit_account_id, owner_id, amount, created_at
    INTO v_credit_account_id, v_owner_id, v_amount, v_payment_time
    FROM public.credit_transactions
   WHERE id = p_credit_tx_id AND type = 'payment';

  IF NOT FOUND THEN RAISE EXCEPTION 'Credit payment not found'; END IF;

  v_cashier_is_owner := (p_cashier_id = v_owner_id);

  UPDATE public.credit_accounts
  SET
    balance_owed = balance_owed + v_amount,
    status       = 'open',
    updated_at   = now()
  WHERE id = v_credit_account_id;

  DELETE FROM public.wallet_transactions
   WHERE type IN ('credit_payment', 'credit_charge')
     AND profile_id IN (v_owner_id, p_cashier_id)
     AND created_at >= v_payment_time - INTERVAL '60 seconds'
     AND created_at <= v_payment_time + INTERVAL '60 seconds';

  IF NOT v_cashier_is_owner THEN
    UPDATE public.profiles
    SET wallet_balance = GREATEST(0, wallet_balance - v_amount)
    WHERE id = p_cashier_id;
  END IF;

  DELETE FROM public.credit_transactions WHERE id = p_credit_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_credit_payment(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Delete credit transactions in scope" ON public.credit_transactions;

CREATE POLICY "Delete credit transactions in scope"
  ON public.credit_transactions FOR DELETE
  USING (
    owner_id = public.get_owner_id(auth.uid())
    AND type IN ('charge', 'payment')
  );
