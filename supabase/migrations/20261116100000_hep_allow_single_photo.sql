-- Prepared (NOT yet applied live): allow 1 to 4 still photos on public.exercises instead of requiring 2 to 4.
-- Re-runnable: looks up and drops the auto-generated / existing media_keys cardinality check from pg_constraint,
-- then adds a named check constraint permitting stills with 1 to 4 keys.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.exercises'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%cardinality(media_keys)%'
  loop
    execute format('alter table public.exercises drop constraint if exists %I', v_name);
  end loop;

  alter table public.exercises
    add constraint exercises_media_keys_check check (
      (media_type = 'none' and cardinality(media_keys) = 0) or
      (media_type = 'gif' and cardinality(media_keys) = 1) or
      (media_type = 'stills' and cardinality(media_keys) between 1 and 4)
    );
end $$;
