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
| `public.dubbing_jobs`      | `/api/dubbing/*` (English dubbing tracking) | `20260801121000_dubbing_jobs.sql` |

NextAuth's `users` / `auth_sessions` SQLite tables are intentionally **not**
migrated — JWT-only sessions don't need DB rows, and password registration
is unused in production.

## Enums

- `subscription_tier`  — `free | pro | max`
- `subscription_status` — `inactive | active | past_due | paused | cancelled`
- `subtitle_job_status` — `pending | running | done | failed`

## Access model

Database writes and server-side Storage operations use the **service role key** (bypasses RLS):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key, server-only, never NEXT_PUBLIC_>
```

RLS is enabled on every table. Media-job tables explicitly grant only
`SELECT` to `authenticated`, constrained by an ownership policy, and
`SELECT`/`INSERT`/`UPDATE` to `service_role`. The service-role key is never
stored in a `NEXT_PUBLIC_*` variable or imported into browser code.

## Running the migrations

### Production deployment (recommended)

```bash
# from repo root
supabase link --project-ref <your-project-ref>
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Only one operator should run `db push`. Do not use `migration repair` unless
the migration history is known to disagree with the actual schema; that
command changes history only and does not create a missing table.

`20260808122144_repair_media_job_schema.sql` is a forward-only, idempotent
repair. It covers both missing media-job migrations and an already-recorded
migration whose table/columns are absent. It also restores RLS, explicit Data
API grants, and sends `NOTIFY pgrst, 'reload schema'`.

After deployment, verify in the SQL Editor (read-only query):

```sql
select
  to_regclass('public.subtitle_jobs') as subtitle_jobs,
  to_regclass('public.dubbing_jobs') as dubbing_jobs;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('subtitle_jobs', 'dubbing_jobs')
  and column_name in ('asset_path', 'asset_bytes', 'mime_type')
order by table_name, column_name;

select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('subtitle_jobs', 'dubbing_jobs');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('subtitle_jobs', 'dubbing_jobs')
order by table_name, grantee, privilege_type;
```

In Dashboard -> Integrations -> Data API, confirm the Data API is enabled and
`public` remains an exposed schema. Table grants and RLS are separate controls;
the migration configures both for these tables.

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

## 自定义登录邮件品牌（魔法链接）

默认情况下 Supabase 托管邮件的标题/正文/发件人都是 Supabase 品牌，用户收到
登录邮件会疑惑甚至找不到。品牌化分两层，**都需要在 Supabase 侧操作**（代码无法直接改）：

### 1. 邮件标题 + 正文（模板层）

仓库已备好 Excalicast 品牌模板：

- `supabase/templates/magic_link.html` — 魔法链接登录邮件（`signInWithOtp` 触发，主用）
- `supabase/templates/confirmation.html` — 新邮箱注册确认邮件

**方式 A（Dashboard，最直接）**：Authentication → Email Templates → 选 **Magic Link**，
把标题改成 `登录 Excalicast`、Message body 粘贴 `magic_link.html` 全文；
对 **Confirm signup** 同样粘贴 `confirmation.html`。

**方式 B（CLI）**：`supabase/config.toml` 已配好 `[auth.email.template.*]` 指向上述文件，
执行 `supabase config push` 推到远程项目（ref 见 `.temp/linked-project.json`）。
⚠️ `config push` 会同步整个 `[auth]` 配置，push 前先核对差异，避免覆盖 Dashboard 上的其它设置。

### 2. 发件人（去掉 Supabase 域名 + 解除频率限制）→ 自定义 SMTP

要让邮件从 `noreply@excalicast.cc` 发出（而非 Supabase 共享域名）、并解除默认 SMTP 的
低频限制，必须配置**自定义 SMTP**（推荐 Resend）：

1. **验证发送域名**：在 Resend 添加 `excalicast.cc`，按提示在域名 DNS 加 **SPF / DKIM** 记录，等验证通过。
2. **填 SMTP 凭证**：
   - Dashboard → Authentication → SMTP Settings 开启 Custom SMTP，填
     `host=smtp.resend.com`、`port=465`、`user=resend`、`pass=<Resend API Key>`、
     sender `noreply@excalicast.cc`、显示名 `Excalicast`；
   - 或把这些值放进 `.env.local`（见 `.env.local.example` 的 `SMTP_*` 段）后 `supabase config push`
     注入 `config.toml` 的 `[auth.email.smtp]`。
3. **URL Configuration**：确认 Authentication → URL Configuration 里
   Site URL = `https://excalicast.cc`、Redirect URLs 含 `https://excalicast.cc/api/auth/callback`。

代码侧发送链路（`LoginModal.tsx` 的 `signInWithOtp` + `emailRedirectTo`）**无需改动**——
它已用 `window.location.origin` 自适配域名。品牌化只发生在模板与 SMTP 配置层。

## Hard constraints (from CLAUDE.md, do not violate)

- ❌ Subtitles must use **Aliyun Qwen / DashScope**, never OpenAI Whisper.
  This schema reflects that: `subtitle_jobs.task_id` is the DashScope
  task id, not a Whisper job id.
- ❌ **No recording duration cap.** There is intentionally no
  `unlimited_duration` flag on `user_subscriptions` and no
  `duration_limit_ms` column anywhere — recording length is unlimited
  for every tier. If you find yourself adding such a column, stop.
