-- Stable opaque routing IDs for URLs and external API resource paths.
-- Internal UUID primary keys remain the canonical relational keys.

alter table public.enterprises
  add column if not exists public_id varchar(32);

update public.enterprises
set public_id = 'ent_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
where public_id is null;

alter table public.enterprises
  alter column public_id set default ('ent_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  alter column public_id set not null;

create unique index if not exists enterprises_public_id_uidx
  on public.enterprises(public_id);

alter table public.projects
  add column if not exists public_id varchar(32);

update public.projects
set public_id = 'prj_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
where public_id is null;

alter table public.projects
  alter column public_id set default ('prj_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  alter column public_id set not null;

create unique index if not exists projects_public_id_uidx
  on public.projects(public_id);
