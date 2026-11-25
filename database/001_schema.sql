-- REX Supabase schema (fresh-project installation)
-- Username + password authentication is implemented by the REX FastAPI backend.
-- Supabase Auth still owns credentials/sessions; this schema stores app data only.
-- Run this entire file in the Supabase SQL Editor on the new, empty REX project.

begin;

create extension if not exists pgcrypto;

-- 1. User profile. The backend creates the auth.users identity first, then upserts this row.
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null,
    display_name text,
    avatar_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profiles_username_format check (
        username = lower(username)
        and username ~ '^[a-z0-9_]{3,24}$'
    )
);

create unique index if not exists profiles_username_lower_unique
    on public.profiles (lower(username));

-- 2. Playlists
create table if not exists public.playlists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 80),
    description text,
    cover_key text,
    is_public boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists playlists_user_created_idx
    on public.playlists (user_id, created_at desc);

-- 3. Playlist tracks
create table if not exists public.playlist_tracks (
    id uuid primary key default gen_random_uuid(),
    playlist_id uuid not null references public.playlists(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    track_id text not null,
    track_data jsonb not null default '{}'::jsonb,
    position integer not null default 0,
    added_at timestamptz not null default now(),
    constraint playlist_tracks_unique_track unique (playlist_id, track_id)
);

create index if not exists playlist_tracks_order_idx
    on public.playlist_tracks (playlist_id, position, added_at);

-- 4. Liked tracks
create table if not exists public.liked_tracks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    track_id text not null,
    track_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint liked_tracks_user_track_unique unique (user_id, track_id)
);

create index if not exists liked_tracks_user_created_idx
    on public.liked_tracks (user_id, created_at desc);

-- 5. Listening history
create table if not exists public.play_history (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    track_id text not null,
    track_data jsonb not null default '{}'::jsonb,
    played_at timestamptz not null default now(),
    played_seconds integer not null default 0 check (played_seconds >= 0)
);

create index if not exists play_history_user_played_idx
    on public.play_history (user_id, played_at desc);

-- 6. Saved albums, artists, and other library items
create table if not exists public.saved_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    item_type text not null check (item_type in ('album', 'artist', 'playlist')),
    item_id text not null,
    item_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint saved_items_unique unique (user_id, item_type, item_id)
);

-- 7. Per-user settings
create table if not exists public.user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- 8. Resume position per track
create table if not exists public.playback_offsets (
    user_id uuid not null references auth.users(id) on delete cascade,
    track_id text not null,
    position_seconds numeric(12,3) not null default 0 check (position_seconds >= 0),
    duration_seconds numeric(12,3),
    updated_at timestamptz not null default now(),
    primary key (user_id, track_id)
);

-- 9. Search history
create table if not exists public.search_history (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    query text not null check (char_length(trim(query)) between 1 and 200),
    searched_at timestamptz not null default now()
);

create index if not exists search_history_user_date_idx
    on public.search_history (user_id, searched_at desc);

-- 10. Recovery-code hash. Never store the plaintext recovery code.
-- Backend should hash/verify the code and enforce rate limits.
create table if not exists public.account_recovery (
    user_id uuid primary key references auth.users(id) on delete cascade,
    recovery_code_hash text not null,
    created_at timestamptz not null default now(),
    rotated_at timestamptz not null default now()
);

-- Enable RLS on every user-owned table.
alter table public.profiles enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.liked_tracks enable row level security;
alter table public.play_history enable row level security;
alter table public.saved_items enable row level security;
alter table public.user_settings enable row level security;
alter table public.playback_offsets enable row level security;
alter table public.search_history enable row level security;
alter table public.account_recovery enable row level security;

-- Policies are created conditionally so rerunning this file does not need DROP POLICY.
do $$
begin
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own') then
        execute 'create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_insert_own') then
        execute 'create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own') then
        execute 'create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()))';
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playlists' and policyname='playlists_select_own') then
        execute 'create policy playlists_select_own on public.playlists for select to authenticated using (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playlists' and policyname='playlists_insert_own') then
        execute 'create policy playlists_insert_own on public.playlists for insert to authenticated with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playlists' and policyname='playlists_update_own') then
        execute 'create policy playlists_update_own on public.playlists for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playlists' and policyname='playlists_delete_own') then
        execute 'create policy playlists_delete_own on public.playlists for delete to authenticated using (user_id = (select auth.uid()))';
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playlist_tracks' and policyname='playlist_tracks_all_own') then
        execute 'create policy playlist_tracks_all_own on public.playlist_tracks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='liked_tracks' and policyname='liked_tracks_all_own') then
        execute 'create policy liked_tracks_all_own on public.liked_tracks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='play_history' and policyname='play_history_all_own') then
        execute 'create policy play_history_all_own on public.play_history for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='saved_items' and policyname='saved_items_all_own') then
        execute 'create policy saved_items_all_own on public.saved_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_settings' and policyname='user_settings_all_own') then
        execute 'create policy user_settings_all_own on public.user_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='playback_offsets' and policyname='playback_offsets_all_own') then
        execute 'create policy playback_offsets_all_own on public.playback_offsets for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='search_history' and policyname='search_history_all_own') then
        execute 'create policy search_history_all_own on public.search_history for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_recovery' and policyname='account_recovery_no_client_access') then
        execute 'create policy account_recovery_no_client_access on public.account_recovery for all to authenticated using (false) with check (false)';
    end if;
end
$$;

-- Grant normal app access. RLS still restricts rows to the signed-in user.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
    public.profiles,
    public.playlists,
    public.playlist_tracks,
    public.liked_tracks,
    public.play_history,
    public.saved_items,
    public.user_settings,
    public.playback_offsets,
    public.search_history
to authenticated;

-- Recovery hashes are backend-only; do not grant table access to authenticated clients.
revoke all on public.account_recovery from anon, authenticated;

commit;
