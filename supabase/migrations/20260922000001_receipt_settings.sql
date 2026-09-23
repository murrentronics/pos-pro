-- Per-bar receipt header: name, footer tagline, and a black-and-white logo.
CREATE TABLE IF NOT EXISTS public.receipt_settings (
  owner_id   UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bar_name   TEXT,
  tagline    TEXT,
  logo_data  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipt_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read receipt settings in scope" ON public.receipt_settings;
DROP POLICY IF EXISTS "Owner inserts receipt settings" ON public.receipt_settings;
DROP POLICY IF EXISTS "Owner updates receipt settings" ON public.receipt_settings;

CREATE POLICY "Read receipt settings in scope"
  ON public.receipt_settings FOR SELECT
  USING (owner_id = public.get_owner_id(auth.uid()));

CREATE POLICY "Owner inserts receipt settings"
  ON public.receipt_settings FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND public.is_owner(auth.uid()));

CREATE POLICY "Owner updates receipt settings"
  ON public.receipt_settings FOR UPDATE
  USING (owner_id = auth.uid() AND public.is_owner(auth.uid()))
  WITH CHECK (owner_id = auth.uid() AND public.is_owner(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.receipt_settings TO authenticated;
