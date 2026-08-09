-- Forward-only repair for media jobs deployed before their schema migrations.
-- This is intentionally idempotent so it also repairs a migration-history row
-- that was marked applied while the table/columns were absent.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subtitle_job_status') THEN
    CREATE TYPE public.subtitle_job_status AS ENUM ('pending', 'running', 'done', 'failed');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.subtitle_jobs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recording_id text NOT NULL,
  status public.subtitle_job_status NOT NULL DEFAULT 'pending',
  task_id text,
  audio_token text,
  asset_path text,
  asset_bytes bigint,
  mime_type text,
  srt text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subtitle_jobs
  ADD COLUMN IF NOT EXISTS asset_path text,
  ADD COLUMN IF NOT EXISTS asset_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text;

CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_user ON public.subtitle_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_recording ON public.subtitle_jobs (recording_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_audio_token ON public.subtitle_jobs (audio_token);

CREATE TABLE IF NOT EXISTS public.dubbing_jobs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recording_id text NOT NULL,
  target_lang text NOT NULL CHECK (target_lang = 'en'),
  source_audio_hash text NOT NULL,
  source_srt text,
  status text NOT NULL CHECK (status IN ('pending','running','done','failed')),
  audio_asset_path text,
  audio_type text,
  camera_asset_path text,
  camera_type text,
  translated_srt text,
  dubbed_audio_path text,
  dubbed_audio_type text,
  lip_sync_camera_path text,
  lip_sync_camera_type text,
  lip_sync text CHECK (lip_sync IS NULL OR lip_sync IN ('done','skipped','failed')),
  provider text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dubbing_jobs_user_created_idx
  ON public.dubbing_jobs (user_id, created_at DESC);

ALTER TABLE public.subtitle_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dubbing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subtitle_jobs_self_read ON public.subtitle_jobs;
CREATE POLICY subtitle_jobs_self_read ON public.subtitle_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS dubbing_jobs_self_read ON public.dubbing_jobs;
CREATE POLICY dubbing_jobs_self_read ON public.dubbing_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS subtitle_jobs_touch ON public.subtitle_jobs;
CREATE TRIGGER subtitle_jobs_touch
  BEFORE UPDATE ON public.subtitle_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS dubbing_jobs_touch ON public.dubbing_jobs;
CREATE TRIGGER dubbing_jobs_touch
  BEFORE UPDATE ON public.dubbing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

REVOKE ALL ON TABLE public.subtitle_jobs FROM anon;
REVOKE ALL ON TABLE public.dubbing_jobs FROM anon;
REVOKE ALL ON TABLE public.subtitle_jobs FROM authenticated;
REVOKE ALL ON TABLE public.dubbing_jobs FROM authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.subtitle_jobs TO authenticated;
GRANT SELECT ON TABLE public.dubbing_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subtitle_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dubbing_jobs TO service_role;

-- Supabase normally reloads PostgREST after DDL; this also repairs a stale
-- schema cache immediately when the migration is applied manually or by CI.
NOTIFY pgrst, 'reload schema';

COMMIT;
