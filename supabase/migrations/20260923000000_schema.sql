-- Phase 1 schema on Supabase (see SPEC.md "Data model").
-- Users live in Supabase Auth (auth.users); app-specific fields go in profiles.

create type public.user_role as enum ('normal', 'admin');

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  role       public.user_role not null default 'normal',
  created_at timestamptz not null default now()
);

create table public.environments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  asset_config    jsonb not null default '{}'::jsonb,
  screen_position jsonb not null,
  walkable_bounds jsonb not null,
  created_at      timestamptz not null default now()
);

create table public.watch_rooms (
  id             uuid primary key default gen_random_uuid(),
  host_user_id   uuid not null references public.profiles (id) on delete cascade,
  environment_id uuid not null references public.environments (id),
  status         text not null default 'waiting' check (status in ('waiting', 'live', 'ended')),
  created_at     timestamptz not null default now(),
  ended_at       timestamptz null
);
create index watch_rooms_host_idx on public.watch_rooms (host_user_id);

create table public.watch_room_participants (
  room_id   uuid not null references public.watch_rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- One row per pair: user_id sent the request, friend_id received it.
create table public.friendships (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  status    text not null default 'pending' check (status in ('pending', 'accepted')),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on public.friendships (friend_id);

-- Not in the spec's table list: who the host invited (build step 6). Only the
-- host and invited friends can see or join a room.
create table public.watch_room_invites (
  room_id    uuid not null references public.watch_rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  invited_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index watch_room_invites_user_idx on public.watch_room_invites (user_id);

-- Every new Auth user gets a profile. The display name comes from the signup
-- metadata ({ data: { name } } in supabase.auth.signUp).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 40)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
