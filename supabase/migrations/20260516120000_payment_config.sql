-- payment_config — single-row table that controls which payment provider
-- (paddle / creem) the app uses and the displayed prices.
--
-- Behaviour:
--   - Row absent → app falls back to env vars (legacy Paddle behaviour).
--   - Row present → values from the row override env.
--   - Admin POST /api/admin/payment-config edits this row in place.
--
-- Single-row enforcement via CHECK (id = 1).

CREATE TABLE IF NOT EXISTS public.payment_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL DEFAULT 'paddle' CHECK (provider IN ('paddle', 'creem')),
  currency TEXT NOT NULL DEFAULT 'usd',
  one_time_price_cents INTEGER NOT NULL DEFAULT 300 CHECK (one_time_price_cents >= 0),
  pro_monthly_price_cents INTEGER NOT NULL DEFAULT 900 CHECK (pro_monthly_price_cents >= 0),
  paddle_one_time_price_id TEXT,
  paddle_pro_price_id TEXT,
  creem_one_time_product_id TEXT,
  creem_pro_product_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Touch updated_at on every UPDATE (consistent with our other tables).
CREATE OR REPLACE FUNCTION public.touch_payment_config_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_config_touch ON public.payment_config;
CREATE TRIGGER trg_payment_config_touch
  BEFORE UPDATE ON public.payment_config
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_payment_config_updated_at();

-- RLS: this table is **only** read/written via the service role (admin route).
-- Public / anon clients never touch it directly — they go through
-- /api/payment/provider which exposes a pruned view.
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

-- No policies → with RLS enabled and no policies, only the service_role
-- (which bypasses RLS) can read/write. anon / authenticated are denied.
