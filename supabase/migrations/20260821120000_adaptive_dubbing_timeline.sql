ALTER TABLE public.dubbing_jobs
  ADD COLUMN IF NOT EXISTS localized_srt text,
  ADD COLUMN IF NOT EXISTS timing_map jsonb;

COMMENT ON COLUMN public.dubbing_jobs.localized_srt IS
  'Translated SRT retimed to the generated English audio timeline.';

COMMENT ON COLUMN public.dubbing_jobs.timing_map IS
  'Source-to-localized segment map used by preview and export video retiming.';

NOTIFY pgrst, 'reload schema';
