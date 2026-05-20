-- 2026-05-20: Drop cloud-backup schema.
--
-- Screen-record refactor (commit 887cde6 spec) removes cloud sync entirely.
-- Per spec: video / audio / subtitles / outline are all local-only from now on.
--
-- This migration:
--   1. Drops storage.objects policies bound to the `recordings` bucket
--   2. Removes the bucket itself (any uploaded objects are deleted)
--   3. Drops the `public.recordings_cloud` table and its trigger

DROP POLICY IF EXISTS "recordings_self_select" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_insert" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_update" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_delete" ON storage.objects;

-- Note: deleting from storage.buckets cascades into storage.objects for that bucket.
DELETE FROM storage.objects WHERE bucket_id = 'recordings';
DELETE FROM storage.buckets WHERE id = 'recordings';

DROP TRIGGER IF EXISTS recordings_cloud_touch ON public.recordings_cloud;
DROP TABLE IF EXISTS public.recordings_cloud;
