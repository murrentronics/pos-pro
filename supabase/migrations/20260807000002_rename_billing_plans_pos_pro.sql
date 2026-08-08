-- ============================================================
-- P.O.S. Pro — Rename billing plan labels
--   "Bar Only"           → "P.O.S. Pro Annual Plan"   (plan_type = basic)
--   "Bar Only — Extra Bar" → "Extra Store"             (plan_type = bar_only_addon)
--   Any remaining Bartendaz/bar variant names cleaned up
-- ============================================================

-- 1. Main plan: rename "Bar Only" → "P.O.S. Pro Annual Plan"
UPDATE public.billing_plans
SET name = 'P.O.S. Pro Annual Plan'
WHERE plan_type = 'basic'
  AND name NOT ILIKE '[Archived]%';

-- 2. Extra store addon: rename "Bar Only — Extra Bar" → "Extra Store"
UPDATE public.billing_plans
SET name = 'Extra Store'
WHERE plan_type = 'bar_only_addon'
  AND name NOT ILIKE '[Archived]%';

-- 3. Update amount for basic plan to $1,800 (idempotent, confirms correct price)
UPDATE public.billing_plans
SET amount = 1800.00
WHERE plan_type = 'basic'
  AND name NOT ILIKE '[Archived]%';

-- 4. Update extra store addon amount to $1,200 (idempotent)
UPDATE public.billing_plans
SET amount = 1200.00
WHERE plan_type = 'bar_only_addon'
  AND name NOT ILIKE '[Archived]%';
