-- ============================================================
-- Admin account: renard@posprott.com
-- Password must be set via Auth (Dashboard or signup) — this
-- SQL only ensures the profile is role=admin once the auth
-- user exists. Also safe if auth row is created first.
--
-- Demo SQL fix note: profiles has NO email column. Use the
-- updated 20261003000001 migration (has_login only).
-- ============================================================

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('renard@posprott.com')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'renard@posprott.com not in auth.users yet — create the Auth user first, then re-run this SQL';
    RETURN;
  END IF;

  UPDATE auth.users
  SET
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('username', 'renard', 'role', 'admin'),
    updated_at = now()
  WHERE id = v_user_id;

  INSERT INTO public.profiles (
    id, username, role, parent_id, wallet_balance, status,
    billing_status, has_login
  ) VALUES (
    v_user_id, 'renard', 'admin', null, 0, 'approved',
    'active', true
  )
  ON CONFLICT (id) DO UPDATE SET
    username       = 'renard',
    role           = 'admin',
    parent_id      = null,
    status         = 'approved',
    billing_status = 'active',
    has_login      = true;

  RAISE NOTICE 'Admin profile ready for renard@posprott.com (%)', v_user_id;
END;
$$;
