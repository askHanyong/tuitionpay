drop function if exists public.referral_count();
drop function if exists public.generate_referral_code(text, text);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.tutors (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

drop index if exists tutors_referral_code_idx;
alter table tutors drop column if exists referral_code;
alter table tutors drop column if exists referred_by;
