-- ============================================================
-- P.O.S. Pro — Complete Fresh Supabase Setup
-- Paste this entire file into the Supabase SQL Editor and run.
-- ORDER: enums → profiles → helper functions → everything else
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- SECTION 1: ENUMS
-- ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner','cashier','admin','manager','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('pending','approved','suspended','expelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 2: update_updated_at_column (no table dependency)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 3: PROFILES TABLE
-- (helper functions that query profiles come AFTER this)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id                        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username                  TEXT NOT NULL UNIQUE,
  role                      public.app_role NOT NULL DEFAULT 'owner',
  status                    public.user_status NOT NULL DEFAULT 'pending',
  parent_id                 UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_balance            NUMERIC(12,2) NOT NULL DEFAULT 0,
  phone                     TEXT,
  address                   TEXT,
  job_title                 TEXT,
  has_login                 BOOLEAN NOT NULL DEFAULT TRUE,
  billing_status            TEXT DEFAULT 'pending_setup'
                              CHECK (billing_status IN ('pending_setup','active','suspended','expired')),
  current_plan_id           UUID,
  subscription_start_date   TIMESTAMPTZ,
  subscription_end_date     TIMESTAMPTZ,
  plan_type                 TEXT,
  store_session_start       TIMESTAMPTZ,
  store_closed_at           TIMESTAMPTZ,
  cashier_float             NUMERIC(12,2) DEFAULT 0,
  cashier_float_set_at      TIMESTAMPTZ,
  chain_addon_active        BOOLEAN NOT NULL DEFAULT false,
  chain_bar_count           INTEGER NOT NULL DEFAULT 0,
  is_bar_account            BOOLEAN NOT NULL DEFAULT false,
  addon_bar_count           INTEGER NOT NULL DEFAULT 0,
  is_multi_bar              BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

CREATE INDEX idx_profiles_parent_id      ON public.profiles(parent_id);
CREATE INDEX idx_profiles_billing_status ON public.profiles(billing_status);

-- ─────────────────────────────────────────────────────────────
-- SECTION 4: HELPER FUNCTIONS (profiles now exists)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_owner_id(_user_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN role = 'owner' THEN id ELSE parent_id END
  FROM public.profiles WHERE id = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'owner');
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'admin');
$$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 5: PROFILES RLS (uses helper functions)
-- ─────────────────────────────────────────────────────────────

CREATE POLICY "View own profile" ON public.profiles FOR SELECT
  USING (id = auth.uid() OR parent_id = auth.uid() OR id = public.get_owner_id(auth.uid()));
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE
  USING (id = auth.uid());
CREATE POLICY "Insert self profile" ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());
CREATE POLICY "Owner insert no-login worker" ON public.profiles FOR INSERT
  WITH CHECK (parent_id IS NOT NULL AND parent_id = auth.uid() AND has_login = FALSE);
CREATE POLICY "Owner delete no-login worker" ON public.profiles FOR DELETE
  USING (parent_id IS NOT NULL AND parent_id = auth.uid() AND has_login = FALSE);
CREATE POLICY "Admins view all profiles" ON public.profiles FOR SELECT
  USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins update all profiles" ON public.profiles FOR UPDATE
  USING (public.is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 6: PRODUCTS + PRODUCT VARIATIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  cost_price      NUMERIC(12,2),
  image_url       TEXT,
  category        TEXT NOT NULL DEFAULT 'general',
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  units_per_item  INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;

CREATE POLICY "View products in scope" ON public.products FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Owner inserts products" ON public.products FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "Owner updates products" ON public.products FOR UPDATE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "Owner deletes products" ON public.products FOR DELETE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "Manager reads products" ON public.products FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles m
    WHERE m.id = auth.uid()
      AND (m.role = 'manager' OR m.job_title = 'manager')
      AND m.parent_id = products.owner_id
  ));

-- Product Variations
CREATE TABLE public.product_variations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_variations;

CREATE INDEX idx_product_variations_product ON public.product_variations(product_id);
CREATE INDEX idx_product_variations_owner   ON public.product_variations(owner_id);

CREATE POLICY "View variations in scope" ON public.product_variations FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Owner inserts variations" ON public.product_variations FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "Owner updates variations" ON public.product_variations FOR UPDATE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "Owner deletes variations" ON public.product_variations FOR DELETE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 7: ORDERS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  items            JSONB NOT NULL,
  total            NUMERIC(12,2) NOT NULL,
  paid             NUMERIC(12,2) NOT NULL,
  change_given     NUMERIC(12,2) NOT NULL,
  discount_amount  NUMERIC(12,2),
  original_total   NUMERIC(12,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_orders_owner      ON public.orders(owner_id);
CREATE INDEX idx_orders_cashier    ON public.orders(cashier_id);
CREATE INDEX idx_orders_created_at ON public.orders(owner_id, created_at DESC);

CREATE POLICY "View orders in scope" ON public.orders FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Insert orders" ON public.orders FOR INSERT
  WITH CHECK (cashier_id = auth.uid() AND owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Owner deletes orders" ON public.orders FOR DELETE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 8: WALLET TRANSACTIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.wallet_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL,
  type         TEXT NOT NULL,
  note         TEXT,
  order_id     UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  credit_tx_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;

CREATE INDEX idx_wallet_tx_profile    ON public.wallet_transactions(profile_id);
CREATE INDEX idx_wallet_tx_created_at ON public.wallet_transactions(profile_id, created_at DESC);

CREATE POLICY "View own wallet tx" ON public.wallet_transactions FOR SELECT
  USING (
    profile_id = auth.uid() OR
    profile_id IN (SELECT id FROM public.profiles WHERE parent_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- SECTION 9: BILLING TABLES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.billing_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  duration_months  INTEGER NOT NULL,
  currency         TEXT DEFAULT 'TT',
  plan_type        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles
  ADD CONSTRAINT fk_profiles_current_plan
  FOREIGN KEY (current_plan_id) REFERENCES public.billing_plans(id);

CREATE TABLE public.billing_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES public.billing_plans(id),
  reference_number  TEXT NOT NULL UNIQUE,
  amount            NUMERIC(12,2) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','rejected')),
  payment_date      TIMESTAMPTZ,
  due_date          TIMESTAMPTZ NOT NULL,
  next_due_date     TIMESTAMPTZ,
  approved_by       UUID REFERENCES public.profiles(id),
  approved_at       TIMESTAMPTZ,
  notes             TEXT,
  addon_bar_count   INTEGER NOT NULL DEFAULT 1,
  addon_bar_data    JSONB,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.admin_bank_details (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bank_name       TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  branch          TEXT,
  swift_code      TEXT,
  instructions    TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(admin_id)
);

ALTER TABLE public.billing_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_bank_details ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_billing_payments_owner    ON public.billing_payments(owner_id);
CREATE INDEX idx_billing_payments_status   ON public.billing_payments(status);
CREATE INDEX idx_billing_payments_due_date ON public.billing_payments(due_date);

CREATE POLICY "Anyone views billing plans" ON public.billing_plans FOR SELECT USING (true);
CREATE POLICY "Owners view own payments" ON public.billing_payments FOR SELECT
  USING (owner_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Owners create payments" ON public.billing_payments FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Admins update payments" ON public.billing_payments FOR UPDATE
  USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete payments" ON public.billing_payments FOR DELETE
  USING (public.is_admin(auth.uid()));
CREATE POLICY "Owners view active bank details" ON public.admin_bank_details FOR SELECT
  USING (is_active = true);
CREATE POLICY "Admins manage bank details" ON public.admin_bank_details FOR ALL
  USING (admin_id = auth.uid() AND public.is_admin(auth.uid()));

INSERT INTO public.billing_plans (name, amount, duration_months, currency, plan_type) VALUES
  ('Basic — 6 Months',     900.00,  6,  'TT', 'basic'),
  ('Basic — Annual',      1800.00,  12, 'TT', 'basic'),
  ('Premium — Annual',    3000.00,  12, 'TT', 'premium'),
  ('Chain — Annual',      4500.00,  12, 'TT', 'chain'),
  ('Extra Store — Annual',1200.00,  12, 'TT', 'bar_only_addon')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- SECTION 10: CREDIT ACCOUNTS & TRANSACTIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.credit_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  contact_number  TEXT,
  id_image_url    TEXT,
  id_number       TEXT,
  balance_owed    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_account_id  UUID NOT NULL REFERENCES public.credit_accounts(id) ON DELETE CASCADE,
  owner_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  type               TEXT NOT NULL CHECK (type IN ('charge','payment')),
  amount             NUMERIC(12,2) NOT NULL,
  note               TEXT,
  items              JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_accounts     REPLICA IDENTITY FULL;
ALTER TABLE public.credit_transactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_transactions;

CREATE INDEX idx_credit_accounts_owner  ON public.credit_accounts(owner_id);
CREATE INDEX idx_credit_accounts_status ON public.credit_accounts(status);
CREATE INDEX idx_credit_tx_account      ON public.credit_transactions(credit_account_id);

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT fk_wallet_tx_credit_tx
  FOREIGN KEY (credit_tx_id) REFERENCES public.credit_transactions(id) ON DELETE SET NULL;

CREATE POLICY "View credit accounts in scope" ON public.credit_accounts FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Insert credit accounts" ON public.credit_accounts FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Update credit accounts" ON public.credit_accounts FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Delete credit accounts" ON public.credit_accounts FOR DELETE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));

CREATE POLICY "View credit transactions in scope" ON public.credit_transactions FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Insert credit transactions" ON public.credit_transactions FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()) AND cashier_id = auth.uid());
CREATE POLICY "Delete credit transactions" ON public.credit_transactions FOR DELETE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));

CREATE TRIGGER trg_credit_accounts_updated_at
  BEFORE UPDATE ON public.credit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- SECTION 11: STORE SESSIONS & SUB-SESSIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.store_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  float_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.store_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_store_sessions_owner  ON public.store_sessions(owner_id);
CREATE INDEX idx_store_sessions_opened ON public.store_sessions(owner_id, opened_at DESC);

CREATE POLICY "View store sessions" ON public.store_sessions FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Insert store sessions" ON public.store_sessions FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Update store sessions" ON public.store_sessions FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));

CREATE TABLE public.store_sub_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_session_id  UUID NOT NULL REFERENCES public.store_sessions(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  float_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  float_set_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.store_sub_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_store_sub_owner   ON public.store_sub_sessions(owner_id);
CREATE INDEX idx_store_sub_cashier ON public.store_sub_sessions(cashier_id);

CREATE POLICY "View store sub sessions" ON public.store_sub_sessions FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Insert store sub sessions" ON public.store_sub_sessions FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Update store sub sessions" ON public.store_sub_sessions FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 12: PRODUCT SORT ORDER
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.product_sort_order (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_json  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, cashier_id)
);

ALTER TABLE public.product_sort_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View sort order in scope" ON public.product_sort_order FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Upsert sort order" ON public.product_sort_order FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Update sort order" ON public.product_sort_order FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "Delete sort order" ON public.product_sort_order FOR DELETE
  USING (owner_id = public.get_owner_id(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 13: OWNER FINANCIALS & EXPENSES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.owner_financials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  initial_expense  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

CREATE TABLE public.owner_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL,
  description   TEXT,
  expense_type  TEXT,
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_expenses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_expenses   REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_expenses;

CREATE POLICY "owner_financials_all" ON public.owner_financials FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner_expenses_select" ON public.owner_expenses FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "owner_expenses_insert" ON public.owner_expenses FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "owner_expenses_update" ON public.owner_expenses FOR UPDATE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()));
CREATE POLICY "owner_expenses_delete" ON public.owner_expenses FOR DELETE
  USING (owner_id = public.get_owner_id(auth.uid()));

CREATE TRIGGER trg_owner_financials_updated_at
  BEFORE UPDATE ON public.owner_financials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- SECTION 14: CASHIER SALARIES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.cashier_salaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  frequency     TEXT CHECK (frequency IN ('daily','weekly','biweekly','monthly')),
  pay_day       INTEGER,
  pay_time      TEXT,
  next_pay_at   TIMESTAMPTZ,
  last_paid_at  TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cashier_id)
);

ALTER TABLE public.cashier_salaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashier_salaries_select" ON public.cashier_salaries FOR SELECT
  USING (owner_id = auth.uid());
CREATE POLICY "cashier_salaries_insert" ON public.cashier_salaries FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "cashier_salaries_update" ON public.cashier_salaries FOR UPDATE
  USING (owner_id = auth.uid());
CREATE POLICY "cashier_salaries_delete" ON public.cashier_salaries FOR DELETE
  USING (owner_id = auth.uid());

CREATE TRIGGER trg_cashier_salaries_updated_at
  BEFORE UPDATE ON public.cashier_salaries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- SECTION 15: TIME CARDS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.time_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_name    TEXT NOT NULL,
  clocked_in_at    TIMESTAMPTZ NOT NULL,
  clocked_out_at   TIMESTAMPTZ,
  work_date        DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.time_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_cards REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.time_cards;

CREATE INDEX idx_time_cards_owner     ON public.time_cards(owner_id);
CREATE INDEX idx_time_cards_employee  ON public.time_cards(employee_id);
CREATE INDEX idx_time_cards_work_date ON public.time_cards(owner_id, work_date DESC);
CREATE INDEX idx_time_cards_open      ON public.time_cards(employee_id) WHERE clocked_out_at IS NULL;

CREATE POLICY "time_cards_select" ON public.time_cards FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "time_cards_insert" ON public.time_cards FOR INSERT
  WITH CHECK (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "time_cards_update" ON public.time_cards FOR UPDATE
  USING (owner_id = public.get_owner_id(auth.uid()));
CREATE POLICY "time_cards_delete" ON public.time_cards FOR DELETE
  USING (owner_id = public.get_owner_id(auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- SECTION 16: STOCK CHECK ACTUALS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.stock_check_actuals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  actual_qty  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id)
);

ALTER TABLE public.stock_check_actuals ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_check_actuals;

CREATE POLICY "stock_actuals_owner" ON public.stock_check_actuals FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "stock_actuals_manager_read" ON public.stock_check_actuals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles m
    WHERE m.id = auth.uid()
      AND (m.role = 'manager' OR m.job_title = 'manager')
      AND m.parent_id = stock_check_actuals.owner_id
  ));
CREATE POLICY "stock_actuals_manager_write" ON public.stock_check_actuals FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles m
    WHERE m.id = auth.uid()
      AND (m.role = 'manager' OR m.job_title = 'manager')
      AND m.parent_id = stock_check_actuals.owner_id
  ));

-- ─────────────────────────────────────────────────────────────
-- SECTION 17: DEVICE TOKENS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'android',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, token)
);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_device_tokens_owner ON public.device_tokens(owner_id);

CREATE POLICY "Owner manages own tokens" ON public.device_tokens FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- SECTION 18: STORAGE BUCKET
-- ─────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read product images" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');
CREATE POLICY "Auth upload product images" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth update product images" ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete product images" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- SECTION 19: CORE TRIGGERS
-- ─────────────────────────────────────────────────────────────

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role public.app_role;
BEGIN
  _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'owner');
  INSERT INTO public.profiles (id, username, role, parent_id, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    _role,
    NULLIF(NEW.raw_user_meta_data->>'parent_id', '')::uuid,
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Credit cashier wallet on order insert
CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET wallet_balance = wallet_balance + NEW.total WHERE id = NEW.cashier_id;
  INSERT INTO public.wallet_transactions (profile_id, amount, type, note, order_id)
  VALUES (
    NEW.cashier_id, NEW.total, 'sale',
    'Sale' || CASE WHEN NEW.discount_amount IS NOT NULL AND NEW.discount_amount > 0
      THEN ' | Discount: $' || NEW.discount_amount::text ELSE '' END,
    NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_insert ON public.orders;
CREATE TRIGGER on_order_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_insert();

-- Reverse cashier wallet on order delete
CREATE OR REPLACE FUNCTION public.handle_order_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET wallet_balance = GREATEST(0, wallet_balance - OLD.total) WHERE id = OLD.cashier_id;
  DELETE FROM public.wallet_transactions WHERE order_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_order_delete ON public.orders;
CREATE TRIGGER on_order_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_delete();

-- Deduct stock on sale
CREATE OR REPLACE FUNCTION public.decrement_stock_on_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item JSONB; v_pid UUID; v_qty INTEGER;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    v_pid := (item->>'product_id')::UUID;
    v_qty := COALESCE((item->>'quantity')::INTEGER, 1);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock_qty = GREATEST(0, stock_qty - v_qty)
      WHERE id = v_pid AND owner_id = NEW.owner_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_order_insert_stock ON public.orders;
CREATE TRIGGER on_order_insert_stock
  AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.decrement_stock_on_sale();

-- Restore stock on order delete
CREATE OR REPLACE FUNCTION public.restore_stock_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item JSONB; v_pid UUID; v_qty INTEGER;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(OLD.items) LOOP
    v_pid := (item->>'product_id')::UUID;
    v_qty := COALESCE((item->>'quantity')::INTEGER, 1);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock_qty = stock_qty + v_qty
      WHERE id = v_pid AND owner_id = OLD.owner_id;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_order_delete_stock ON public.orders;
CREATE TRIGGER on_order_delete_stock
  BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.restore_stock_on_delete();

-- Sync stock_check_actuals when stock_qty changes
CREATE OR REPLACE FUNCTION public.sync_actual_qty_on_stock_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stock_qty IS DISTINCT FROM NEW.stock_qty THEN
    INSERT INTO public.stock_check_actuals (owner_id, product_id, actual_qty, updated_at)
    VALUES (NEW.owner_id, NEW.id, NEW.stock_qty, now())
    ON CONFLICT (owner_id, product_id) DO UPDATE
      SET actual_qty = EXCLUDED.actual_qty, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_actual_qty ON public.products;
CREATE TRIGGER trg_sync_actual_qty
  AFTER UPDATE OF stock_qty ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_actual_qty_on_stock_change();

-- ─────────────────────────────────────────────────────────────
-- SECTION 20: WALLET RPCs
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_cashier_to_owner(_cashier_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bal NUMERIC; _parent UUID; _username TEXT; _caller UUID := auth.uid();
BEGIN
  SELECT wallet_balance, parent_id, username INTO _bal, _parent, _username
    FROM public.profiles WHERE id = _cashier_id;
  IF _parent IS NULL OR _parent <> _caller THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _bal > 0 THEN
    UPDATE public.profiles SET wallet_balance = 0 WHERE id = _cashier_id;
    UPDATE public.profiles SET wallet_balance = wallet_balance + _bal WHERE id = _parent;
    INSERT INTO public.wallet_transactions (profile_id, amount, type, note)
      VALUES (_cashier_id, -_bal, 'transfer_out', 'Cleared to owner');
    INSERT INTO public.wallet_transactions (profile_id, amount, type, note)
      VALUES (_parent, _bal, 'transfer_in', 'Cleared from cashier: ' || _username);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_reset_wallet(_owner_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal NUMERIC; _caller UUID := auth.uid();
BEGIN
  IF _caller <> _owner_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT wallet_balance INTO _bal FROM public.profiles WHERE id = _owner_id;
  IF _bal <> 0 THEN
    UPDATE public.profiles SET wallet_balance = 0 WHERE id = _owner_id;
    INSERT INTO public.wallet_transactions (profile_id, amount, type, note)
      VALUES (_owner_id, -_bal, 'reset', 'Owner wallet reset');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_cashier_to_owner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_reset_wallet(UUID)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_cashier_to_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reset_wallet(UUID)        TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SECTION 21: CREDIT RPCs
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_credit_charge(
  p_credit_account_id UUID, p_cashier_id UUID, p_amount NUMERIC,
  p_items JSONB, p_note TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id UUID; v_account_name TEXT; v_cashier_name TEXT; v_tx_id UUID;
BEGIN
  SELECT owner_id, full_name INTO v_owner_id, v_account_name
    FROM public.credit_accounts WHERE id = p_credit_account_id;
  SELECT username INTO v_cashier_name FROM public.profiles WHERE id = p_cashier_id;
  INSERT INTO public.credit_transactions (credit_account_id, owner_id, cashier_id, type, amount, items, note)
  VALUES (p_credit_account_id, v_owner_id, p_cashier_id, 'charge', p_amount, p_items, COALESCE(p_note,'Credit sale'))
  RETURNING id INTO v_tx_id;
  UPDATE public.credit_accounts SET balance_owed = balance_owed + p_amount, status = 'open', updated_at = now()
    WHERE id = p_credit_account_id;
  INSERT INTO public.wallet_transactions (profile_id, amount, type, note, credit_tx_id)
  VALUES (v_owner_id, 0, 'credit_charge',
    'Credit: ' || COALESCE(v_account_name,'Customer') || ' | $' || p_amount::text
      || COALESCE(' | Cashier: '||v_cashier_name,''), v_tx_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_credit_payment(
  p_credit_account_id UUID, p_cashier_id UUID, p_amount NUMERIC
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id UUID; v_account_name TEXT; v_cashier_name TEXT; v_tx_id UUID;
BEGIN
  SELECT owner_id, full_name INTO v_owner_id, v_account_name
    FROM public.credit_accounts WHERE id = p_credit_account_id;
  SELECT username INTO v_cashier_name FROM public.profiles WHERE id = p_cashier_id;
  INSERT INTO public.credit_transactions (credit_account_id, owner_id, cashier_id, type, amount, note)
  VALUES (p_credit_account_id, v_owner_id, p_cashier_id, 'payment', p_amount, 'Payment received — $' || p_amount::text)
  RETURNING id INTO v_tx_id;
  UPDATE public.credit_accounts
    SET balance_owed = GREATEST(0, balance_owed - p_amount),
        status = CASE WHEN (balance_owed - p_amount) <= 0 THEN 'closed' ELSE 'open' END,
        updated_at = now()
  WHERE id = p_credit_account_id;
  INSERT INTO public.wallet_transactions (profile_id, amount, type, note, credit_tx_id)
  VALUES (v_owner_id, p_amount, 'credit_payment',
    'Credit payment: ' || COALESCE(v_account_name,'Customer') || ' | $' || p_amount::text
      || COALESCE(' | Cashier: '||v_cashier_name,''), v_tx_id);
  UPDATE public.profiles SET wallet_balance = wallet_balance + p_amount WHERE id = p_cashier_id;
  INSERT INTO public.wallet_transactions (profile_id, amount, type, note, credit_tx_id)
  VALUES (p_cashier_id, p_amount, 'credit_payment',
    'Credit payment collected: ' || COALESCE(v_account_name,'Customer'), v_tx_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_credit_charge(UUID,UUID,NUMERIC,JSONB,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_credit_payment(UUID,UUID,NUMERIC)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_credit_charge(UUID,UUID,NUMERIC,JSONB,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_payment(UUID,UUID,NUMERIC)           TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SECTION 22: BILLING TRIGGER FUNCTIONS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_billing_on_payment_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    NEW.next_due_date := NEW.due_date + (
      SELECT (duration_months || ' months')::INTERVAL FROM public.billing_plans WHERE id = NEW.plan_id
    );
    UPDATE public.profiles SET
      billing_status          = 'active',
      current_plan_id         = NEW.plan_id,
      subscription_start_date = COALESCE(subscription_start_date, NEW.payment_date),
      subscription_end_date   = NEW.next_due_date,
      plan_type               = (SELECT plan_type FROM public.billing_plans WHERE id = NEW.plan_id),
      status                  = 'approved'
    WHERE id = NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_billing_approval
  BEFORE UPDATE ON public.billing_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_billing_on_payment_approval();

CREATE TRIGGER trg_billing_payments_updated_at
  BEFORE UPDATE ON public.billing_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_admin_bank_details_updated_at
  BEFORE UPDATE ON public.admin_bank_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.check_overdue_payments()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles SET billing_status = 'expired'
  WHERE role = 'owner' AND billing_status = 'active' AND subscription_end_date < NOW();
  UPDATE public.profiles SET status = 'suspended'
  WHERE role = 'owner' AND billing_status = 'expired' AND status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.billing_payments WHERE owner_id = profiles.id AND status = 'pending'
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 23: ADMIN RPCs
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS TABLE (
  id uuid, username text, role public.app_role, status public.user_status,
  wallet_balance numeric, created_at timestamptz, parent_id uuid, email text,
  billing_status text, plan_type text, subscription_end_date timestamptz,
  chain_addon_active boolean, chain_bar_count integer, is_bar_account boolean,
  addon_bar_count integer, is_multi_bar boolean, phone text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN QUERY
    SELECT p.id, p.username, p.role, p.status, p.wallet_balance, p.created_at, p.parent_id,
           COALESCE(u.email,'')::text,
           p.billing_status, p.plan_type, p.subscription_end_date,
           p.chain_addon_active, p.chain_bar_count, p.is_bar_account,
           p.addon_bar_count, p.is_multi_bar, p.phone
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
  DELETE FROM public.profiles WHERE id = _user_id;
  DELETE FROM auth.users WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SECTION 24: CHAIN / MULTI-STORE RPCs
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_chain_bars(p_owner_id UUID)
RETURNS TABLE (id UUID, bar_name TEXT, bar_location TEXT, bar_number INTEGER, created_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username, COALESCE(p.address,''),
         ROW_NUMBER() OVER (ORDER BY p.created_at)::INTEGER, p.created_at
  FROM public.profiles p
  WHERE p.parent_id = p_owner_id AND p.is_bar_account = true
  ORDER BY p.created_at;
$$;

CREATE OR REPLACE FUNCTION public.create_bar_account(p_owner_id UUID, p_bar_name TEXT, p_location TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_new_id UUID; v_bar_count INTEGER; v_caller UUID := auth.uid(); v_email TEXT;
BEGIN
  IF v_caller <> p_owner_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_owner_id AND (chain_addon_active = true OR is_multi_bar = true)
  ) THEN RAISE EXCEPTION 'Chain or multi-store plan not active'; END IF;
  SELECT chain_bar_count INTO v_bar_count FROM public.profiles WHERE id = p_owner_id;
  IF v_bar_count >= 10 THEN RAISE EXCEPTION 'Maximum 10 stores reached'; END IF;
  v_new_id := gen_random_uuid();
  v_email  := 'store-' || v_new_id::text || '@chain.internal';
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, aud, role)
  VALUES (v_new_id, v_email, crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
    jsonb_build_object('username', p_bar_name, 'role', 'owner', 'parent_id', p_owner_id::text),
    now(), now(), 'authenticated', 'authenticated');
  INSERT INTO public.profiles (id, username, role, parent_id, wallet_balance, status, address, is_bar_account, plan_type)
  VALUES (v_new_id, p_bar_name, 'owner', p_owner_id, 0, 'approved', p_location, true, 'chain')
  ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, parent_id=EXCLUDED.parent_id,
    status=EXCLUDED.status, address=EXCLUDED.address, is_bar_account=EXCLUDED.is_bar_account, plan_type=EXCLUDED.plan_type;
  UPDATE public.profiles SET chain_bar_count = chain_bar_count + 1 WHERE id = p_owner_id;
  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_bar_account(p_bar_id UUID, p_owner_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() <> p_owner_id THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_bar_id AND parent_id = p_owner_id AND is_bar_account = true)
  THEN RAISE EXCEPTION 'Store not found or not owned by caller'; END IF;
  DELETE FROM auth.users WHERE id = p_bar_id;
  UPDATE public.profiles SET chain_bar_count = GREATEST(0, chain_bar_count - 1) WHERE id = p_owner_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_chain_bars(UUID)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bar_account(UUID,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_bar_account(UUID,UUID)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chain_bars(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bar_account(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bar_account(UUID,UUID)     TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SECTION 25: PROMOTE YOUR ADMIN ACCOUNT
-- ─────────────────────────────────────────────────────────────
-- 1. Sign up via the app using your admin email.
-- 2. Run this query (replace the email):
--
--    UPDATE public.profiles
--    SET role = 'admin', status = 'approved'
--    WHERE id = (SELECT id FROM auth.users WHERE email = 'your-admin@email.com');
--
-- ─────────────────────────────────────────────────────────────
-- OPTIONAL: pg_cron daily billing check (enable pg_cron first)
--
--   SELECT cron.schedule('check-overdue', '0 2 * * *', 'SELECT public.check_overdue_payments()');
--
-- ─────────────────────────────────────────────────────────────
-- TABLES CREATED:
--   profiles, products, product_variations, orders,
--   wallet_transactions, billing_plans, billing_payments,
--   admin_bank_details, credit_accounts, credit_transactions,
--   store_sessions, store_sub_sessions, product_sort_order,
--   owner_financials, owner_expenses, cashier_salaries,
--   time_cards, stock_check_actuals, device_tokens
-- ─────────────────────────────────────────────────────────────
