-- Run this in Supabase SQL Editor (required for live username checks).
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT length(trim(p_username)) >= 3
     AND trim(p_username) ~ '^[a-z0-9_]+$'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE lower(username) = lower(trim(p_username))
     );
$$;

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated;
