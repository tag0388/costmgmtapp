alter table public.enterprises
  add column if not exists public_id varchar(20) not null
  default ('ent_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

create unique index if not exists enterprises_public_id_uidx
  on public.enterprises(public_id);

alter table public.projects
  add column if not exists public_id varchar(20) not null
  default ('prj_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

create unique index if not exists projects_public_id_uidx
  on public.projects(public_id);
