-- ============================================================
-- P.O.S. Pro billing plans
-- Archive all old Bartendaz plans, set up clean P.O.S. Pro plans
-- ============================================================

-- 1. Archive everything that isn't already archived
UPDATE public.billing_plans
SET name = '[Archived] ' || name
WHERE name NOT ILIKE '[Archived]%';

-- 2. Insert the P.O.S. Pro main plan — $1,800 TT/yr
INSERT INTO public.billing_plans (name, amount, duration_months, currency, plan_type)
VALUES ('P.O.S. Pro', 1800.00, 12, 'TT', 'basic')
ON CONFLICT DO NOTHING;

-- 3. Insert the addon extra store plan — $1,200 TT/yr
INSERT INTO public.billing_plans (name, amount, duration_months, currency, plan_type)
VALUES ('Extra Store', 1200.00, 12, 'TT', 'bar_only_addon')
ON CONFLICT DO NOTHING;
