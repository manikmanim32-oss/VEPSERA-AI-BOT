-- Run this file in Supabase SQL Editor.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
drop policy if exists "Users manage own conversations" on public.conversations;
create policy "Users manage own conversations" on public.conversations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.knowledge_documents enable row level security;
drop policy if exists "Users manage own knowledge documents" on public.knowledge_documents;
create policy "Users manage own knowledge documents" on public.knowledge_documents
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Create a public storage bucket for image-to-video reference uploads.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vespera-media','vespera-media',true,15728640,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "Signed-in users upload VESPERA media" on storage.objects;
create policy "Signed-in users upload VESPERA media" on storage.objects
for insert to authenticated with check (bucket_id='vespera-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Public read VESPERA media" on storage.objects;
create policy "Public read VESPERA media" on storage.objects
for select to public using (bucket_id='vespera-media');
