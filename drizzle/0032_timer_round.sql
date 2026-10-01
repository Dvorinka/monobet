create table if not exists timer_round (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  target_ms integer not null,
  bet_cents integer not null,
  leverage integer not null default 1,
  fee_cents integer not null default 0,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists timer_round_user_idx on timer_round (user_id, created_at);
