-- The Wall of Debts — a sacrificial debt-relief mechanic. Prayers cost a
-- burned fee on a cooldown and clear a small random slice of debt; the vow
-- garnishes a pledged share of every win until the debt is gone.
alter table "user" add column if not exists "wall_prayer_at" timestamptz;
alter table "user" add column if not exists "vow_bps" integer not null default 0;

create table if not exists "wall_prayer" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "note" text not null default '',
  "fee_cents" bigint not null,
  "cleared_cents" bigint not null,
  "created_at" timestamptz not null default now()
);
create index if not exists "wall_prayer_created_idx" on "wall_prayer"("created_at" desc);

-- Track the house loan a levered blackjack loss parked on the round.
alter table "blackjack_round" add column if not exists "loan_cents" bigint not null default 0;
