-- KORA customer registration. Run ONCE in the linked Supabase SQL Editor.
-- Separate from photo-storage consent. Private staff-managed table; no browser
-- read/write access and no anon/authenticated API policies.
create table if not exists public.kora_player_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 18),
  email text not null check (char_length(email) between 3 and 254),
  instagram text not null check (char_length(instagram) between 1 and 30),
  telephone text not null check (char_length(telephone) between 8 and 24),
  position text not null check (position in
    ('GK','RB','RWB','CB','LB','LWB','CDM','CM','CAM','RM','RW','LM','LW','CF','ST')),
  shirt_number integer not null check (shirt_number between 0 and 99),
  card_cloud_consent boolean not null default false,
  data_consent_version text not null default 'v1',
  data_consented_at timestamptz not null default now()
);

create index if not exists kora_player_registrations_created_at_idx
  on public.kora_player_registrations (created_at desc);

alter table public.kora_player_registrations enable row level security;
revoke all on table public.kora_player_registrations from public, anon, authenticated;
-- The Edge Function uses server-side Supabase credentials only.
grant select, insert, update, delete on public.kora_player_registrations to service_role;

-- Register each consenting customer ONCE per form submission.
-- kora_claim_upload_slot() from kora-cards-storage.sql provides a basic
-- shared per-IP/global abuse limit for both registration and card uploads.
-- Set a suitable retention/deletion period BEFORE live events; for example:
-- delete from public.kora_player_registrations
-- where created_at < now() - interval '90 days';
