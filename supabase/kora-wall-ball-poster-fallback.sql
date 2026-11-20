-- Apply to the KORA Supabase project before deploying poster-enabled uploads.
-- Existing MP4 records remain valid; new recordings will link a JPEG fallback.
alter table public.kora_wall_ball_videos
  add column if not exists poster_storage_path text;

alter table public.kora_wall_ball_videos
  drop constraint if exists ball_video_poster_path_valid;
alter table public.kora_wall_ball_videos
  add constraint ball_video_poster_path_valid check (
    poster_storage_path is null or
    poster_storage_path = regexp_replace(storage_path, '[.]mp4$', '.jpg')
  );

-- Preserve the bucket's existing public/private setting and size limit.
-- The current no-login uploader uses public reads, while wall URLs can be signed.
update storage.buckets set
  allowed_mime_types = array['video/mp4','image/jpeg']::text[]
where id = 'kora-wall-media';

-- Recreate the trusted registration RPC with poster verification.
-- Run the updated supabase/automatic-wall-upload.sql from the
-- kora-mobile-ball-visualizer repository after this schema migration.
