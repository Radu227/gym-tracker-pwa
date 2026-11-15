create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.inactivity_notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

alter table public.inactivity_notification_log enable row level security;

drop policy if exists inactivity_notification_log_own on public.inactivity_notification_log;
create policy inactivity_notification_log_own on public.inactivity_notification_log
  for select using (auth.uid() = user_id);

grant select on public.inactivity_notification_log to authenticated;
