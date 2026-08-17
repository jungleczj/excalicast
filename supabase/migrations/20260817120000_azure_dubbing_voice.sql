ALTER TABLE public.dubbing_jobs
  ADD COLUMN IF NOT EXISTS voice_name text,
  ADD COLUMN IF NOT EXISTS voice_register text
    CHECK (voice_register IS NULL OR voice_register IN ('masculine','feminine','uncertain')),
  ADD COLUMN IF NOT EXISTS voice_confidence double precision,
  ADD COLUMN IF NOT EXISTS billable_characters integer,
  ADD COLUMN IF NOT EXISTS synthesis_chunk_count integer;

NOTIFY pgrst, 'reload schema';
