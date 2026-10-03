-- ============================================================
-- Create non-billable demo owner accounts:
--   demo1@posprott.com / 123456
--   demo2@posprott.com / 123456
--
-- Approved + active, no billing_payments. Frontend hides these
-- emails from admin billable lists (see src/lib/demoAccounts.ts).
-- Idempotent.
-- ============================================================

DO $$
DECLARE
  r            RECORD;
  v_user_id    UUID;
  v_pw         TEXT;
  v_end        TIMESTAMPTZ := '2099-12-31 23:59:59+00';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('demo1@posprott.com'::text, 'demo1'::text),
      ('demo2@posprott.com'::text, 'demo2'::text)
    ) AS t(email, username)
  LOOP
    v_pw := crypt('123456', gen_salt('bf'));
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(r.email) LIMIT 1;

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        id, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, aud, role
      ) VALUES (
        v_user_id,
        r.email,
        v_pw,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('username', r.username, 'role', 'owner'),
        now(), now(), 'authenticated', 'authenticated'
      );

      -- Needed for email/password login on hosted Supabase Auth
      BEGIN
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at
        ) VALUES (
          v_user_id,
          v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', r.email, 'email_verified', true),
          'email',
          r.email,
          now(), now(), now()
        );
      EXCEPTION WHEN undefined_table OR undefined_column OR unique_violation THEN
        RAISE NOTICE 'identities insert skipped for %: %', r.email, SQLERRM;
      END;

      RAISE NOTICE 'Created auth user % (%)', r.email, v_user_id;
    ELSE
      UPDATE auth.users
      SET
        encrypted_password = v_pw,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('username', r.username, 'role', 'owner'),
        updated_at = now()
      WHERE id = v_user_id;

      BEGIN
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at
        )
        SELECT
          v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', r.email, 'email_verified', true),
          'email', r.email, now(), now(), now()
        WHERE NOT EXISTS (
          SELECT 1 FROM auth.identities
          WHERE user_id = v_user_id AND provider = 'email'
        );
      EXCEPTION WHEN undefined_table OR undefined_column OR unique_violation THEN
        RAISE NOTICE 'identities upsert skipped for %: %', r.email, SQLERRM;
      END;

      RAISE NOTICE 'Updated auth user % (%)', r.email, v_user_id;
    END IF;

    INSERT INTO public.profiles (
      id, username, role, parent_id, wallet_balance, status,
      billing_status, plan_type, subscription_start_date, subscription_end_date,
      has_login
    ) VALUES (
      v_user_id, r.username, 'owner', null, 0, 'approved',
      'active', 'basic', now(), v_end,
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      username                 = EXCLUDED.username,
      role                     = 'owner',
      parent_id                = null,
      status                   = 'approved',
      billing_status           = 'active',
      plan_type                = COALESCE(public.profiles.plan_type, 'basic'),
      subscription_start_date  = COALESCE(public.profiles.subscription_start_date, EXCLUDED.subscription_start_date),
      subscription_end_date    = GREATEST(
        COALESCE(public.profiles.subscription_end_date, EXCLUDED.subscription_end_date),
        EXCLUDED.subscription_end_date
      ),
      has_login                = true;

    DELETE FROM public.billing_payments WHERE owner_id = v_user_id;
  END LOOP;
END;
$$;
