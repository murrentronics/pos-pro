-- Managers are created with role = 'manager'. The earlier policy only
-- matched cashiers whose job_title is manager, so opening the store and
-- Update Float changed nothing on the owner's cashier_float.

DROP POLICY IF EXISTS "Manager can update owner bar session" ON public.profiles;
CREATE POLICY "Manager can update owner bar session"
  ON public.profiles
  FOR UPDATE
  USING (
    id = (
      SELECT parent_id FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role::text = 'manager' OR job_title = 'manager')
    )
  )
  WITH CHECK (
    id = (
      SELECT parent_id FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role::text = 'manager' OR job_title = 'manager')
    )
  );
