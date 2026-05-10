-- ============================================================================
-- Pro membership: user_subscriptions + subtitle_jobs (Qwen ASR via DashScope).
--
-- user_subscriptions
--   Tracks Pro/Max recurring subscriptions provisioned by Paddle. Driven
--   entirely by Paddle webhooks (subscription.{activated,updated,cancelled,
--   paused,resumed,past_due,trialing}). The Next.js /api/me/tier endpoint
--   reads from this table to compute the effective tier of the current user.
--
-- subtitle_jobs
--   Tracks asynchronous Qwen ASR (DashScope paraformer-v2) transcription
--   jobs. The browser polls /api/asr/status which drives DashScope through
--   pending → running → done|failed.
--
-- IMPORTANT: subtitle generation is ALWAYS via Aliyun Qwen / DashScope.
--   OpenAI Whisper is forbidden by product-level constraint (CLAUDE.md).
--
-- IMPORTANT: there is **no recording duration cap** in this product. Free,
--   Pro, and Max users all enjoy unlimited recording duration. Do not add
--   any unlimited_duration / duration_limit columns or constraints.
-- ============================================================================

-- ---------- enums ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
    CREATE TYPE public.subscription_tier AS ENUM ('free', 'pro', 'max');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE public.subscription_status AS ENUM (
      'inactive', 'active', 'past_due', 'paused', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subtitle_job_status') THEN
    CREATE TYPE public.subtitle_job_status AS ENUM (
      'pending', 'running', 'done', 'failed'
    );
  END IF;
END $$;

-- ---------- user_subscriptions --------------------------------------------

-- user_id is `text` rather than `uuid` because we accept any NextAuth
-- token.sub (Google numeric sub, magic-link email-derived id, etc.). If
-- you migrate to Supabase Auth later, change this to `uuid REFERENCES
-- auth.users(id)` and add an FK.

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id                 text PRIMARY KEY,
  tier                    public.subscription_tier   NOT NULL DEFAULT 'free',
  status                  public.subscription_status NOT NULL DEFAULT 'inactive',
  paddle_subscription_id  text,
  paddle_customer_id      text,
  current_period_end      timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  raw_payload             text
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle
  ON public.user_subscriptions (paddle_subscription_id);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow an authenticated end-user to read their own subscription. This is
-- defensive: today the browser only goes through /api/me/tier (which uses
-- the service role), but enabling self-read keeps a future direct-from-client
-- path safe by default.
--
-- The cast (auth.jwt() ->> 'sub') = user_id assumes you put the same
-- identifier used by the app's NextAuth token.sub into the JWT under `sub`.
-- If you switch to Supabase Auth, replace with `auth.uid()::text = user_id`.
CREATE POLICY user_subscriptions_self_read
  ON public.user_subscriptions
  FOR SELECT
  TO authenticated
  -- Wrap auth.jwt() in a subquery so Postgres evaluates it once per query
  -- (initplan) instead of once per row. Required by Supabase advisor
  -- auth_rls_initplan, see docs/guides/database/postgres/row-level-security.
  USING ((SELECT auth.jwt() ->> 'sub') = user_id);

COMMENT ON TABLE  public.user_subscriptions                       IS 'Pro/Max subscription state, written by Paddle webhook only.';
COMMENT ON COLUMN public.user_subscriptions.user_id               IS 'NextAuth token.sub (text). If migrating to Supabase Auth, change to uuid + FK to auth.users.';
COMMENT ON COLUMN public.user_subscriptions.tier                  IS 'Effective subscription tier as resolved from the most recent Paddle event.';
COMMENT ON COLUMN public.user_subscriptions.status                IS 'Lifecycle status. cancelled with current_period_end > now() still counts as entitled — see /api/me/tier.';
COMMENT ON COLUMN public.user_subscriptions.current_period_end    IS 'When the current paid billing period ends. After cancellation, the user retains the tier until this moment.';

-- ---------- subtitle_jobs --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subtitle_jobs (
  id            text PRIMARY KEY,
  user_id       text NOT NULL,
  recording_id  text NOT NULL,
  status        public.subtitle_job_status NOT NULL DEFAULT 'pending',
  task_id       text,
  audio_token   text,
  srt           text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_user        ON public.subtitle_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_recording   ON public.subtitle_jobs (recording_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_audio_token ON public.subtitle_jobs (audio_token);

ALTER TABLE public.subtitle_jobs ENABLE ROW LEVEL SECURITY;

-- Self-read: an authenticated end-user can list / poll their own jobs.
CREATE POLICY subtitle_jobs_self_read
  ON public.subtitle_jobs
  FOR SELECT
  TO authenticated
  -- Wrap auth.jwt() in a subquery so Postgres evaluates it once per query
  -- (initplan) instead of once per row. Required by Supabase advisor
  -- auth_rls_initplan, see docs/guides/database/postgres/row-level-security.
  USING ((SELECT auth.jwt() ->> 'sub') = user_id);

COMMENT ON TABLE  public.subtitle_jobs              IS 'Qwen ASR transcription jobs (DashScope paraformer-v2). Written by /api/asr/* server routes only.';
COMMENT ON COLUMN public.subtitle_jobs.audio_token  IS 'Random per-job nonce; combined with /api/asr/audio/[token] gives DashScope a temporary fetchable URL.';
COMMENT ON COLUMN public.subtitle_jobs.task_id      IS 'DashScope async task id returned by audio/asr/transcription submit.';
COMMENT ON COLUMN public.subtitle_jobs.srt          IS 'Final SRT text (timestamps in ms → SRT HH:MM:SS,mmm format).';

-- ---------- updated_at touch trigger ---------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''           -- pin to empty to satisfy Supabase advisor
                                -- (function_search_path_mutable lint).
                                -- All identifiers here are built-ins (pg_catalog),
                                -- so an empty search_path is safe.
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_subscriptions_touch ON public.user_subscriptions;
CREATE TRIGGER user_subscriptions_touch
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS subtitle_jobs_touch ON public.subtitle_jobs;
CREATE TRIGGER subtitle_jobs_touch
  BEFORE UPDATE ON public.subtitle_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
