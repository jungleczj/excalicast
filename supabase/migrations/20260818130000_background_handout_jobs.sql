-- Repair the production dubbing schema, allow long recording source uploads,
-- and persist outline/handout generation independently from request lifetime.

BEGIN;

ALTER TABLE public.dubbing_jobs
  ADD COLUMN IF NOT EXISTS voice_name text,
  ADD COLUMN IF NOT EXISTS voice_register text
    CHECK (voice_register IS NULL OR voice_register IN ('masculine','feminine','uncertain')),
  ADD COLUMN IF NOT EXISTS voice_confidence double precision,
  ADD COLUMN IF NOT EXISTS billable_characters integer,
  ADD COLUMN IF NOT EXISTS synthesis_chunk_count integer;

CREATE TABLE IF NOT EXISTS public.handout_jobs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recording_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handout_jobs_user_recording_idx
  ON public.handout_jobs (user_id, recording_id, created_at DESC);
CREATE INDEX IF NOT EXISTS handout_jobs_pending_idx
  ON public.handout_jobs (status, updated_at)
  WHERE status IN ('pending','running');

ALTER TABLE public.handout_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS handout_jobs_self_read ON public.handout_jobs;
CREATE POLICY handout_jobs_self_read ON public.handout_jobs
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.handout_jobs FROM anon;
REVOKE ALL ON TABLE public.handout_jobs FROM authenticated;
GRANT SELECT ON TABLE public.handout_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.handout_jobs TO service_role;

-- At 300 kbps a one-hour camera source is roughly 135 MB. Keep enough room
-- for long recordings and resumable-upload overhead without making the bucket public.
UPDATE storage.buckets
SET file_size_limit = 1073741824
WHERE id = 'recordings';

NOTIFY pgrst, 'reload schema';

COMMIT;
