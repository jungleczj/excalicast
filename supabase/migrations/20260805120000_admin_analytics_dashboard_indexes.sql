-- Admin analytics dashboard filters.
-- No new raw personal or media data is collected here; this only adds indexes
-- over the existing service-role-only analytics_events table.

create index if not exists idx_analytics_events_locale_time
  on public.analytics_events (locale, created_at desc);

create index if not exists idx_analytics_events_session_time
  on public.analytics_events (session_id, created_at desc);

create index if not exists idx_analytics_events_guest_time
  on public.analytics_events (guest_id, created_at desc);

create index if not exists idx_analytics_events_entry_path_time
  on public.analytics_events ((props->>'entry_path'), created_at desc)
  where props ? 'entry_path';

create index if not exists idx_analytics_events_content_type_time
  on public.analytics_events ((props->>'content_type'), created_at desc)
  where props ? 'content_type';

create index if not exists idx_analytics_events_source_kind_time
  on public.analytics_events ((coalesce(props->>'source_kind', props->>'source')), created_at desc)
  where props ? 'source_kind' or props ? 'source';

create index if not exists idx_analytics_events_payment_provider_time
  on public.analytics_events ((coalesce(props->>'payment_provider', props->>'provider')), created_at desc)
  where props ? 'payment_provider' or props ? 'provider';

create index if not exists idx_analytics_events_campaign_time
  on public.analytics_events ((props->>'utm_campaign'), created_at desc)
  where props ? 'utm_campaign';
