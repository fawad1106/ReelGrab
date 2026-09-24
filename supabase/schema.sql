-- ReelGrab Supabase schema
-- Storage remains private; ReelGrab's FastAPI backend handles downloads.
-- Downloads are currently anonymous; user_id is nullable until authentication
-- is wired into the API.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username varchar(40) unique not null,
  password_hash text not null,
  email varchar(255),
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  token varchar(128) primary key,
  user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx
  on public.app_sessions (user_id);

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  reel_url text not null,
  file_name text,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  file_url text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists downloads_user_id_created_at_idx
  on public.downloads (user_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.downloads enable row level security;

revoke all on public.app_users from anon, authenticated;
revoke all on public.app_sessions from anon, authenticated;
revoke all on public.downloads from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', false)
on conflict (id) do nothing;
