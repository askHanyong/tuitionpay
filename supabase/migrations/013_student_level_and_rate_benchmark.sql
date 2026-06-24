alter table students add column if not exists level text;

create or replace function public.rate_benchmark(p_subject text, p_level text)
returns table (avg_rate numeric, min_rate numeric, max_rate numeric, sample_size bigint)
language sql
security definer
set search_path = public
as $$
  select
    avg(hourly_rate)::numeric(10,2),
    min(hourly_rate)::numeric(10,2),
    max(hourly_rate)::numeric(10,2),
    count(*)
  from students
  where subject = p_subject
    and level = p_level
    and hourly_rate is not null;
$$;

grant execute on function public.rate_benchmark(text, text) to authenticated;
