-- 关键用户事件落库，供后期 SQL 分析 + 后台 Dashboard。
-- 仅服务端 service-role 写入/读取（/api/analytics 写、/api/admin/analytics 读）；
-- RLS 开启但不建任何 client 策略 → 前端无法直插/直读（service-role 绕过 RLS）。

create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  event      text not null,
  props      jsonb not null default '{}'::jsonb,
  user_id    uuid null references auth.users(id) on delete set null,
  guest_id   text null,
  session_id text null,
  path       text,
  locale     text,
  referrer   text,
  ua         text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_event_time
  on public.analytics_events (event, created_at desc);
create index if not exists idx_analytics_events_time
  on public.analytics_events (created_at desc);
create index if not exists idx_analytics_events_user
  on public.analytics_events (user_id);

alter table public.analytics_events enable row level security;
-- 故意不建任何策略：authenticated/anon 一律拒绝；只有 service-role（绕过 RLS）可读写。
