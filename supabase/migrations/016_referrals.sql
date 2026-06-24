alter table tutors add column if not exists referral_code text;
alter table tutors add column if not exists referred_by text;
create unique index if not exists tutors_referral_code_idx on tutors (referral_code);

create or replace function public.generate_referral_code(p_full_name text, p_email text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidate text;
begin
  base := upper(regexp_replace(coalesce(p_full_name, split_part(p_email, '@', 1)), '[^a-zA-Z]', '', 'g'));
  if base = '' then
    base := 'TUTOR';
  end if;
  base := substr(base, 1, 5);

  loop
    candidate := base || extract(year from now())::text || lpad(floor(random() * 100)::text, 2, '0');
    if not exists (select 1 from tutors where referral_code = candidate) then
      return candidate;
    end if;
  end loop;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.tutors (id, full_name, email, referral_code, referred_by)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    public.generate_referral_code(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'referred_by'
  );
  return new;
end;
$$;

update tutors
set referral_code = public.generate_referral_code(full_name, email)
where referral_code is null;

create or replace function public.referral_count()
returns integer
language sql
security definer set search_path = public
stable
as $$
  select count(*)::integer
  from tutors t
  where t.referred_by = (select referral_code from tutors where id = auth.uid())
    and exists (select 1 from students s where s.tutor_id = t.id);
$$;

grant execute on function public.referral_count() to authenticated;
