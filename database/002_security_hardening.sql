-- REX follow-up hardening for the already-installed database/001_schema.sql
-- Run once in Supabase Dashboard -> SQL Editor before enabling user registration.
-- Safe to re-run.

begin;

-- A user may only attach tracks to playlists they own. The composite FK makes
-- playlist_id + user_id an ownership pair at the database level.
create unique index if not exists playlists_id_user_id_uidx
    on public.playlists (id, user_id);

alter table public.playlist_tracks
    drop constraint if exists playlist_tracks_playlist_id_fkey;
alter table public.playlist_tracks
    drop constraint if exists playlist_tracks_playlist_owner_fkey;
alter table public.playlist_tracks
    add constraint playlist_tracks_playlist_owner_fkey
    foreign key (playlist_id, user_id)
    references public.playlists (id, user_id)
    on delete cascade;

 drop policy if exists playlist_tracks_all_own on public.playlist_tracks;
create policy playlist_tracks_all_own on public.playlist_tracks
    for all to authenticated
    using (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.playlists p
            where p.id = playlist_tracks.playlist_id
              and p.user_id = (select auth.uid())
        )
    )
    with check (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.playlists p
            where p.id = playlist_tracks.playlist_id
              and p.user_id = (select auth.uid())
        )
    );

-- Username is the account login identifier. Clients may read it, but may only
-- edit display_name and avatar_key through their authenticated RLS-scoped token.
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_key, updated_at) on public.profiles to authenticated;

commit;
