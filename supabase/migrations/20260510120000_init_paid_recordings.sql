-- ============================================================================
-- Initial schema: paid_recordings (one-time anonymous purchase to unlock
-- watermark removal for a specific recording).
--
-- This table mirrors the existing better-sqlite3 schema in src/lib/db.ts so
-- that the Next.js API routes can switch from local SQLite to Supabase
-- Postgres without changing application logic.
--
-- Access pattern:
--   - All writes happen in /api/paddle-webhook (server-side, service-role key)
--   - All reads happen in /api/is-paid (server-side, service-role key)
--   - The browser never touches this table directly → RLS is enabled with no
--     anon/authenticated policies (defense in depth; service-role bypasses RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.paid_recordings (
  recording_id           text PRIMARY KEY,
  paid_at                timestamptz NOT NULL DEFAULT now(),
  amount_cents           integer NOT NULL,
  currency               text NOT NULL,
  paddle_transaction_id  text NOT NULL,
  raw_payload            text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paid_recordings_paddle
  ON public.paid_recordings (paddle_transaction_id);

ALTER TABLE public.paid_recordings ENABLE ROW LEVEL SECURITY;

-- No anon / authenticated policies. Service-role (used by Next.js API routes)
-- bypasses RLS, so the application keeps working. If a future feature needs
-- the browser to query this table directly, add a SELECT policy here scoped
-- to the recording owner.

COMMENT ON TABLE  public.paid_recordings              IS 'One-time anonymous unlocks (per-recording watermark removal). Written by Paddle webhook only.';
COMMENT ON COLUMN public.paid_recordings.recording_id IS 'Client-generated UUID, matches IndexedDB recording id (browser-local).';
COMMENT ON COLUMN public.paid_recordings.amount_cents IS 'Paddle transaction total in minor units (e.g. cents).';
COMMENT ON COLUMN public.paid_recordings.raw_payload  IS 'Verbatim webhook body; kept for audit / dispute resolution.';
