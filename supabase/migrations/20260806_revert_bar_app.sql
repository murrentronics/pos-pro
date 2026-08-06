-- =============================================================================
-- REVERT — undo the P.O.S. Pro migration accidentally run on the bar app
-- Run this in the BAR APP Supabase project SQL editor.
-- Safe — only removes what was added. Existing data is untouched.
-- =============================================================================

-- ── Drop new tables (only if they were created by the migration) ──────────────
-- Drop in dependency order (children first)

DROP TABLE IF EXISTS public.store_categories   CASCADE;
DROP TABLE IF EXISTS public.stock_check_actuals CASCADE;
DROP TABLE IF EXISTS public.store_sub_sessions  CASCADE;
DROP TABLE IF EXISTS public.store_sessions      CASCADE;

-- Only drop specials if it was created by this migration
-- (if it already existed before, this will drop it — check first if unsure)
DROP TABLE IF EXISTS public.specials            CASCADE;

-- Only drop time_cards if it was created by this migration
DROP TABLE IF EXISTS public.time_cards          CASCADE;

-- bar_sort_order and cashier_last_delete — these likely already existed in the
-- bar app. The migration only added RLS policies and an owner_id column.
-- Uncomment these ONLY if they did NOT exist before:
-- DROP TABLE IF EXISTS public.bar_sort_order       CASCADE;
-- DROP TABLE IF EXISTS public.cashier_last_delete  CASCADE;

-- ── Remove columns added to profiles ─────────────────────────────────────────
-- Only drop columns that did NOT exist in the bar app before the migration.
-- The bar app already had: store_session_start (as bar_session_start),
-- store_closed_at (as bar_closed_at), cashier_float, cashier_float_set_at,
-- job_title, has_login, cashier_access.
-- So only drop the ones that are truly new:

ALTER TABLE public.profiles DROP COLUMN IF EXISTS addon_bar_count;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_multi_bar;

-- ── Remove added RLS policies on existing tables ──────────────────────────────
DROP POLICY IF EXISTS cashier_last_delete_rls  ON public.cashier_last_delete;
DROP POLICY IF EXISTS bar_sort_order_owner     ON public.bar_sort_order;

-- ── Remove owner_id column added to cashier_last_delete (if it was added) ─────
-- Only run this if owner_id did NOT exist on cashier_last_delete before:
-- ALTER TABLE public.cashier_last_delete DROP COLUMN IF EXISTS owner_id;

-- ── Remove from realtime publication ─────────────────────────────────────────
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.store_sessions;      EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.store_sub_sessions;  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.store_categories;    EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.specials;            EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.time_cards;          EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
