-- Run this once in Supabase Dashboard > SQL Editor.
-- Row-level security ensures each signed-in user can access only their own workspace.
create table if not exists public.proforma_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.proforma_workspaces enable row level security;
revoke all on public.proforma_workspaces from anon;
grant select, insert, update, delete on public.proforma_workspaces to authenticated;
drop policy if exists "Users manage their own invoice workspace" on public.proforma_workspaces;
create policy "Users manage their own invoice workspace"
  on public.proforma_workspaces
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
