-- ReelGrab Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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

alter table public.downloads enable row level security;

create policy "Users can view their own downloads"
on public.downloads
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own downloads"
on public.downloads
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own downloads"
on public.downloads
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own downloads"
on public.downloads
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', false)
on conflict (id) do nothing;

create policy "Users can read their own download files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'downloads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can upload their own download files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'downloads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own download files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'downloads'
  and (storage.foldername(name))[1] = auth.uid()::text
);