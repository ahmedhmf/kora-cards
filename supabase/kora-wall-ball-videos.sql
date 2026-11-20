-- Run once in the linked Supabase project's SQL editor.
-- Separate, private event-approved rendered-ball MP4 feed.
-- No browser INSERT/SELECT permissions. Uploads must be performed by a
-- trusted server-side uploader with a service-role/secret credential.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kora-wall-media','kora-wall-media',false,104857600,array['video/mp4'])
on conflict (id) do update set
  public=false,
  file_size_limit=104857600,
  allowed_mime_types=array['video/mp4'];

create table if not exists public.kora_wall_ball_videos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  uploaded_at timestamptz not null default now(),
  approved boolean not null default false,
  event_screen_consent boolean not null default false,
  constraint ball_video_storage_path_valid check (
    storage_path ~ '^balls/[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+[.]mp4
    and length(storage_path) <= 350
  )
);

create index if not exists kora_wall_ball_videos_recent_approved_idx
  on public.kora_wall_ball_videos (uploaded_at desc)
  where approved = true and event_screen_consent = true;

alter table public.kora_wall_ball_videos enable row level security;
revoke all on table public.kora_wall_ball_videos from public, anon, authenticated;
grant select, insert, update, delete on public.kora_wall_ball_videos to service_role;

-- No public storage policies: kora-wall-feed signs playback URLs with a
-- server-side key. Do not make this bucket public or give anon upload access.
-- A video is visible on the wall ONLY when approved=true,
-- event_screen_consent=true and uploaded_at is within the last 60 minutes.
-- Set approved=false to remove a clip from the next wall refresh.

    and length(storage_path) <= 350
  )
);

create index if not exists kora_wall_ball_videos_recent_approved_idx
  on public.kora_wall_ball_videos (uploaded_at desc)
  where approved = true and event_screen_consent = true;

alter table public.kora_wall_ball_videos enable row level security;
revoke all on table public.kora_wall_ball_videos from public, anon, authenticated;
grant select, insert, update, delete on public.kora_wall_ball_videos to service_role;

-- No public storage policies: kora-wall-feed signs playback URLs with a
-- server-side key. Do not make this bucket public or give anon upload access.
-- A video is visible on the wall ONLY when approved=true,
-- event_screen_consent=true and uploaded_at is within the last 60 minutes.
-- Set approved=false to remove a clip from the next wall refresh.
