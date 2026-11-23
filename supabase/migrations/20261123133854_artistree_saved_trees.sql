-- Apply only to the Artistree-dedicated project after local/target review.
-- Guest exploration uses no Supabase anonymous user and has no table access.
create schema if not exists artistree_private;
revoke all on schema artistree_private from public, anon, authenticated;

create table public.artistree_saved_trees (
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('main', 'spotify')),
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  saved_at timestamptz not null,
  artist_count integer not null check (artist_count between 1 and 500 and (scope <> 'spotify' or artist_count <= 20)),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, scope, id),
  constraint artistree_snapshot_shape check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot ->> 'version' = '1'
    and snapshot ->> 'id' = id
    and snapshot ->> 'scope' = scope
    and snapshot ->> 'name' = name
    and jsonb_typeof(snapshot -> 'graph' -> 'artists') = 'array'
    and jsonb_array_length(snapshot -> 'graph' -> 'artists') = artist_count
    and jsonb_typeof(snapshot -> 'graph' -> 'edges') = 'array'
    and jsonb_array_length(snapshot -> 'graph' -> 'edges') <= 2000
    and jsonb_typeof(snapshot -> 'graph' -> 'explorer') = 'object'
    and jsonb_typeof(snapshot -> 'camera') = 'object'
    and octet_length(snapshot::text) <= 2000000
    and snapshot ?& array['version','id','scope','name','savedAt','graph','camera']
    and (snapshot -> 'graph') ?& array['artists','edges','explorer']
  )
);
create index artistree_saved_trees_recent on public.artistree_saved_trees (owner_id, scope, saved_at desc);
alter table public.artistree_saved_trees enable row level security;
alter table public.artistree_saved_trees force row level security;

revoke all on public.artistree_saved_trees from public, anon, authenticated;
grant select, insert, delete on public.artistree_saved_trees to authenticated;

create policy "Owners can read their trees"
  on public.artistree_saved_trees for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Owners can save their trees"
  on public.artistree_saved_trees for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete their trees"
  on public.artistree_saved_trees for delete to authenticated
  using ((select auth.uid()) = owner_id);
-- Snapshots are immutable. No UPDATE grant/policy, including owner reassignment.

create function artistree_private.limit_saved_trees()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize concurrent saves for this owner/view. This is not a client-only cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text || ':' || new.scope, 0));
  -- Duplicate imports use ON CONFLICT DO NOTHING and must not consume a slot.
  if exists (select 1 from public.artistree_saved_trees
    where owner_id = new.owner_id and scope = new.scope and id = new.id) then
    return new;
  end if;
  if (select count(*) from public.artistree_saved_trees where owner_id = new.owner_id and scope = new.scope) >= 20 then
    raise exception 'Account map limit reached.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function artistree_private.limit_saved_trees() from public, anon, authenticated;
create trigger artistree_saved_trees_limit before insert on public.artistree_saved_trees
  for each row execute function artistree_private.limit_saved_trees();
