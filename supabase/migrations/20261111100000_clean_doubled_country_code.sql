-- One-time repair of phone numbers stored with the country code twice ("+91 +91 98765 43210") or with a 91 in front of
-- a 10-digit "+91" number. Mirrors `tidyPhone` in src/domain/countryCodes.ts: a real number is never touched, and one that
-- merely starts with 91 stays as it is (only 12 digits in all with a leading 91 is treated as the code repeated).
create or replace function public.tidy_phone(v text) returns text
language plpgsql immutable as $$
declare
  t text;
  m text[];
  nat text;
begin
  if v is null then return null; end if;
  t := btrim(regexp_replace(v, '[‎‏‪-‮]', '', 'g'));
  m := regexp_match(t, '^(\+\d{1,4})[\s-]*\1[\s-]*(\d[\d\s-]*)$');
  if m is not null then
    nat := regexp_replace(m[2], '[\s-]', '', 'g');
    if m[1] = '+91' and length(nat) = 12 and left(nat, 2) = '91' then nat := substr(nat, 3); end if;
    return m[1] || ' ' || nat;
  end if;
  m := regexp_match(t, '^\+91[\s-]*(\d[\d\s-]*)$');
  if m is not null then
    nat := regexp_replace(m[1], '[\s-]', '', 'g');
    if length(nat) = 12 and left(nat, 2) = '91' then return '+91 ' || substr(nat, 3); end if;
  end if;
  return v;
end $$;

update public.patients set phone = public.tidy_phone(phone) where phone is distinct from public.tidy_phone(phone);
update public.patients set alt_phone = public.tidy_phone(alt_phone) where alt_phone is distinct from public.tidy_phone(alt_phone);
update public.appointments set patient_phone = public.tidy_phone(patient_phone) where patient_phone is distinct from public.tidy_phone(patient_phone);
update public.appointment_requests set phone = public.tidy_phone(phone) where phone is distinct from public.tidy_phone(phone);

drop function public.tidy_phone(text);
