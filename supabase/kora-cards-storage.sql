-- KORA: one private bucket and server-managed uploads (no user/staff login).
-- Run in Supabase SQL Editor. The only uploaded object is a rendered 877x1558 PNG.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('kora-cards','kora-cards',false,10485760,array['image/png'])
on conflict (id) do update set
  public=false,file_size_limit=10485760,allowed_mime_types=array['image/png'];

-- Remove historical staff policies and old allowlist. No public object policies.
drop policy if exists "KORA staff upload own finished images" on storage.objects;
drop policy if exists "KORA staff sign download URLs for own images" on storage.objects;
drop policy if exists "KORA staff see their membership" on public.kora_storage_staff;
drop table if exists public.kora_storage_staff;

-- Atomic server-only quota counter, stored as hashed requests per hour.
create table if not exists public.kora_upload_limits (
  client_hash text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (client_hash, window_start)
);
alter table public.kora_upload_limits enable row level security;
revoke all on table public.kora_upload_limits from public, anon, authenticated;

create or replace function public.kora_claim_upload_slot(p_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_window timestamptz := date_trunc('hour', now());
begin
  if p_hash is null or length(p_hash) <> 64 or p_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  -- Atomic insert/upsert prevents simultaneous upload requests bypassing quota.
  insert into public.kora_upload_limits (client_hash,window_start,count)
  values (p_hash,v_window,1)
  on conflict (client_hash,window_start)
  do update set count=public.kora_upload_limits.count + 1
  returning count into v_count;
  return v_count <= 30; -- per source IP per hour
end;
$$;
revoke all on function public.kora_claim_upload_slot(text) from public, anon, authenticated;
grant execute on function public.kora_claim_upload_slot(text) to service_role;

-- Periodically remove old quota hashes. This has no effect on card images.
-- delete from public.kora_upload_limits where window_start < now() - interval '48 hours';
-- Configure image retention/deletion in Supabase before live events.
