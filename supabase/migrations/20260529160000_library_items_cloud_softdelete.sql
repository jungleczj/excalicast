-- Cross-device delete propagation for the per-user library cloud sync.
-- A hard delete on device A could not reach device B (B still has the item
-- locally and would re-push it on next pull). Instead we soft-delete: the row
-- stays as a cloud tombstone (deleted=true) so other devices learn about the
-- deletion when they pull. Re-adding/re-importing the same id sets deleted=false.
alter table public.library_items_cloud
  add column if not exists deleted boolean not null default false;
