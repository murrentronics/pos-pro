-- Update admin_list_profiles to include addon_bar_count and is_multi_bar
DROP FUNCTION IF EXISTS public.admin_list_profiles();

CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS TABLE (
  id uuid, username text, role public.app_role, status public.user_status,
  wallet_balance numeric, created_at timestamptz, parent_id uuid, email text,
  phone text, address text, plan_type text, chain_bar_count integer,
  is_bar_account boolean, addon_bar_count integer, is_multi_bar boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  RETURN QUERY
    SELECT
      p.id,
      p.username,
      p.role,
      p.status,
      p.wallet_balance,
      p.created_at,
      p.parent_id,
      COALESCE(u.email, '')::text,
      p.phone,
      p.address,
      COALESCE(p.plan_type, 'basic')::text,
      COALESCE(p.chain_bar_count, 0)::integer,
      COALESCE(p.is_bar_account, false)::boolean,
      COALESCE(p.addon_bar_count, 0)::integer,
      COALESCE(p.is_multi_bar, false)::boolean
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.role IN ('owner', 'admin');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles() TO authenticated;
