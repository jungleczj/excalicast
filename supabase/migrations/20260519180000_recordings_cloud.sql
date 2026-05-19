-- ============================================================================
-- Cloud-backed recordings library (Pro/Max only).
--
-- recordings_cloud
--   Per-user index of recordings backed up to Supabase Storage. The actual
--   bytes (metadata.json + snapshots.json.gz + audio.webm + camera.webm) live
--   under storage bucket `recordings`, never as MP4.
--
--   IMPORTANT — product-level constraint (see CLAUDE.md):
--     Rendered MP4 is NEVER uploaded. Only the recording sources (event
--     stream + raw audio/camera webm) are stored. Final MP4 is always
--     rendered locally via ffmpeg.wasm in the browser.
--
-- storage.objects bucket policy
--   Bucket `recordings` is private. Each user can read/write only the
--   objects under their own `{user_id}/` prefix. Service role bypasses RLS
--   (used by /api/recordings/* routes if they need elevated access).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recordings_cloud (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text,
  started_at      timestamptz NOT NULL,
  duration_ms     integer NOT NULL,
  has_audio       boolean NOT NULL DEFAULT false,
  has_camera      boolean NOT NULL DEFAULT false,
  subtitle_srt    text,
  thumbnail       text, -- base64 data URL (small, last-frame thumbnail)
  storage_prefix  text NOT NULL,
  bytes_stored    bigint,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recordings_cloud_user
  ON public.recordings_cloud (user_id, started_at DESC);

ALTER TABLE public.recordings_cloud ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can list their own rows.
CREATE POLICY recordings_cloud_self_read
  ON public.recordings_cloud
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Insert/update/delete are gated via the service role in the API routes
-- (which enforce Pro tier before writing). RLS therefore denies direct
-- writes from the authenticated role.

CREATE TRIGGER recordings_cloud_touch
  BEFORE UPDATE ON public.recordings_cloud
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE  public.recordings_cloud                IS 'Cloud-backup index of recording sources (NOT MP4). Pro+ only. Writes via service role.';
COMMENT ON COLUMN public.recordings_cloud.storage_prefix IS 'Path prefix in storage bucket `recordings`, e.g. {user_id}/{recording_id}/';
COMMENT ON COLUMN public.recordings_cloud.subtitle_srt   IS 'Optional SRT text bound to the recording. Mirrors RecordingMetadata.subtitleSrt on the client.';

-- ---------- Storage bucket: recordings ------------------------------------
-- Private bucket. Each user owns their own prefix.

INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to manage objects only under their own prefix.
-- The path looks like `{user_id}/{recording_id}/<file>`; we check the first
-- folder segment.

DROP POLICY IF EXISTS "recordings_self_select" ON storage.objects;
CREATE POLICY "recordings_self_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "recordings_self_insert" ON storage.objects;
CREATE POLICY "recordings_self_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "recordings_self_update" ON storage.objects;
CREATE POLICY "recordings_self_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "recordings_self_delete" ON storage.objects;
CREATE POLICY "recordings_self_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
