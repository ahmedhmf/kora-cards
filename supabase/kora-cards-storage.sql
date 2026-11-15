-- Execute once in Supabase SQL Editor for the KORA project.
-- Private object storage: ONLY the finished player-card PNG is stored.
-- No table stores player names, phone numbers, original photos or WhatsApp data.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('kora-cards','kora-cards',false,10485760,array['image/png'])
on conflict (id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=array['image/png'];

-- Only designated KORA staff users can upload or sign private download URLs.
create table if not exists public.kora_storage_staff (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.kora_storage_staff enable row level security;

drop policy if exists "KORA staff see their membership" on public.kora_storage_staff;
create policy "KORA staff see their membership" on public.kora_storage_staff
for select to authenticated using (auth.uid()=user_id);

-- Once staff accounts are created in Authentication > Users,
-- add their UUIDs using the SQL editor as the project administrator:
-- insert into public.kora_storage_staff (user_id) values ('YOUR_STAFF_AUTH_USER_UUID');

drop policy if exists "KORA staff upload own finished images" on storage.objects;
create policy "KORA staff upload own finished images" on storage.objects
for insert to authenticated
with check (
 bucket_id='kora-cards'
 and lower(storage.extension(name))='png'
 and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.kora_storage_staff where user_id=auth.uid())
);

drop policy if exists "KORA staff sign download URLs for own images" on storage.objects;
create policy "KORA staff sign download URLs for own images" on storage.objects
for select to authenticated
using (
 bucket_id='kora-cards'
 and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.kora_storage_staff where user_id=auth.uid())
);

-- No public read, update or delete policies. Customers use time-limited
-- signed URLs displayed as QR codes; no customer login is required.
