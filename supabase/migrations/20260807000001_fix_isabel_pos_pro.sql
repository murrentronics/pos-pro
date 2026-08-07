-- Fix isabel@gmail.com demo account in P.O.S. Pro
-- UID: afb60f9f-1500-494d-9f50-49bfe80e602f
-- Run manually in Supabase SQL editor (already applied)

DO $$
DECLARE
  v_owner_id   UUID := 'afb60f9f-1500-494d-9f50-49bfe80e602f';
  v_sub_id     UUID;
  v_fake_email TEXT;
BEGIN

  -- 1. Fix master profile
  UPDATE public.profiles
  SET
    plan_type          = 'premium',
    chain_addon_active = false,
    is_multi_bar       = true,
    addon_bar_count    = 1,
    chain_bar_count    = 0,
    status             = 'approved',
    billing_status     = 'active'
  WHERE id = v_owner_id;

  -- 2. Delete leftover products
  DELETE FROM public.products WHERE owner_id = v_owner_id;

  -- 3. Remove old sub-accounts and their products
  DELETE FROM public.products
  WHERE owner_id IN (
    SELECT id FROM public.profiles
    WHERE parent_id = v_owner_id AND is_bar_account = true
  );

  DELETE FROM auth.users
  WHERE id IN (
    SELECT id FROM public.profiles
    WHERE parent_id = v_owner_id AND is_bar_account = true
  );

  -- 4. Create 1 additional store
  v_sub_id     := gen_random_uuid();
  v_fake_email := 'store-' || v_sub_id::text || '@pos.internal';

  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at, aud, role
  ) VALUES (
    v_sub_id, v_fake_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    now(),
    jsonb_build_object('username', 'La Columbiana 2', 'role', 'owner', 'parent_id', v_owner_id::text),
    now(), now(), 'authenticated', 'authenticated'
  );

  INSERT INTO public.profiles (
    id, username, role, parent_id, wallet_balance,
    status, address, is_bar_account,
    plan_type, chain_addon_active, billing_status
  ) VALUES (
    v_sub_id, 'La Columbiana 2', 'owner', v_owner_id, 0,
    'approved', 'Trinidad', true,
    'premium', false, 'active'
  ) ON CONFLICT (id) DO NOTHING;

  -- 5. Sync addon_bar_count
  UPDATE public.profiles
  SET addon_bar_count = (
    SELECT COUNT(*) FROM public.profiles
    WHERE parent_id = v_owner_id AND is_bar_account = true
  )
  WHERE id = v_owner_id;

  RAISE NOTICE 'Done';
END;
$$;

-- Fix get_chain_bars RPC to not reference removed columns
DROP FUNCTION IF EXISTS public.get_chain_bars(uuid);

CREATE OR REPLACE FUNCTION public.get_chain_bars(p_owner_id UUID)
RETURNS TABLE (
  id                   UUID,
  bar_name             TEXT,
  bar_location         TEXT,
  has_machines         BOOLEAN,
  is_machines_account  BOOLEAN,
  bar_number           INTEGER,
  created_at           TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id,
    p.username                                         AS bar_name,
    COALESCE(p.address, '')                            AS bar_location,
    false                                              AS has_machines,
    false                                              AS is_machines_account,
    ROW_NUMBER() OVER (ORDER BY p.created_at)::INTEGER AS bar_number,
    p.created_at
  FROM public.profiles p
  WHERE p.id = p_owner_id
     OR (p.parent_id = p_owner_id AND p.is_bar_account = true)
  ORDER BY p.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_chain_bars(uuid) TO authenticated;
