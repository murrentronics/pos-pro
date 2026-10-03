-- Fix renewal dates that were stacked past 1 year.
--
-- Bugs:
-- 1) Trigger set next_due_date = due_date + duration_months, but due_date was
--    already today + duration when the payment was created → +2 years.
-- 2) Extra Store (bar_only_addon) approvals also overwrote subscription_end_date,
--    stacking another year → e.g. paid 2026-08-08, Renews 2029-08-08.
--
-- Correct rule: annual basic plan renews payment_date + 12 months (or from the
-- current active end date on renewal). Addons never change subscription_end_date.

CREATE OR REPLACE FUNCTION public.update_billing_on_payment_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_duration_months INTEGER;
  v_plan_type       TEXT;
  v_existing_end    TIMESTAMPTZ;
  v_billing_status  TEXT;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN

    SELECT duration_months, plan_type
      INTO v_duration_months, v_plan_type
    FROM public.billing_plans
    WHERE id = NEW.plan_id;

    IF v_duration_months IS NULL THEN
      v_duration_months := 12;
    END IF;

    SELECT subscription_end_date, billing_status
      INTO v_existing_end, v_billing_status
    FROM public.profiles
    WHERE id = NEW.owner_id;

    IF v_plan_type IN ('basic', 'chain') THEN
      -- Renewal while still active: extend from current end. Otherwise from payment date.
      IF v_existing_end IS NOT NULL
         AND v_billing_status = 'active'
         AND v_existing_end > now() THEN
        NEW.next_due_date := v_existing_end + (v_duration_months || ' months')::INTERVAL;
      ELSE
        NEW.next_due_date := COALESCE(NEW.payment_date, now())
          + (v_duration_months || ' months')::INTERVAL;
      END IF;

      UPDATE public.profiles SET
        billing_status          = 'active',
        status                  = 'approved',
        current_plan_id         = NEW.plan_id,
        plan_type               = v_plan_type,
        subscription_start_date = COALESCE(
          subscription_start_date,
          COALESCE(NEW.payment_date, now())
        ),
        subscription_end_date   = NEW.next_due_date
      WHERE id = NEW.owner_id;

    ELSIF v_plan_type IN ('bar_only_addon', 'bar_addon', 'machines_bar_addon') THEN
      -- Extra store rides with the main plan — do not extend subscription_end_date.
      NEW.next_due_date := COALESCE(
        v_existing_end,
        COALESCE(NEW.payment_date, now()) + (v_duration_months || ' months')::INTERVAL
      );

    ELSIF v_plan_type = 'premium' THEN
      NEW.next_due_date := COALESCE(NEW.payment_date, now())
        + (v_duration_months || ' months')::INTERVAL;
      UPDATE public.profiles SET
        status                          = 'approved',
        billing_status                  = 'active',
        plan_type                       = 'premium',
        premium_subscription_start_date = COALESCE(NEW.payment_date, now()),
        premium_subscription_end_date   = NEW.next_due_date
      WHERE id = NEW.owner_id;

    ELSIF v_plan_type IN ('machines_addon', 'machines_only') THEN
      NEW.next_due_date := COALESCE(NEW.payment_date, now())
        + (v_duration_months || ' months')::INTERVAL;
      UPDATE public.profiles SET
        status                    = CASE WHEN v_plan_type = 'machines_only' THEN 'approved' ELSE status END,
        billing_status            = CASE WHEN v_plan_type = 'machines_only' THEN 'active' ELSE billing_status END,
        plan_type                 = CASE WHEN v_plan_type = 'machines_only' THEN 'machines_only' ELSE plan_type END,
        machines_addon_active     = true,
        machines_addon_start_date = COALESCE(NEW.payment_date, now()),
        machines_addon_end_date   = NEW.next_due_date
      WHERE id = NEW.owner_id;

    ELSE
      -- Unknown plan types: record next_due only, never touch main subscription end.
      NEW.next_due_date := COALESCE(NEW.payment_date, now())
        + (v_duration_months || ' months')::INTERVAL;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- One-time repair: set subscription_end_date from latest paid basic/chain payment
-- (payment_date + plan duration). Only shorten wrongly stacked future dates.
WITH latest_basic AS (
  SELECT DISTINCT ON (bp.owner_id)
    bp.owner_id,
    COALESCE(bp.payment_date, bp.approved_at, bp.created_at)
      + (COALESCE(pl.duration_months, 12) || ' months')::INTERVAL AS correct_end,
    COALESCE(bp.payment_date, bp.approved_at, bp.created_at)
      + (COALESCE(pl.duration_months, 12) || ' months')::INTERVAL AS next_due
  FROM public.billing_payments bp
  JOIN public.billing_plans pl ON pl.id = bp.plan_id
  WHERE bp.status = 'paid'
    AND pl.plan_type IN ('basic', 'chain')
  ORDER BY bp.owner_id, bp.approved_at DESC NULLS LAST, bp.created_at DESC NULLS LAST
)
UPDATE public.profiles p
SET subscription_end_date = lb.correct_end
FROM latest_basic lb
WHERE p.id = lb.owner_id
  AND p.role = 'owner'
  AND p.parent_id IS NULL
  AND p.billing_status = 'active'
  AND p.subscription_end_date IS NOT NULL
  AND p.subscription_end_date > lb.correct_end + INTERVAL '2 days';

-- Align next_due_date on those basic/chain payments
WITH latest_basic AS (
  SELECT DISTINCT ON (bp.owner_id)
    bp.id AS payment_id,
    COALESCE(bp.payment_date, bp.approved_at, bp.created_at)
      + (COALESCE(pl.duration_months, 12) || ' months')::INTERVAL AS next_due
  FROM public.billing_payments bp
  JOIN public.billing_plans pl ON pl.id = bp.plan_id
  WHERE bp.status = 'paid'
    AND pl.plan_type IN ('basic', 'chain')
  ORDER BY bp.owner_id, bp.approved_at DESC NULLS LAST, bp.created_at DESC NULLS LAST
)
UPDATE public.billing_payments bp
SET next_due_date = lb.next_due
FROM latest_basic lb
WHERE bp.id = lb.payment_id
  AND (bp.next_due_date IS NULL OR bp.next_due_date IS DISTINCT FROM lb.next_due);

-- Extra-store payments: next_due should match the owner's main plan end
UPDATE public.billing_payments bp
SET next_due_date = p.subscription_end_date
FROM public.profiles p,
     public.billing_plans pl
WHERE bp.owner_id = p.id
  AND bp.plan_id = pl.id
  AND bp.status = 'paid'
  AND pl.plan_type IN ('bar_only_addon', 'bar_addon', 'machines_bar_addon')
  AND p.subscription_end_date IS NOT NULL
  AND (bp.next_due_date IS NULL OR bp.next_due_date IS DISTINCT FROM p.subscription_end_date);
