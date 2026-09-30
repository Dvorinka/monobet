-- Community notes: users annotate a resolvable market (binary or a group
-- option) with what they think the right outcome is and why. The resolver
-- (creator/admin) sees them before resolving and can publish individual
-- notes onto the market page, above the rules.
create table community_note (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references market(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  stance text, -- 'yes' | 'no' | null
  body text not null,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index community_note_market_idx on community_note(market_id, created_at);

-- Blackjack dealer personas — admin-configured characters that front the
-- automated dealer. Quips show on round settlement.
create table dealer_persona (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  avatar text not null default '🃏', -- emoji
  quip_win text not null default '',  -- dealer wins
  quip_lose text not null default '', -- dealer loses / pushes
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into dealer_persona (name, avatar, quip_win, quip_lose) values
  ('Dealer Dan', 'DD', 'The house always collects.', 'Enjoy it while it lasts.'),
  ('Madame V', 'MV', 'The cards told me so.', 'Hmm. The deck favors you today.'),
  ('One-Eye Otto', 'OO', 'Read them and weep.', 'I let you have that one.');

-- Blackjack rounds live server-side so hit/stand can't forge the deck.
create table blackjack_round (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  bet_cents integer not null,
  leverage integer not null default 1,
  deck jsonb not null,     -- remaining shoe, ints 0-51
  player jsonb not null,   -- player cards
  dealer jsonb not null,   -- dealer cards (index 0 is the up-card)
  persona jsonb not null,  -- snapshot: {name, avatar, quipWin, quipLose}
  status text not null default 'playing', -- playing | settled
  result text,             -- win | lose | push | blackjack
  net_cents integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index blackjack_round_user_idx on blackjack_round(user_id, created_at);
