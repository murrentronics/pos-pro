-- Add barcode column to products table for barcode scanning
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;

-- Index for fast barcode lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);

-- RLS: owners can read/write barcode on their products (inherits existing policy)
-- No additional policy needed — existing owner policies cover all columns.
