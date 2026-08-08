-- Create generate_payment_reference function and grant execute
CREATE OR REPLACE FUNCTION public.generate_payment_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  ref    TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    ref := 'PP' || TO_CHAR(NOW(), 'YYYYMMDD') || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    SELECT EXISTS(SELECT 1 FROM public.billing_payments WHERE reference_number = ref) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  RETURN ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payment_reference() TO anon;
