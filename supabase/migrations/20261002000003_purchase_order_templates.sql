create table if not exists public.purchase_order_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  supplier_name text,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.purchase_order_templates enable row level security;

drop policy if exists "purchase order templates in scope" on public.purchase_order_templates;
create policy "purchase order templates in scope"
  on public.purchase_order_templates
  for all
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
