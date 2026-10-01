-- Widen money columns on the user table: int4 tops out at ~Ɱ21.5M and a large
-- admin adjustment (or a big winner) overflowed with a raw SQL error. Ledger
-- amounts were already bigint — this brings the balances in line.
ALTER TABLE "user" ALTER COLUMN "balance_cents" TYPE bigint;
ALTER TABLE "user" ALTER COLUMN "debt_cents" TYPE bigint;
