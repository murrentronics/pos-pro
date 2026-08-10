-- ─── Fix: custom workers (no login) violate profiles_id_fkey ─────────────────
-- The profiles table has a FK: profiles.id → auth.users.id
-- Custom workers are inserted with a random UUID (no auth.users row), which
-- causes "insert or update on table profiles violates foreign key constraint
-- profiles_id_fkey".  Drop the constraint to allow no-login profile rows.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- ─── Ensure enum values exist (idempotent) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'custom'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'app_role')
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'custom';
  END IF;
END $$;

-- ─── Ensure columns exist (idempotent) ───────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_login BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── RLS: owner can insert / delete their own custom worker rows ──────────────
DROP POLICY IF EXISTS "Owner can insert custom worker profiles" ON public.profiles;
CREATE POLICY "Owner can insert custom worker profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (
    parent_id IS NOT NULL
    AND parent_id = auth.uid()
    AND has_login = FALSE
  );

DROP POLICY IF EXISTS "Owner can delete custom worker profiles" ON public.profiles;
CREATE POLICY "Owner can delete custom worker profiles"
  ON public.profiles FOR DELETE
  USING (
    parent_id IS NOT NULL
    AND parent_id = auth.uid()
    AND has_login = FALSE
  );
