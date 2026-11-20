-- KORA event wall: private rendered-ball MP4 bucket and approved clip metadata.
-- Run in Supabase SQL Editor before deploying the updated wall feed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kora-wall-media', 'kora-wall-media', false, 104857600, array['video/mp4'])
on conflict (id) do update set
  public = false,
  file_size_limit = 104857600,
  allowed_mime_types = array['video/mp4'];

create table if not exists public.kora_wall_ball_videos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  uploaded_at timestamptz not null default now(),
  approved boolean not null default false,
  event_screen_consent boolean not null default false,
  constraint ball_video_storage_path_valid check (
    storage_path ~ '^balls/[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+[.]mp4$'
    and length(storage_path) <= 350
  )
);

create index if not exists kora_wall_ball_videos_recent_approved_idx
  on public.kora_wall_ball_videos (uploaded_at desc)
  where approved = true and event_screen_consent = true;

alter table public.kora_wall_ball_videos enable row level security;
revoke all on table public.kora_wall_ball_videos from public, anon, authenticated;
grant select, insert, update, delete on public.kora_wall_ball_videos to service_role;

-- This table intentionally has no anon/authenticated RLS policies.
-- The Storage bucket is private. A trusted server-side uploader uses a
-- Supabase secret/service-role credential; never embed it in browser code.
-- Only approved and consented clips uploaded within the previous hour appear.
