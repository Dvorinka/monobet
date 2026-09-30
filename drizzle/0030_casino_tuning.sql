alter table "user" add column if not exists luck_bps integer not null default 0;
create table if not exists casino_config (
  id text primary key,
  rig_bps integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into casino_config (id, rig_bps) values ('house', 0) on conflict do nothing;
