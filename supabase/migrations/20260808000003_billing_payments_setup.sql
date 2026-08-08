-- Ensure billing_payments has all required columns
ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS addon_bar_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_bar_data JSONB;

-- Ensure RLS is enabled
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

-- Drop and recreate billing_payments policies cleanly
DROP POLICY IF EXISTS "Owners can view their own payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Owners can insert their own payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Admins can update payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Admins can delete payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Owners create payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Owners view own payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Admins update payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Admins delete payments" ON public.billing_payments;
DROP POLICY IF EXISTS "Owners can delete their own pending payments" ON public.billing_payments;
DROP POLICY IF EXISTS "billing_payments_select" ON public.billing_payments;
DROP POLICY IF EXISTS "billing_payments_insert" ON public.billing_payments;
DROP POLICY IF EXISTS "billing_payments_update" ON public.billing_payments;
DROP POLICY IF EXISTS "billing_payments_delete" ON public.billing_payments;

CREATE POLICY "billing_payments_select"
  ON public.billing_payments FOR SELECT
  USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "billing_payments_insert"
  ON public.billing_payments FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "billing_payments_update"
  ON public.billing_payments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "billing_payments_delete"
  ON public.billing_payments FOR DELETE
  USING (
    (owner_id = auth.uid() AND status = 'pending') OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- billing_plans: everyone can read
DROP POLICY IF EXISTS "Anyone can view billing plans" ON public.billing_plans;
DROP POLICY IF EXISTS "billing_plans_select" ON public.billing_plans;
CREATE POLICY "billing_plans_select"
  ON public.billing_plans FOR SELECT
  USING (true);

-- ── Profiles: ensure admin can UPDATE any profile ────────────────────────────
-- Without this, the admin billing approval cannot set status = 'approved'
DROP POLICY IF EXISTS "Admins update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "admin_profiles_update" ON public.profiles;
CREATE POLICY "admin_profiles_update"
  ON public.profiles FOR UPDATE
  USING (
    id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Ensure profiles realtime is enabled so billing page updates instantly
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_payments; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Ensure the generate_payment_reference function exists with correct grants
CREATE OR REPLACE FUNCTION public.generate_payment_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  ref    TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    ref := 'PP' || TO_CHAR(NOW(), 'YYYYMMDD') || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    SELECT EXISTS(SELECT 1 FROM public.billing_payments WHERE reference_number = ref) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  RETURN ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO anon;
