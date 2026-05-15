-- ============================================================================
-- Migrate user_subscriptions / subtitle_jobs to Supabase Auth.
--
-- Previously user_id was `text` to host any NextAuth token.sub. Now the
-- app uses Supabase Auth directly, so user_id is `uuid` referencing
-- auth.users(id). RLS switches from `(auth.jwt() ->> 'sub') = user_id`
-- to `(SELECT auth.uid()) = user_id`.
--
-- Safe because the upstream migrations were applied against a clean
-- project (test data already cleared); production has no real users yet.
-- If you ever have prod rows, write a data migration first.
-- ============================================================================

DROP TABLE IF EXISTS public.subtitle_jobs;
DROP TABLE IF EXISTS public.user_subscriptions;

CREATE TABLE public.user_subscriptions (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                    public.subscription_tier   NOT NULL DEFAULT 'free',
  status                  public.subscription_status NOT NULL DEFAULT 'inactive',
  paddle_subscription_id  text,
  paddle_customer_id      text,
  current_period_end      timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  raw_payload             text
);

CREATE INDEX idx_user_subscriptions_paddle
  ON public.user_subscriptions (paddle_subscription_id);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_subscriptions_self_read
  ON public.user_subscriptions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE  public.user_subscriptions                    IS 'Pro/Max subscription state, written by Paddle webhook only. user_id FK auth.users(id).';
COMMENT ON COLUMN public.user_subscriptions.user_id            IS 'Supabase auth.users.id (uuid). FK cascades on delete.';
COMMENT ON COLUMN public.user_subscriptions.current_period_end IS 'When the current paid billing period ends. cancelled subs still entitled until this moment.';

CREATE TABLE public.subtitle_jobs (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recording_id  text NOT NULL,
  status        public.subtitle_job_status NOT NULL DEFAULT 'pending',
  task_id       text,
  audio_token   text,
  srt           text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subtitle_jobs_user        ON public.subtitle_jobs (user_id);
CREATE INDEX idx_subtitle_jobs_recording   ON public.subtitle_jobs (recording_id);
CREATE INDEX idx_subtitle_jobs_audio_token ON public.subtitle_jobs (audio_token);

ALTER TABLE public.subtitle_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY subtitle_jobs_self_read
  ON public.subtitle_jobs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE  public.subtitle_jobs              IS 'Qwen ASR transcription jobs. Written by /api/asr/* server routes only.';
COMMENT ON COLUMN public.subtitle_jobs.audio_token  IS 'Random per-job nonce, exposed via /api/asr/audio/[token] for DashScope to fetch.';

-- Re-attach the updated_at trigger (function already exists from the
-- previous migration; just re-create the bindings since we dropped+recreated
-- the tables).

DROP TRIGGER IF EXISTS user_subscriptions_touch ON public.user_subscriptions;
CREATE TRIGGER user_subscriptions_touch
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS subtitle_jobs_touch ON public.subtitle_jobs;
CREATE TRIGGER subtitle_jobs_touch
  BEFORE UPDATE ON public.subtitle_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
