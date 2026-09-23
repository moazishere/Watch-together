-- Row Level Security: the browser talks to these tables directly with the
-- publishable (anon) key and the user's session, so every table is locked
-- down here. Anything with a realtime or screen-share side effect (start/end a
-- session, revoke an invite) goes through the Express server, which uses the
-- secret key and bypasses RLS.

alter table public.profiles enable row level security;
alter table public.environments enable row level security;
alter table public.watch_rooms enable row level security;
alter table public.watch_room_participants enable row level security;
alter table public.friendships enable row level security;
alter table public.watch_room_invites enable row level security;

-- Nothing is readable before logging in.
revoke all on public.profiles, public.environments, public.watch_rooms, public.watch_room_participants,
  public.friendships, public.watch_room_invites from anon;

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies on one table can look at another
-- without recursing through that table's policies.
-- ---------------------------------------------------------------------------

create function public.is_room_host(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.watch_rooms r where r.id = room and r.host_user_id = auth.uid());
$$;

create function public.can_access_room(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.watch_rooms r
    where r.id = room
      and (r.host_user_id = auth.uid()
           or exists (select 1 from public.watch_room_invites i where i.room_id = r.id and i.user_id = auth.uid()))
  );
$$;

create function public.is_invited(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.watch_room_invites i where i.room_id = room and i.user_id = auth.uid());
$$;

create function public.room_is_open(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.watch_rooms r where r.id = room and r.status <> 'ended');
$$;

create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_id = a and f.friend_id = b) or (f.user_id = b and f.friend_id = a))
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles: display names are visible to every signed-in user; you can only
-- rename yourself, and never change your own role.
-- ---------------------------------------------------------------------------

create policy "profiles are readable by signed-in users"
  on public.profiles for select to authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke insert, update, delete on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- environments: read-only catalogue.
-- ---------------------------------------------------------------------------

create policy "environments are readable by signed-in users"
  on public.environments for select to authenticated
  using (true);

revoke insert, update, delete on public.environments from authenticated;

-- ---------------------------------------------------------------------------
-- watch_rooms: visible to the host and invitees. Anyone can create a room
-- they host, in an available environment. Status changes happen on the
-- server only (they fan out over Socket.io and touch the screen-share call).
-- ---------------------------------------------------------------------------

-- The host check stays inline: a function reading watch_rooms could not see a
-- row inserted by the same statement, which would break insert ... returning.
create policy "rooms are visible to host and invitees"
  on public.watch_rooms for select to authenticated
  using (host_user_id = auth.uid() or public.is_invited(id));

create policy "users create rooms they host"
  on public.watch_rooms for insert to authenticated
  with check (
    host_user_id = auth.uid()
    and status = 'waiting'
    and ended_at is null
    and exists (
      select 1 from public.environments e
      where e.id = environment_id
        and coalesce((e.asset_config ->> 'available')::boolean, true)
    )
  );

revoke update, delete on public.watch_rooms from authenticated;

-- ---------------------------------------------------------------------------
-- watch_room_invites: the host invites accepted friends into an open room.
-- Revoking goes through the server so the person is also removed from the
-- live room.
-- ---------------------------------------------------------------------------

create policy "invites are visible to the host and the invitee"
  on public.watch_room_invites for select to authenticated
  using (user_id = auth.uid() or public.is_room_host(room_id));

create policy "hosts invite friends into open rooms"
  on public.watch_room_invites for insert to authenticated
  with check (
    public.is_room_host(room_id)
    and public.room_is_open(room_id)
    and public.are_friends(auth.uid(), user_id)
  );

revoke update, delete on public.watch_room_invites from authenticated;

-- ---------------------------------------------------------------------------
-- watch_room_participants: who has joined a room. You record your own join.
-- ---------------------------------------------------------------------------

create policy "participants are visible to room members"
  on public.watch_room_participants for select to authenticated
  using (public.can_access_room(room_id));

create policy "users record their own join"
  on public.watch_room_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_access_room(room_id)
    and public.room_is_open(room_id)
  );

revoke update, delete on public.watch_room_participants from authenticated;

-- ---------------------------------------------------------------------------
-- friendships: both sides can see and delete (decline / cancel / unfriend);
-- only the recipient can accept. Requests are sent by email through
-- request_friend() because emails live in auth.users.
-- ---------------------------------------------------------------------------

create policy "friendships are visible to both sides"
  on public.friendships for select to authenticated
  using (auth.uid() in (user_id, friend_id));

create policy "recipients accept requests"
  on public.friendships for update to authenticated
  using (friend_id = auth.uid() and status = 'pending')
  with check (friend_id = auth.uid() and status = 'accepted');

create policy "either side removes a friendship"
  on public.friendships for delete to authenticated
  using (auth.uid() in (user_id, friend_id));

revoke insert, update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Sends a friend request by email. If that person already asked you, this
-- accepts their request instead. Returns 'pending' or 'accepted'.
create function public.request_friend(friend_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
  result text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select u.id into target from auth.users u where lower(u.email) = lower(trim(friend_email));
  if target is null then
    raise exception 'No user with that email' using errcode = 'P0002';
  end if;
  if target = me then
    raise exception 'You can''t add yourself' using errcode = '22023';
  end if;

  update public.friendships set status = 'accepted'
  where user_id = target and friend_id = me
  returning status into result;
  if result is not null then
    return result;
  end if;

  insert into public.friendships (user_id, friend_id) values (me, target)
  on conflict (user_id, friend_id) do update set status = public.friendships.status
  returning status into result;
  return result;
end;
$$;

-- Your friends and pending requests, with emails (which other users can't
-- otherwise read). direction: 'outgoing' = you asked, 'incoming' = they asked.
create function public.list_friends()
returns table (id uuid, name text, email text, status text, direction text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, u.email::text, f.status,
         case when f.user_id = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  join auth.users u on u.id = p.id
  where auth.uid() in (f.user_id, f.friend_id)
  order by p.name;
$$;

revoke execute on function public.is_room_host(uuid), public.can_access_room(uuid), public.is_invited(uuid), public.room_is_open(uuid),
  public.are_friends(uuid, uuid), public.request_friend(text), public.list_friends(), public.handle_new_user()
  from public, anon;
grant execute on function public.is_room_host(uuid), public.can_access_room(uuid), public.is_invited(uuid), public.room_is_open(uuid),
  public.are_friends(uuid, uuid), public.request_friend(text), public.list_friends()
  to authenticated;
