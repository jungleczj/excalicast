-- payment_config — 改为多行表 + is_active 布尔切换
--
-- 旧 schema (id=1 单行宽表) 改为 4 行 (creem×live, creem×test, paddle×live, paddle×test)。
-- 字段通用（apiKey/webhookSecret/apiBase/oneTimeProductId/proProductId），每行只填
-- 该 (provider, mode) 自己需要的字段，其余 NULL。
--
-- is_active=TRUE 全表唯一，由 unique partial index 保证。
-- /api/admin/payment-config 按 (provider, mode) upsert；activate 端点事务切换 is_active。
--
-- RLS：service-role only（保留旧行为，policy 留空）

BEGIN;

-- 1) Snapshot 旧行
CREATE TEMP TABLE _old_payment_config AS
  SELECT * FROM public.payment_config WHERE id = 1;

-- 2) DROP 旧表（trigger 会一起没掉）
DROP TABLE IF EXISTS public.payment_config CASCADE;

-- 3) 新表
CREATE TABLE public.payment_config (
  id        SERIAL PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  provider  TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
  mode      TEXT NOT NULL CHECK (mode IN ('live','test')),
  currency  TEXT NOT NULL DEFAULT 'usd',
  one_time_price_cents    INT NOT NULL CHECK (one_time_price_cents >= 0),
  pro_monthly_price_cents INT NOT NULL CHECK (pro_monthly_price_cents >= 0),

  -- 通用凭证字段（语义由 provider 决定）
  api_key             TEXT,
  webhook_secret      TEXT,
  api_base            TEXT,
  one_time_product_id TEXT,
  pro_product_id      TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (provider, mode)
);

-- 4) is_active=TRUE 全表唯一
CREATE UNIQUE INDEX one_active_config
  ON public.payment_config (is_active) WHERE is_active = TRUE;

-- 5) updated_at trigger
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

-- 6) RLS service-role only
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

-- 7) Backfill 4 行
--    creem live: is_active=TRUE 当旧表 provider='creem' (默认就是)
--    paddle live: is_active=TRUE 当旧表 provider='paddle'
--    creem/paddle test: 空壳，等 admin 后续填

INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents,
  api_base, one_time_product_id, pro_product_id
)
SELECT
  CASE WHEN COALESCE(provider, 'creem') = 'creem' THEN TRUE ELSE FALSE END,
  'creem', 'live',
  COALESCE(currency, 'usd'),
  COALESCE(one_time_price_cents, 300),
  COALESCE(pro_monthly_price_cents, 900),
  'https://api.creem.io/v1',
  creem_one_time_product_id,
  creem_pro_product_id
FROM _old_payment_config;

-- 如果旧表没数据（首次部署），插一个默认 creem live 空壳
INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents,
  api_base
)
SELECT TRUE, 'creem', 'live', 'usd', 300, 900, 'https://api.creem.io/v1'
WHERE NOT EXISTS (SELECT 1 FROM public.payment_config WHERE provider='creem' AND mode='live');

INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents,
  one_time_product_id, pro_product_id
)
SELECT
  CASE WHEN COALESCE(provider, 'creem') = 'paddle' THEN TRUE ELSE FALSE END,
  'paddle', 'live',
  COALESCE(currency, 'usd'),
  COALESCE(one_time_price_cents, 300),
  COALESCE(pro_monthly_price_cents, 900),
  paddle_one_time_price_id,
  paddle_pro_price_id
FROM _old_payment_config;

INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents
)
SELECT FALSE, 'paddle', 'live', 'usd', 300, 900
WHERE NOT EXISTS (SELECT 1 FROM public.payment_config WHERE provider='paddle' AND mode='live');

-- test 行空壳
INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents,
  api_base
) VALUES (
  FALSE, 'creem', 'test', 'usd', 300, 900, 'https://test-api.creem.io/v1'
)
ON CONFLICT (provider, mode) DO NOTHING;

INSERT INTO public.payment_config (
  is_active, provider, mode, currency,
  one_time_price_cents, pro_monthly_price_cents
) VALUES (
  FALSE, 'paddle', 'test', 'usd', 300, 900
)
ON CONFLICT (provider, mode) DO NOTHING;

DROP TABLE _old_payment_config;

COMMIT;
