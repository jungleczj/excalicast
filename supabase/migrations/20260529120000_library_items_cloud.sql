-- Per-user Excalidraw library (template) cloud sync.
-- Mirrors the recordings_cloud pattern: user_id FK + RLS self policies.
-- Library items are small JSON, stored directly as jsonb (no Storage bucket).
-- Gated to pro/max at the API layer (cloudBackup permission), same as recordings.

create table if not exists public.library_items_cloud (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,                       -- matches local LibraryItemRow.id (v1_xxx / uuid)
  status     text not null default 'unpublished',
  elements   jsonb not null,
  name       text,
  created    bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists idx_library_items_cloud_user
  on public.library_items_cloud (user_id, updated_at desc);

alter table public.library_items_cloud enable row level security;

-- Self read/write (RLS guarantees a user can only touch their own rows).
-- API routes use the service role + explicit user_id filter; these policies are
-- defense-in-depth and allow safe future direct-client access.
create policy library_self_select on public.library_items_cloud
  for select to authenticated using ((select auth.uid()) = user_id);
create policy library_self_insert on public.library_items_cloud
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy library_self_update on public.library_items_cloud
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy library_self_delete on public.library_items_cloud
  for delete to authenticated using ((select auth.uid()) = user_id);
