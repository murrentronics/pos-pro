-- ============================================================
-- Add "rejected" to the user_status enum type
-- ============================================================

ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'rejected';
