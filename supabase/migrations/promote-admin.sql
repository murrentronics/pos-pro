-- ============================================================
-- Promote admin@gmail.com to admin role
-- Run this AFTER the user has signed up via the app.
-- ============================================================

UPDATE public.profiles
SET
  role   = 'admin',
  status = 'approved'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@gmail.com'
);

-- Verify:
SELECT id, username, role, status
FROM public.profiles
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@gmail.com');
