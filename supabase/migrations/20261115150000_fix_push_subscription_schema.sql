do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'p256dh_key'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'p256dh'
  ) then
    alter table public.push_subscriptions
      rename column p256dh_key to p256dh;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'auth_key'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'auth'
  ) then
    alter table public.push_subscriptions
      rename column auth_key to auth;
  end if;
end
$$;

alter table public.push_subscriptions
  add column if not exists user_agent text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

notify pgrst, 'reload schema';
