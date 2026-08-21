BEGIN;

ALTER TABLE public.dubbing_jobs
  ADD COLUMN IF NOT EXISTS source_srt_hash text,
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS total_chunks integer,
  ADD COLUMN IF NOT EXISTS completed_chunks integer,
  ADD COLUMN IF NOT EXISTS elapsed_ms bigint,
  ADD COLUMN IF NOT EXISTS eta_ms bigint,
  ADD COLUMN IF NOT EXISTS decoder text,
  ADD COLUMN IF NOT EXISTS fallback_reason text;

CREATE TABLE IF NOT EXISTS public.dubbing_job_chunks (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES public.dubbing_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  text_content text NOT NULL,
  text_hash text NOT NULL,
  voice_name text NOT NULL,
  speech_rate text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  mp3_path text,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS dubbing_jobs_reuse_idx
  ON public.dubbing_jobs (user_id, source_audio_hash, source_srt_hash, voice_name, created_at DESC);

CREATE INDEX IF NOT EXISTS dubbing_job_chunks_job_idx
  ON public.dubbing_job_chunks (job_id, chunk_index);
CREATE INDEX IF NOT EXISTS dubbing_job_chunks_pending_idx
  ON public.dubbing_job_chunks (job_id, status, chunk_index)
  WHERE status IN ('pending','failed');

ALTER TABLE public.dubbing_job_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dubbing_job_chunks FROM anon;
REVOKE ALL ON TABLE public.dubbing_job_chunks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dubbing_job_chunks TO service_role;

DROP TRIGGER IF EXISTS dubbing_job_chunks_touch ON public.dubbing_job_chunks;
CREATE TRIGGER dubbing_job_chunks_touch
  BEFORE UPDATE ON public.dubbing_job_chunks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
