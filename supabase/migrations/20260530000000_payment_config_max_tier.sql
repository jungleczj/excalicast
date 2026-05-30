-- payment_config — 加入 Max 套餐字段 + 更新已发布价格
--
-- 背景：Max 套餐之前只在应用类型/权限里存在，支付层完全没有对应价格列与 product id，
-- 导致 Max 无法真正购买。这里补齐 max_monthly_price_cents / max_product_id，
-- 并把现有行的 one_time / pro 价格更新到当前发布价（$4.99 / $9.99，Max 默认 $15.99）。

BEGIN;

ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS max_monthly_price_cents INT NOT NULL DEFAULT 1599
    CHECK (max_monthly_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS max_product_id TEXT;

-- 把现有行更新到新发布价（保守保护：仅当仍是旧默认值时才改，避免覆盖已自定义的行）
UPDATE public.payment_config SET one_time_price_cents = 499 WHERE one_time_price_cents = 300;
UPDATE public.payment_config SET pro_monthly_price_cents = 999 WHERE pro_monthly_price_cents = 900;

COMMIT;
