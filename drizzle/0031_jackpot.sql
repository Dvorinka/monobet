create table if not exists jackpot_round (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null default now(),
  draw_at timestamptz not null,
  drawn_at timestamptz,
  winner_id text references "user"(id) on delete set null,
  pool_cents bigint not null default 0,
  tickets integer not null default 0
);
