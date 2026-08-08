-- Durable private media reference for ASR jobs. Source bytes live in the
-- private `recordings` bucket so function instances never exchange data via /tmp.

ALTER TABLE public.subtitle_jobs
  ADD COLUMN IF NOT EXISTS asset_path text,
  ADD COLUMN IF NOT EXISTS asset_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text;
