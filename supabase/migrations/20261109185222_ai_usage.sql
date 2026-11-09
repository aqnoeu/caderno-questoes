create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  provider text not null check (provider in ('groq', 'gemini')),
  model text not null,
  function_name text not null,
  http_status integer,
  total_tokens bigint,
  remaining_requests bigint,
  remaining_tokens bigint
);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant select on public.ai_usage_events to authenticated;
grant insert on public.ai_usage_events to service_role;
create policy ai_usage_admin_read on public.ai_usage_events for select to authenticated
  using ((select public.is_admin()));
create index ai_usage_started_idx on public.ai_usage_events (started_at desc);
create index ai_usage_groq_model_idx on public.ai_usage_events (model, id desc)
  where provider = 'groq' and (remaining_requests is not null or remaining_tokens is not null);

create table public.ai_gemini_daily_limits (
  model text primary key,
  requests_per_day integer not null check (requests_per_day > 0)
);
alter table public.ai_gemini_daily_limits enable row level security;
revoke all on public.ai_gemini_daily_limits from public, anon, authenticated;
grant select, insert, update, delete on public.ai_gemini_daily_limits to authenticated;
create policy ai_limits_admin on public.ai_gemini_daily_limits for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create function public.admin_ai_usage_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with recent as (
    select * from public.ai_usage_events where started_at >= now() - interval '7 days'
  ), breakdown as (
    select provider, model, function_name, count(*) as calls, sum(total_tokens) as tokens,
      count(*) filter (where http_status = 429) as limited,
      max(started_at) filter (where http_status = 429) as last_limit
    from recent group by provider, model, function_name
  ), groq as (
    select distinct on (model) model, started_at, remaining_requests, remaining_tokens
    from public.ai_usage_events where provider = 'groq'
      and (remaining_requests is not null or remaining_tokens is not null)
    order by model, id desc
  ), gemini as (
    select model, count(*) filter (where started_at >=
      date_trunc('day', now(), 'America/Los_Angeles') and http_status between 200 and 299) as calls_today
    from recent where provider = 'gemini' group by model
  )
  select jsonb_build_object(
    'breakdown', coalesce((select jsonb_agg(b order by calls desc) from breakdown b), '[]'::jsonb),
    'groq', coalesce((select jsonb_agg(g order by model) from groq g), '[]'::jsonb),
    'gemini', coalesce((
      select jsonb_agg(jsonb_build_object('model', model, 'calls_today', coalesce(calls_today, 0),
        'requests_per_day', requests_per_day) order by model)
      from gemini full join public.ai_gemini_daily_limits using (model)
    ), '[]'::jsonb)
  )
$$;
revoke execute on function public.admin_ai_usage_summary() from public, anon;
grant execute on function public.admin_ai_usage_summary() to authenticated;
