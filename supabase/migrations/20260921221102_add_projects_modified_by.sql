alter table public.projects
  add column if not exists modified_by uuid null references public.users(id);
