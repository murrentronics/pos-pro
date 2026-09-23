-- Staff first / last name, stock count sheets, and sale labels like "Manager: Tom".

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

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

-- ── Stock count tables ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_count_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_count_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD their own stock count tables" ON public.stock_count_tables;
CREATE POLICY "Users can CRUD their own stock count tables"
ON public.stock_count_tables
FOR ALL
USING (auth.uid() = profile_id)
WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Owner can delete stock count tables for staff" ON public.stock_count_tables;
CREATE POLICY "Owner can delete stock count tables for staff"
ON public.stock_count_tables
FOR DELETE
USING (
  (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = profile_id AND parent_id = auth.uid()
    )
  )
  OR
  (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.profiles staff
      JOIN public.profiles bar ON bar.id = staff.parent_id
      WHERE staff.id = profile_id
        AND bar.parent_id = auth.uid()
        AND bar.is_bar_account = true
    )
  )
);

DROP POLICY IF EXISTS "Owner can insert stock count tables for staff" ON public.stock_count_tables;
CREATE POLICY "Owner can insert stock count tables for staff"
ON public.stock_count_tables
FOR INSERT
WITH CHECK (
  (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = profile_id AND parent_id = auth.uid()
    )
  )
  OR
  (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.profiles staff
      JOIN public.profiles bar ON bar.id = staff.parent_id
      WHERE staff.id = profile_id
        AND bar.parent_id = auth.uid()
        AND bar.is_bar_account = true
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_count_tables_profile ON public.stock_count_tables(profile_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_tables_owner ON public.stock_count_tables(owner_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_count_tables;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.copy_stock_count_tables_to_staff(
  p_owner_id  UUID,
  p_staff_ids UUID[],
  p_tables    JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.stock_count_tables
  WHERE owner_id = p_owner_id
    AND profile_id = ANY(p_staff_ids);

  INSERT INTO public.stock_count_tables (id, profile_id, owner_id, name, columns, rows, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    staff_id,
    p_owner_id,
    (tbl->>'name'),
    (tbl->'columns'),
    (tbl->'rows'),
    now(),
    now()
  FROM
    unnest(p_staff_ids) AS staff_id,
    jsonb_array_elements(p_tables) AS tbl;
END;
$$;

GRANT EXECUTE ON FUNCTION public.copy_stock_count_tables_to_staff(UUID, UUID[], JSONB) TO authenticated;

-- New sales: owner wallet line is "Manager: Tom" or "Cashier: Sarah", with discount kept.
CREATE OR REPLACE FUNCTION public.handle_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items_text    TEXT;
  v_discount_text TEXT := '';
  v_label         TEXT;
BEGIN
  UPDATE public.profiles
    SET wallet_balance = wallet_balance + NEW.total
    WHERE id = NEW.cashier_id;

  INSERT INTO public.wallet_transactions(profile_id, amount, type, note, order_id)
    VALUES (NEW.cashier_id, NEW.total, 'sale', 'Order sale', NEW.id);

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
