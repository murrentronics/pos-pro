create table if not exists public.owner_suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.owner_suppliers enable row level security;

drop policy if exists "owner manages suppliers" on public.owner_suppliers;
create policy "owner manages suppliers"
  on public.owner_suppliers for all
  using (
    owner_id = auth.uid()
    or owner_id = public.get_owner_id(auth.uid())
    or exists (
      select 1 from public.profiles
      where id = owner_id and parent_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    or owner_id = public.get_owner_id(auth.uid())
    or exists (
      select 1 from public.profiles
      where id = owner_id and parent_id = auth.uid()
    )
  );

insert into public.owner_suppliers (owner_id, name)
select distinct owner_id, btrim(supplier_name)
from public.products
where supplier_name is not null and btrim(supplier_name) <> ''
on conflict (owner_id, name) do nothing;

insert into public.owner_suppliers (owner_id, name)
select distinct owner_id, btrim(supplier_name)
from public.owner_expenses
where supplier_name is not null and btrim(supplier_name) <> ''
on conflict (owner_id, name) do nothing;
