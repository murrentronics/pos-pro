-- Supplier name on products, and paid/unpaid on stock expense records.
alter table public.products
  add column if not exists supplier_name text;

alter table public.owner_expenses
  add column if not exists supplier_name text,
  add column if not exists is_paid boolean not null default true;
