# Supabase migrations — excalicast

Postgres schema mirroring `src/lib/db.ts` (better-sqlite3) so the Next.js
backend can switch from local SQLite to Supabase Postgres without changing
application logic.

## Tables

| Table | Owner | Migration |
|---|---|---|
| `public.paid_recordings`   | `/api/paddle-webhook` (one-time purchase) | `20260510120000_init_paid_recordings.sql` |
| `public.user_subscriptions`| `/api/paddle-webhook` (Pro/Max subscriptions) | `20260510120100_pro_subscriptions_and_subtitle_jobs.sql` |
| `public.subtitle_jobs`     | `/api/asr/*` (Qwen ASR tracking) | `20260510120100_pro_subscriptions_and_subtitle_jobs.sql` |

NextAuth's `users` / `auth_sessions` SQLite tables are intentionally **not**
migrated — JWT-only sessions don't need DB rows, and password registration
is unused in production.

## Enums

- `subscription_tier`  — `free | pro | max`
- `subscription_status` — `inactive | active | past_due | paused | cancelled`
- `subtitle_job_status` — `pending | running | done | failed`

## Access model

All routes hit Supabase with the **service role key** (bypasses RLS):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key, server-only, never NEXT_PUBLIC_>
```

RLS is enabled on every table. The only policies grant `authenticated`
read access to *their own* `user_subscriptions` and `subtitle_jobs` rows
(matched on `auth.jwt() ->> 'sub' = user_id`), as a defensive measure if
you ever query directly from the browser. Today the browser does not.

## Running the migrations

### Option 1 — Supabase CLI (recommended)

```bash
# from repo root
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option 2 — paste into the Supabase SQL Editor

Open the SQL Editor in the Supabase dashboard, run the two `.sql` files
in `supabase/migrations/` in filename order:

1. `20260510120000_init_paid_recordings.sql`
2. `20260510120100_pro_subscriptions_and_subtitle_jobs.sql`

## Switching the app from SQLite to Supabase

Not done in this commit. To do it later, replace the prepared-statement
bodies in `src/lib/db.ts` with calls to `@supabase/supabase-js` keyed by
the service-role key. Public function signatures stay the same so the
API routes don't change.

Sketch:

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function isRecordingPaid(recordingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('paid_recordings')
    .select('recording_id')
    .eq('recording_id', recordingId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
```

## Hard constraints (from CLAUDE.md, do not violate)

- ❌ Subtitles must use **Aliyun Qwen / DashScope**, never OpenAI Whisper.
  This schema reflects that: `subtitle_jobs.task_id` is the DashScope
  task id, not a Whisper job id.
- ❌ **No recording duration cap.** There is intentionally no
  `unlimited_duration` flag on `user_subscriptions` and no
  `duration_limit_ms` column anywhere — recording length is unlimited
  for every tier. If you find yourself adding such a column, stop.
