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

ALTER TABLE public.dubbing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dubbing_jobs_self_read ON public.dubbing_jobs;
CREATE POLICY dubbing_jobs_self_read ON public.dubbing_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS dubbing_jobs_touch ON public.dubbing_jobs;
CREATE TRIGGER dubbing_jobs_touch
  BEFORE UPDATE ON public.dubbing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
