-- payment_config — 加入「按年」价格 + 年付 product id 字段
--
-- 背景：会员（Pro / Max）此前仅有月付价格列。新增年付能力：每行补 4 个字段，
-- 年价默认 = round(月价 × 12 × 0.8)（省 20%），年付 product id 默认 NULL。
-- 前端是否显示「年付」开关由两个 yearly product id 是否都已配置决定（yearlyAvailable），
-- 未配置 product id 时仅展示月付，不会下单到不存在的年付 product。
-- 订阅周期（月/年）由 Creem 自动按所选 product 报回，webhook 无需改动。

BEGIN;

ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS pro_yearly_price_cents INT NOT NULL DEFAULT 9590
    CHECK (pro_yearly_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS max_yearly_price_cents INT NOT NULL DEFAULT 15350
    CHECK (max_yearly_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS pro_yearly_product_id TEXT,
  ADD COLUMN IF NOT EXISTS max_yearly_product_id TEXT;

-- 按每行实际月价回填年价 = round(月价 × 12 × 0.8)，仅当仍是 ADD COLUMN 默认值时才改，
-- 避免覆盖已自定义年价的行（改完 WHERE 不再命中，等同幂等）。
UPDATE public.payment_config
  SET pro_yearly_price_cents = ROUND(pro_monthly_price_cents * 12 * 0.8)
  WHERE pro_yearly_price_cents = 9590;
UPDATE public.payment_config
  SET max_yearly_price_cents = ROUND(max_monthly_price_cents * 12 * 0.8)
  WHERE max_yearly_price_cents = 15350;

COMMIT;
