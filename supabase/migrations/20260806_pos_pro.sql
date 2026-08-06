-- =============================================================================
-- P.O.S. Pro — Migration (idempotent, additive only)
-- =============================================================================

-- ── profiles: add missing columns ────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS store_session_start  timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS store_closed_at       timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cashier_float         numeric     DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cashier_float_set_at  timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS addon_bar_count        integer     DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_multi_bar           boolean     DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title              text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_login              boolean     DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cashier_access         text[];

-- ── store_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at  timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_sessions_owner_idx ON public.store_sessions(owner_id);

-- ── store_sub_sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_sub_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_session_id uuid        REFERENCES public.store_sessions(id) ON DELETE CASCADE,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  cashier_float    numeric     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_sub_sessions ADD COLUMN IF NOT EXISTS store_session_id uuid REFERENCES public.store_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.store_sub_sessions ADD COLUMN IF NOT EXISTS cashier_float numeric DEFAULT 0;
CREATE INDEX IF NOT EXISTS store_sub_sessions_owner_idx ON public.store_sub_sessions(owner_id);

-- ── store_categories ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  icon       text        NOT NULL DEFAULT '📦',
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_categories_owner_idx ON public.store_categories(owner_id);
ALTER TABLE public.store_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='store_categories' AND policyname='store_categories_owner') THEN
    CREATE POLICY store_categories_owner ON public.store_categories FOR ALL TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

-- ── specials ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.specials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  special_price numeric     NOT NULL DEFAULT 0,
  required_qty  integer     NOT NULL DEFAULT 1,
  product_ids   uuid[]      NOT NULL DEFAULT '{}',
  is_recurring  boolean     NOT NULL DEFAULT false,
  run_days      text[],
  start_date    date,
  start_time    time,
  end_date      date,
  end_time      time,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specials_owner_idx ON public.specials(owner_id);
ALTER TABLE public.specials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='specials' AND policyname='specials_owner') THEN
    CREATE POLICY specials_owner ON public.specials FOR ALL TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

-- ── time_cards ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.time_cards (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cashier_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  clocked_in_at  timestamptz NOT NULL DEFAULT now(),
  clocked_out_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Add columns if table existed without them
ALTER TABLE public.time_cards ADD COLUMN IF NOT EXISTS owner_id   uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.time_cards ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS time_cards_owner_idx   ON public.time_cards(owner_id);
CREATE INDEX IF NOT EXISTS time_cards_cashier_idx ON public.time_cards(cashier_id);
ALTER TABLE public.time_cards ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='time_cards' AND policyname='time_cards_owner') THEN
    CREATE POLICY time_cards_owner ON public.time_cards FOR ALL TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

-- ── stock_check_actuals ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_check_actuals (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  actual_qty numeric     NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, product_id)
);
CREATE INDEX IF NOT EXISTS stock_check_actuals_owner_idx ON public.stock_check_actuals(owner_id);
ALTER TABLE public.stock_check_actuals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_check_actuals' AND policyname='stock_check_actuals_owner') THEN
    CREATE POLICY stock_check_actuals_owner ON public.stock_check_actuals FOR ALL TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

-- ── cashier_last_delete ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cashier_last_delete (
  cashier_id uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id   uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_name  text        NOT NULL DEFAULT '',
  qty        integer     NOT NULL DEFAULT 0,
  price      numeric     NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
-- Add owner_id if table existed without it
ALTER TABLE public.cashier_last_delete ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.cashier_last_delete ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cashier_last_delete' AND policyname='cashier_last_delete_rls') THEN
    CREATE POLICY cashier_last_delete_rls ON public.cashier_last_delete FOR ALL TO authenticated
      USING (cashier_id = auth.uid());
  END IF;
END $$;

-- ── bar_sort_order ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bar_sort_order (
  owner_id   uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_json jsonb       NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bar_sort_order ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bar_sort_order' AND policyname='bar_sort_order_owner') THEN
    CREATE POLICY bar_sort_order_owner ON public.bar_sort_order FOR ALL TO authenticated
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

-- ── Realtime ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.store_sessions;      EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.store_sub_sessions;  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.store_categories;    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.specials;            EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.time_cards;          EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
