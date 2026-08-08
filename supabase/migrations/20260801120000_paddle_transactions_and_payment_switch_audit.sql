-- Paddle server-side transactions + provider-neutral payment storage.
--
-- Adds:
--   - payment_config.client_token for runtime Paddle.js initialization
--   - checkout_attempts for auditable checkout creation attempts
--   - payment_webhook_events for provider/event id idempotency
--   - provider-neutral user_subscriptions columns and multi-provider rows
--   - payment_config_audit + activate_payment_config() atomic switch RPC

BEGIN;

ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS client_token TEXT;

CREATE TABLE IF NOT EXISTS public.payment_config_audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
  mode TEXT NOT NULL CHECK (mode IN ('live','test')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_row JSONB,
  after_row JSONB
);

CREATE INDEX IF NOT EXISTS idx_payment_config_audit_created
  ON public.payment_config_audit(created_at);

ALTER TABLE public.payment_config_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'paddle' CHECK (provider IN ('creem','paddle')),
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

UPDATE public.user_subscriptions
  SET provider_subscription_id = COALESCE(provider_subscription_id, paddle_subscription_id),
      provider_customer_id = COALESCE(provider_customer_id, paddle_customer_id),
      last_event_occurred_at = COALESCE(last_event_occurred_at, updated_at)
  WHERE provider = 'paddle';

UPDATE public.user_subscriptions
  SET id = gen_random_uuid()
  WHERE id IS NULL;

ALTER TABLE public.user_subscriptions
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.user_subscriptions
  DROP CONSTRAINT IF EXISTS user_subscriptions_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_subscriptions_pkey'
      AND conrelid = 'public.user_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.user_subscriptions
      ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user
  ON public.user_subscriptions(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_subscriptions_provider_subscription_unique'
      AND conrelid = 'public.user_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.user_subscriptions
      ADD CONSTRAINT user_subscriptions_provider_subscription_unique
      UNIQUE (provider, provider_subscription_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
  mode TEXT NOT NULL CHECK (mode IN ('live','test')),
  kind TEXT NOT NULL CHECK (kind IN ('one_time','subscription')),
  tier public.subscription_tier,
  billing TEXT CHECK (billing IN ('monthly','yearly')),
  recording_id TEXT,
  user_id TEXT,
  product_id TEXT NOT NULL,
  provider_transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','created','failed')),
  raw_request TEXT,
  raw_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_attempts_provider_tx
  ON public.checkout_attempts(provider, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_checkout_attempts_user
  ON public.checkout_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_attempts_recording
  ON public.checkout_attempts(recording_id);

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS checkout_attempts_touch ON public.checkout_attempts;
CREATE TRIGGER checkout_attempts_touch
  BEFORE UPDATE ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ignored_reason TEXT,
  raw_payload TEXT NOT NULL,
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_type
  ON public.payment_webhook_events(provider, event_type);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.activate_payment_config(
  p_provider TEXT,
  p_mode TEXT,
  p_actor TEXT DEFAULT 'admin'
)
RETURNS SETOF public.payment_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
  v_after public.payment_config%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('creem', 'paddle') THEN
    RAISE EXCEPTION 'invalid provider: %', p_provider;
  END IF;
  IF p_mode NOT IN ('live', 'test') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  PERFORM 1
    FROM public.payment_config
    WHERE provider = p_provider AND mode = p_mode
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'activate_payment_config: no row for %/%', p_provider, p_mode;
  END IF;

  SELECT to_jsonb(pc.*)
    INTO v_before
    FROM public.payment_config pc
    WHERE pc.is_active = TRUE
    LIMIT 1
    FOR UPDATE;

  UPDATE public.payment_config
    SET is_active = FALSE
    WHERE is_active = TRUE;

  UPDATE public.payment_config
    SET is_active = TRUE
    WHERE provider = p_provider AND mode = p_mode
    RETURNING * INTO v_after;

  INSERT INTO public.payment_config_audit
    (actor, action, provider, mode, before_row, after_row)
  VALUES
    (COALESCE(NULLIF(p_actor, ''), 'admin'), 'activate', p_provider, p_mode, v_before, to_jsonb(v_after));

  RETURN NEXT v_after;
END;
$$;

COMMENT ON TABLE public.checkout_attempts IS 'Payment checkout creation attempts for Creem and Paddle.';
COMMENT ON TABLE public.payment_webhook_events IS 'Webhook idempotency ledger keyed by provider and event id.';
COMMENT ON TABLE public.payment_config_audit IS 'Admin payment_config activation audit log.';
COMMENT ON FUNCTION public.activate_payment_config(TEXT, TEXT, TEXT) IS 'Atomically switches the active payment_config row and writes an audit entry.';

REVOKE ALL ON FUNCTION public.activate_payment_config(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_payment_config(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.activate_payment_config(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_payment_config(TEXT, TEXT, TEXT) TO service_role;

COMMIT;
