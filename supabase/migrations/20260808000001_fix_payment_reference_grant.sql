-- Grant execute on generate_payment_reference to authenticated users
-- Without this, authenticated users get "permission denied" which surfaces
-- as "Failed to generate reference" in the billing page.
GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO anon;
